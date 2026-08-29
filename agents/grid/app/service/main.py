"""Public ERC-8183 service adapter for the first-party Grid Agent test runtime."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response

from bnbagent import EVMWalletProvider
from bnbagent.erc8183 import ERC8183JobOps, funded_job_watcher
from bnbagent.storage import LocalStorageProvider

from app.agent.main import fulfill_grid_job_with_execution
from app.service.config import validate_runtime_config

logger = logging.getLogger("grid_agent")
config = validate_runtime_config()

_STORAGE_DIR = Path(os.getenv("STORAGE_LOCAL_PATH") or ".agent-data")
_EXECUTION_INTERNAL_URL = (os.getenv("GRID_EXECUTION_INTERNAL_URL") or "http://127.0.0.1:8788").rstrip("/")
_EXECUTION_CAPITAL_WINDOW_SECONDS = max(
    0,
    int(float(os.getenv("ERC8183_EXECUTION_CAPITAL_WINDOW_SECONDS") or "0")),
)
_AUTHORIZATION_POLL_SECONDS = max(5, int(float(os.getenv("ERC8183_ALTANA_AUTHORIZATION_POLL_SECONDS") or "10")))

_wallet = EVMWalletProvider(
    password=os.environ["WALLET_PASSWORD"],
    private_key=os.environ.get("PRIVATE_KEY"),
)
_storage = LocalStorageProvider(base_dir=str(_STORAGE_DIR))
_ops = ERC8183JobOps(
    _wallet,
    network=config["network"],
    storage_provider=_storage,
    service_price=config["service_price"],
    agent_url=config["endpoint"],
)


def _provider_address() -> str:
    return str(_ops.agent_address)


def _payment_token() -> str | None:
    try:
        return str(_ops.erc8183_client.payment_token)
    except Exception:
        return None


_funded_first_seen: dict[int, float] = {}


async def _read_local_execution_readiness() -> dict[str, Any]:
    """Read the isolated Node execution service's live Altana authorization state."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(f"{_EXECUTION_INTERNAL_URL}/execution-readiness")
            raw = await response.text()
            try:
                body = response.json()
            except ValueError:
                body = {}
            if response.status_code >= 500:
                raise RuntimeError(body.get("error") if isinstance(body, dict) and body.get("error") else f"execution readiness returned HTTP {response.status_code}")
            if not isinstance(body, dict):
                raise RuntimeError("execution readiness response was not an object")
            if not response.is_success and not body.get("ready"):
                return body
            return body
    except (httpx.HTTPError, RuntimeError) as exc:
        return {
            "ready": False,
            "walletAddress": os.getenv("ALTANA_WALLET_ADDRESS"),
            "reasons": [f"Grid local execution readiness unavailable: {exc}"],
        }


async def _wait_for_altana_authorization(job: dict[str, Any]) -> dict[str, Any]:
    """Hold a funded job until the exact configured Altana session is live on KeyStore.

    The provider must not turn a merely-funded ERC-8183 job into a submission before
    the user has granted the scoped Altana session. The KeyStore is the authority for
    this gate; no marketplace API or cached boolean is treated as sufficient.
    """
    expired_at_raw = job.get("expiredAt") or job.get("expired_at") or 0
    try:
        expired_at = int(expired_at_raw)
    except (TypeError, ValueError):
        expired_at = 0

    while True:
        readiness = await _read_local_execution_readiness()
        if readiness.get("ready") is True:
            logger.info(
                "ERC8183_ALTANA_AUTHORIZED job_id=%s wallet=%s session_key=%s session_key_id=%s",
                job.get("jobId"),
                readiness.get("walletAddress"),
                readiness.get("sessionKeyAddress"),
                readiness.get("sessionKeyId"),
            )
            return readiness

        if expired_at and int(time.time()) >= expired_at:
            raise RuntimeError(
                f"ERC-8183 job {job.get('jobId')} expired while waiting for the required Altana session authorization; no deliverable was submitted"
            )

        logger.info(
            "ERC8183_ALTANA_AUTHORIZATION_WAIT job_id=%s wallet=%s reasons=%s",
            job.get("jobId"),
            readiness.get("walletAddress"),
            " | ".join(readiness.get("reasons") or ["Altana session not yet authorized"]),
        )
        await asyncio.sleep(_AUTHORIZATION_POLL_SECONDS)


