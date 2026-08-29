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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("grid_agent")
config = validate_runtime_config()

_STORAGE_DIR = Path(os.getenv("STORAGE_LOCAL_PATH") or ".agent-data")
_EXECUTION_INTERNAL_URL = (os.getenv("GRID_EXECUTION_INTERNAL_URL") or "http://127.0.0.1:8788").rstrip("/")
_EXECUTION_CAPITAL_WINDOW_SECONDS = max(0, int(float(os.getenv("ERC8183_EXECUTION_CAPITAL_WINDOW_SECONDS") or "0")))
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
_runtime: dict[str, Any] = {
    "watcher_started_at": None,
    "last_funded_job_observed": None,
    "last_job_id": None,
    "last_execution_started": None,
    "last_execution_completed": None,
    "last_execution_failed": None,
    "last_error": None,
    "last_submission": None,
}


async def _read_local_execution_readiness() -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(f"{_EXECUTION_INTERNAL_URL}/execution-readiness")
            try:
                body = response.json()
            except ValueError:
                body = {}
            if response.status_code >= 500:
                raise RuntimeError(
                    body.get("error")
                    if isinstance(body, dict) and body.get("error")
                    else f"execution readiness returned HTTP {response.status_code}"
                )
            if not isinstance(body, dict):
                raise RuntimeError("execution readiness response was not an object")
            return body
    except (httpx.HTTPError, RuntimeError) as exc:
        return {
            "ready": False,
            "walletAddress": os.getenv("ALTANA_WALLET_ADDRESS"),
            "reasons": [f"Grid local execution readiness unavailable: {exc}"],
        }


async def _wait_for_altana_authorization(job: dict[str, Any]) -> dict[str, Any]:
    expired_at_raw = job.get("expiredAt") or job.get("expired_at") or 0
    try:
        expired_at = int(expired_at_raw)
    except (TypeError, ValueError):
        expired_at = 0

    while True:
        readiness = await _read_local_execution_readiness()
        if readiness.get("ready") is True:
            logger.info(
                "ERC8183_EXECUTION_READY job_id=%s wallet=%s token=%s amount_raw=%s balance_raw=%s allowance_raw=%s session_key=%s session_key_id=%s",
                job.get("jobId"),
                readiness.get("walletAddress"),
                readiness.get("executionToken"),
                readiness.get("requiredAmountRaw"),
                readiness.get("tokenBalanceRaw"),
                readiness.get("tokenAllowanceRaw"),
                readiness.get("sessionKeyAddress"),
                readiness.get("sessionKeyId"),
            )
            return readiness

        if expired_at and int(time.time()) >= expired_at:
            raise RuntimeError(
                f"ERC-8183 job {job.get('jobId')} expired while waiting for Altana authorization and exact execution-capital readiness; no deliverable was submitted"
            )

        logger.info(
            "ERC8183_EXECUTION_WAIT job_id=%s wallet=%s token=%s amount_raw=%s reasons=%s",
            job.get("jobId"),
            readiness.get("walletAddress"),
            readiness.get("executionToken"),
            readiness.get("requiredAmountRaw"),
            " | ".join(readiness.get("reasons") or ["Execution not ready"]),
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

    _runtime["last_funded_job_observed"] = int(time.time())
    _runtime["last_job_id"] = job_id_int
    _runtime["last_error"] = None
    logger.info(
        "ERC8183_FUNDED_JOB_OBSERVED job_id=%s provider=%s network=%s chain_id=97",
        job_id_int,
        _provider_address(),
        config["network"],
    )

    try:
        readiness = await _wait_for_altana_authorization(job)
        _runtime["last_execution_started"] = int(time.time())
        logger.info(
            "ERC8183_AGENT_EXECUTION_STARTED job_id=%s provider=%s network=%s chain_id=97",
            job_id_int,
            _provider_address(),
            config["network"],
        )
        deliverable, metadata = await fulfill_grid_job_with_execution(job)
        execution_status = str(metadata.get("execution_status") or "").lower()
        transaction_hash = str(metadata.get("transaction_hash") or "")
        if execution_status != "executed" or not transaction_hash:
            raise RuntimeError(
                f"Grid execution did not produce successful execution evidence for job {job_id_int}; execution_status={execution_status or 'unknown'}; no ERC-8183 deliverable was submitted"
            )
        _runtime["last_execution_completed"] = int(time.time())
        logger.info(
            "ERC8183_AGENT_DELIVERABLE_GENERATED job_id=%s provider=%s execution_status=%s tx_hash=%s token=%s amount_raw=%s",
            job_id_int,
            _provider_address(),
            execution_status,
            transaction_hash,
            readiness.get("executionToken"),
            readiness.get("requiredAmountRaw"),
        )
        submission = await _ops.submit_result(job_id_int, deliverable)
        tx_hash = None
        if isinstance(submission, str):
            tx_hash = submission
        elif hasattr(submission, "hash"):
            tx_hash = str(submission.hash)
        elif isinstance(submission, dict):
            tx_hash = submission.get("hash") or submission.get("tx_hash")
        _runtime["last_submission"] = {
            "timestamp": int(time.time()),
            "job_id": job_id_int,
            "tx_hash": tx_hash,
        }
        logger.info(
            "ERC8183_SUBMISSION_CONFIRMED job_id=%s provider=%s tx_hash=%s network=%s chain_id=97",
            job_id_int,
            _provider_address(),
            tx_hash or "unknown",
            config["network"],
        )
    except Exception as exc:
        _runtime["last_execution_failed"] = int(time.time())
        _runtime["last_error"] = str(exc)
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
            upstream = await client.request(
                request.method,
                f"{_EXECUTION_INTERNAL_URL}{endpoint}",
                headers=headers,
                content=body,
            )
    except httpx.HTTPError:
        logger.exception("Grid execution upstream unavailable")
        raise HTTPException(status_code=503, detail="Grid execution service unavailable")
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers={
            "content-type": upstream.headers.get("content-type", "application/json"),
            "cache-control": "no-store",
        },
    )


