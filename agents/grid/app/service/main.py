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

# Grid is an autonomous Testnet agent. There is no user-facing execution
# button or marketplace-side capital countdown. The agent acts when its
# funded ERC-8183 job arrives and its own scoped Altana session is ready.
_EXECUTION_CAPITAL_WINDOW_SECONDS = max(
    0,
    int(float(os.getenv("ERC8183_EXECUTION_CAPITAL_WINDOW_SECONDS") or "0")),
)

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
        "ERC8183_AGENT_EXECUTION_STARTED job_id=%s provider=%s network=%s chain_id=97",
        job_id_int,
        _provider_address(),
        config["network"],
    )

    try:
        deliverable, metadata = await fulfill_grid_job_with_execution(job)
        logger.info(
            "ERC8183_AGENT_DELIVERABLE_GENERATED job_id=%s provider=%s execution_status=%s",
            job_id_int,
            _provider_address(),
            metadata.get("execution_status", "unknown"),
        )

        submission = await _ops.submit_result(
            job_id_int,
            deliverable,
            metadata=metadata,
        )

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
        "ERC8183_WATCHER_STARTING provider=%s network=%s chain_id=97 poll_interval=%s capital_window_seconds=%s",
        _provider_address(),
        config["network"],
        config["poll_interval"],
        _EXECUTION_CAPITAL_WINDOW_SECONDS,
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
