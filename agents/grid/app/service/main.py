"""Public ERC-8183 service adapter for the first-party Grid Agent test runtime."""

from __future__ import annotations

import asyncio
import json
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
from app.service.config import validate_runtime_config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("grid_agent")
config = validate_runtime_config()

_STORAGE_DIR = Path(os.getenv("STORAGE_LOCAL_PATH") or ".agent-data")
_EXECUTION_INTERNAL_URL = (os.getenv("GRID_EXECUTION_INTERNAL_URL") or "http://127.0.0.1:8788").rstrip("/")

_wallet = EVMWalletProvider(password=os.environ["WALLET_PASSWORD"], private_key=os.environ.get("PRIVATE_KEY"))
_storage = LocalStorageProvider(base_dir=str(_STORAGE_DIR))
_ops = ERC8183JobOps(
    _wallet,
    network=config["network"],
    storage_provider=_storage,
    service_price=config["service_price"],
    agent_url=config["endpoint"],
)

_funded_seen: set[int] = set()
_runtime: dict[str, Any] = {
    "watcher_started_at": None,
    "last_funded_job_observed": None,
    "last_job_id": None,
    "last_submission": None,
    "last_error": None,
}


def _provider_address() -> str:
    return str(_ops.agent_address)


def _payment_token() -> str | None:
    try:
        return str(_ops.erc8183_client.payment_token)
    except Exception:
        return None


def _request_id(request: Request) -> str:
    return (request.headers.get("x-agentmarket-request-id") or "").strip()


async def _proxy_execution(request: Request, endpoint: str) -> Response:
    body = None if request.method in {"GET", "HEAD"} else await request.body()
    headers: dict[str, str] = {}
    for name in ("authorization", "content-type", "accept", "x-agentmarket-request-id"):
        value = request.headers.get(name)
        if value:
            headers[name] = value
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            upstream = await client.request(request.method, f"{_EXECUTION_INTERNAL_URL}{endpoint}", headers=headers, content=body)
    except httpx.HTTPError as exc:
        logger.exception("Grid execution upstream unavailable")
        raise HTTPException(status_code=503, detail="Grid execution service unavailable") from exc
    return Response(content=upstream.content, status_code=upstream.status_code, headers={"content-type": upstream.headers.get("content-type", "application/json"), "cache-control": "no-store"})


async def _on_funded(job: dict[str, Any]) -> None:
    raw_job_id = job.get("jobId")
    try:
        job_id = int(raw_job_id)
    except (TypeError, ValueError):
        logger.warning("Funded job callback received invalid jobId=%r", raw_job_id)
        return
    if job_id in _funded_seen:
        return
    _funded_seen.add(job_id)
    _runtime["last_funded_job_observed"] = int(time.time())
    _runtime["last_job_id"] = job_id
    logger.info(
        "ERC8183_FUNDED_JOB_WAITING_FOR_MARKETPLACE_EXECUTION job_id=%s provider=%s network=%s chain_id=97",
        job_id,
        _provider_address(),
        config["network"],
    )


_watcher_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _watcher_task
    _runtime["watcher_started_at"] = int(time.time())
    logger.info(
        "ERC8183_WATCHER_STARTING provider=%s network=%s chain_id=97 poll_interval=%s",
        _provider_address(),
        config["network"],
        config["poll_interval"],
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
            "runtime_status": "/erc8183/runtime-status",
            "negotiate": "/erc8183/negotiate",
            "execution_capabilities": "/erc8183/execution-capabilities",
            "execution_health": "/erc8183/execution-health",
            "preflight_pancake": "/erc8183/preflight/pancake",
            "execute": "/erc8183/execute",
            "submit_execution": "/erc8183/submit-execution",
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
    }


@app.get("/erc8183/runtime-status")
async def erc8183_runtime_status() -> dict[str, Any]:
    return {
        "status": "ok",
        "network": "bsc-testnet",
        "chain_id": 97,
        "provider": _provider_address(),
        "commerce_address": str(_ops.erc8183_client.commerce.address),
        "watcher": {"created": _watcher_task is not None, "running": bool(_watcher_task and not _watcher_task.done()), "done": bool(_watcher_task and _watcher_task.done()), "cancelled": bool(_watcher_task and _watcher_task.cancelled()), "started_at": _runtime["watcher_started_at"], "poll_interval_seconds": config["poll_interval"]},
        "last_job": {"funded_job_observed_at": _runtime["last_funded_job_observed"], "job_id": _runtime["last_job_id"]},
        "last_submission": _runtime["last_submission"],
        "last_error": _runtime["last_error"],
    }


@app.post("/erc8183/negotiate")
async def negotiate(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Request body must be an object")
    return {"accepted": True, "quote_id": f"grid-{int(time.time())}", "price": str(config["service_price"]), "currency": _payment_token() or "testnet-settlement-token", "quote_expires_at": int(time.time()) + 300, "chain_id": 97, "network": "bsc-testnet", "environment": "testnet", "provider_address": _provider_address(), "task_description": data.get("task_description") or "", "terms": data.get("terms") if isinstance(data.get("terms"), dict) else {}}


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


@app.post("/erc8183/submit-execution")
async def submit_execution(request: Request) -> dict[str, Any]:
    request_id = _request_id(request)
    if not request_id:
        raise HTTPException(status_code=400, detail="x-agentmarket-request-id is required")
    try:
        data = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Request body must be an object")
    try:
        job_id = int(data.get("job_id"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="job_id is required") from exc
    tx_hash = str(data.get("transaction_hash") or "").strip()
    if not (len(tx_hash) == 66 and tx_hash.startswith("0x") and all(ch in "0123456789abcdefABCDEF" for ch in tx_hash[2:])):
        raise HTTPException(status_code=400, detail="transaction_hash must be a 32-byte transaction hash")

    deliverable = json.dumps({
        "agent": "agentmarket-grid-test",
        "job_id": str(job_id),
        "execution": "agent_owned_testnet",
        "execution_result": {"status": "CONFIRMED", "transaction_hash": tx_hash},
        "request_id": request_id,
        "network": "bsc-testnet",
        "chain_id": 97,
        "note": "ERC-8183 deliverable generated from independently observed AgentMarket execution evidence.",
    }, separators=(",", ":"))
    try:
        submission = await _ops.submit_result(job_id, deliverable, metadata={"execution_status": "executed", "transaction_hash": tx_hash, "source": "agentmarket_execution_bridge", "request_id": request_id})
    except Exception as exc:
        logger.exception("ERC8183 submission failed job_id=%s request_id=%s", job_id, request_id)
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    submission_hash = None
    if isinstance(submission, str):
        submission_hash = submission
    elif hasattr(submission, "hash"):
        submission_hash = str(submission.hash)
    elif isinstance(submission, dict):
        submission_hash = submission.get("hash") or submission.get("tx_hash")
    _runtime["last_submission"] = {"timestamp": int(time.time()), "job_id": job_id, "tx_hash": submission_hash}
    logger.info("ERC8183_SUBMISSION_CONFIRMED job_id=%s provider=%s tx_hash=%s network=bsc-testnet chain_id=97", job_id, _provider_address(), submission_hash or "unknown")
    return {"ok": True, "job_id": job_id, "submission_tx_hash": submission_hash, "transaction_hash": tx_hash}


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