async def _on_funded(job: dict[str, Any]) -> None:
    job_id = job.get("jobId")
    if job_id is None:
        logger.warning("Funded job callback received without jobId")
        return

    try:
        job_id_int = int(job_id)
    except (TypeError, ValueError):
        logger.warning("Funded job callback received invalid jobId=%r", job_id)
        return

    if _EXECUTION_CAPITAL_WINDOW_SECONDS > 0:
        now = time.monotonic()
        first_seen = _funded_first_seen.setdefault(job_id_int, now)
        elapsed = now - first_seen
        if elapsed < _EXECUTION_CAPITAL_WINDOW_SECONDS:
            logger.info(
                "ERC8183_CAPITAL_WINDOW_ACTIVE job_id=%s remaining_seconds=%.0f provider=%s network=%s chain_id=97",
                job_id_int,
                _EXECUTION_CAPITAL_WINDOW_SECONDS - elapsed,
                _provider_address(),
                config["network"],
            )
            return
        _funded_first_seen.pop(job_id_int, None)

    logger.info(
        "ERC8183_FUNDED_JOB_OBSERVED job_id=%s provider=%s network=%s chain_id=97",
        job_id_int,
        _provider_address(),
        config["network"],
    )

    try:
        await _wait_for_altana_authorization(job)

        logger.info(
            "ERC8183_AGENT_EXECUTION_STARTED job_id=%s provider=%s network=%s chain_id=97",
            job_id_int,
            _provider_address(),
            config["network"],
        )
        deliverable, metadata = await fulfill_grid_job_with_execution(job)
        logger.info(
            "ERC8183_AGENT_DELIVERABLE_GENERATED job_id=%s provider=%s execution_status=%s",
            job_id_int,
            _provider_address(),
            metadata.get("execution_status", "unknown"),
        )

        # Keep the deliverable self-contained for compatibility with the
        # installed BNB Agent SDK provider API. Execution evidence is already
        # embedded in the JSON returned by fulfill_grid_job_with_execution().
        submission = await _ops.submit_result(job_id_int, deliverable)

        tx_hash = None
        if isinstance(submission, str):
            tx_hash = submission
        elif hasattr(submission, "hash"):
            tx_hash = str(submission.hash)
        elif isinstance(submission, dict):
            tx_hash = submission.get("hash") or submission.get("tx_hash")

        logger.info(
            "ERC8183_SUBMISSION_CONFIRMED job_id=%s provider=%s tx_hash=%s network=%s chain_id=97",
            job_id_int,
            _provider_address(),
            tx_hash or "unknown",
            config["network"],
        )
    except Exception:
        logger.exception(
            "ERC8183_AGENT_EXECUTION_FAILED job_id=%s provider=%s network=%s chain_id=97",
            job_id_int,
            _provider_address(),
            config["network"],
        )
        raise


async def _proxy_execution(request: Request, endpoint: str) -> Response:
    body = None
    if request.method not in {"GET", "HEAD"}:
        body = await request.body()
    headers: dict[str, str] = {}
    for name in ("authorization", "content-type", "accept"):
        value = request.headers.get(name)
        if value:
            headers[name] = value
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            upstream = await client.request(request.method, f"{_EXECUTION_INTERNAL_URL}{endpoint}", headers=headers, content=body)
    except httpx.HTTPError as exc:
        logger.exception("Grid execution upstream unavailable")
        raise HTTPException(status_code=503, detail="Grid execution service unavailable") from exc
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers={"content-type": upstream.headers.get("content-type", "application/json"), "cache-control": "no-store"},
    )