_watcher_task: asyncio.Task | None = None


def _watcher_state() -> dict[str, Any]:
    if _watcher_task is None:
        return {"created": False, "running": False, "done": False, "cancelled": False, "exception": None}
    state: dict[str, Any] = {
        "created": True,
        "running": not _watcher_task.done(),
        "done": _watcher_task.done(),
        "cancelled": _watcher_task.cancelled(),
        "exception": None,
    }
    if _watcher_task.done() and not _watcher_task.cancelled():
        try:
            exception = _watcher_task.exception()
        except Exception as exc:
            exception = exc
        state["exception"] = str(exception) if exception else None
    return state


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _watcher_task
    _runtime["watcher_started_at"] = int(time.time())
    logger.info(
        "ERC8183_WATCHER_STARTING provider=%s network=%s chain_id=97 poll_interval=%s capital_window_seconds=%s altana_authorization_poll_seconds=%s",
        _provider_address(),
        config["network"],
        config["poll_interval"],
        _EXECUTION_CAPITAL_WINDOW_SECONDS,
        _AUTHORIZATION_POLL_SECONDS,
    )
    _watcher_task = asyncio.create_task(
        funded_job_watcher(_ops, _on_funded, interval=config["poll_interval"])
    )
    try:
        yield
    finally:
        if _watcher_task is not None:
            _watcher_task.cancel()
            await asyncio.gather(_watcher_task, return_exceptions=True)
        logger.info(
            "ERC8183_WATCHER_STOPPED provider=%s network=%s chain_id=97",
            _provider_address(),
            config["network"],
        )


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
            "runtime_status": "/erc8183/runtime-status",
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
    return {
        "status": "ok",
        "service": "Grid Agent ERC-8183",
        "network": "bsc-testnet",
        "chain_id": 97,
    }


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


@app.get("/erc8183/runtime-status")
async def erc8183_runtime_status() -> dict[str, Any]:
    readiness = await _read_local_execution_readiness()
    return {
        "status": "ok",
        "network": "bsc-testnet",
        "chain_id": 97,
        "provider": _provider_address(),
        "commerce_address": str(_ops.erc8183_client.commerce.address),
        "watcher": {
            **_watcher_state(),
            "started_at": _runtime["watcher_started_at"],
            "poll_interval_seconds": config["poll_interval"],
        },
        "last_job": {
            "funded_job_observed_at": _runtime["last_funded_job_observed"],
            "job_id": _runtime["last_job_id"],
            "execution_started_at": _runtime["last_execution_started"],
            "execution_completed_at": _runtime["last_execution_completed"],
            "execution_failed_at": _runtime["last_execution_failed"],
        },
        "last_submission": _runtime["last_submission"],
        "last_error": _runtime["last_error"],
        "execution_readiness": readiness,
        "configuration": {
            "auto_execute_testnet": (
                os.getenv("GRID_AUTO_EXECUTE_TESTNET", "true") or "true"
            ).strip().lower()
            not in {"0", "false", "no", "off"},
            "testnet_execution_amount_raw": os.getenv(
                "GRID_TESTNET_EXECUTION_AMOUNT_RAW", "1000000000000000000"
            ),
            "pancake_pool_fee": int(os.getenv("PANCAKE_TESTNET_POOL_FEE", "2500")),
            "pancake_router": os.getenv("PANCAKE_TESTNET_ROUTER"),
            "token_in": os.getenv("GRID_DEFAULT_TOKEN_IN"),
            "token_out": os.getenv("GRID_DEFAULT_TOKEN_OUT"),
        },
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