_watcher_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _watcher_task
    logger.info(
        "ERC8183_WATCHER_STARTING provider=%s network=%s chain_id=97 poll_interval=%s capital_window_seconds=%s altana_authorization_poll_seconds=%s",
        _provider_address(),
        config["network"],
        config["poll_interval"],
        _EXECUTION_CAPITAL_WINDOW_SECONDS,
        _AUTHORIZATION_POLL_SECONDS,
    )
    _watcher_task = asyncio.create_task(funded_job_watcher(_ops, _on_funded, interval=config["poll_interval"]))
    try:
        yield
    finally:
        if _watcher_task is not None:
            _watcher_task.cancel()
            await asyncio.gather(_watcher_task, return_exceptions=True)
        logger.info("ERC8183_WATCHER_STOPPED provider=%s network=%s chain_id=97", _provider_address(), config["network"])


app = FastAPI(
    title="Grid Agent",
    description="BNB Agent Studio first-party Grid Agent on BSC Testnet with ERC-8183 and Altana-scoped execution",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/erc8183")
async def erc8183_root() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "Grid Agent ERC-8183 provider",
        "network": "bsc-testnet",
        "chain_id": 97,
        "agent_address": _provider_address(),
        "endpoints": {
            "health": "/erc8183/health",
            "status": "/erc8183/status",
            "negotiate": "/erc8183/negotiate",
            "execution_capabilities": "/erc8183/execution-capabilities",
            "execution_health": "/erc8183/execution-health",
            "preflight_pancake": "/erc8183/preflight/pancake",
            "execute": "/erc8183/execute",
            "receipt": "/erc8183/receipt/{transaction_hash}",
        },
    }


@app.get("/erc8183/health")
async def erc8183_health() -> dict[str, Any]:
    return {"status": "ok", "service": "Grid Agent ERC-8183", "network": "bsc-testnet", "chain_id": 97}


@app.get("/erc8183/status")
async def erc8183_status() -> dict[str, Any]:
    return {
        "status": "ok",
        "network": "bsc-testnet",
        "chain_id": 97,
        "agent_address": _provider_address(),
        "commerce_address": str(_ops.erc8183_client.commerce.address),
        "router_address": str(_ops.erc8183_client.router.address),
        "policy_address": str(_ops.erc8183_client.policy.address),
        "service_price": config["service_price"],
        "payment_token": _payment_token(),
        "poll_interval": config["poll_interval"],
        "execution_capital_window_seconds": _EXECUTION_CAPITAL_WINDOW_SECONDS,
        "altana_authorization_poll_seconds": _AUTHORIZATION_POLL_SECONDS,
    }


@app.post("/erc8183/negotiate")
async def negotiate(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Request body must be an object")
    return {
        "accepted": True,
        "quote_id": f"grid-{int(time.time())}",
        "price": str(config["service_price"]),
        "currency": _payment_token() or "testnet-settlement-token",
        "quote_expires_at": int(time.time()) + 300,
        "chain_id": 97,
        "network": "bsc-testnet",
        "environment": "testnet",
        "provider_address": _provider_address(),
        "task_description": body.get("task_description") or "",
        "terms": body.get("terms") if isinstance(body.get("terms"), dict) else {},
    }


@app.get("/erc8183/execution-capabilities")
async def execution_capabilities(request: Request) -> Response:
    return await _proxy_execution(request, "/execution-capabilities")


@app.get("/erc8183/execution-health")
async def execution_health(request: Request) -> Response:
    return await _proxy_execution(request, "/health")


@app.post("/erc8183/preflight/pancake")
async def pancake_preflight(request: Request) -> Response:
    return await _proxy_execution(request, "/preflight/pancake")


@app.post("/erc8183/execute")
async def execute(request: Request) -> Response:
    return await _proxy_execution(request, "/execute")


@app.get("/erc8183/receipt/{transaction_hash}")
async def execution_receipt(transaction_hash: str, request: Request) -> Response:
    return await _proxy_execution(request, f"/receipt/{transaction_hash}")


@app.get("/erc8183/job/{job_id}/response")
async def job_response(job_id: int) -> Response:
    filepath = _STORAGE_DIR / f"erc8183-job-{job_id}.json"
    try:
        content = filepath.read_bytes()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="No deliverable found for this job") from exc
    return Response(content=content, media_type="application/json")
