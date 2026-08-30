"""Standalone ERC-8183 provider service for the Grid Agent."""

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
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from bnbagent import EVMWalletProvider
from bnbagent.erc8183 import ERC8183JobOps, funded_job_watcher
from bnbagent.storage import LocalStorageProvider

from app.agent.main import fulfill_grid_job_with_execution
from app.service.config import validate_runtime_config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("grid_agent")
config = validate_runtime_config()

_STORAGE_DIR = Path(os.getenv("STORAGE_LOCAL_PATH") or ".agent-data")
_EXECUTION_INTERNAL_URL = (os.getenv("GRID_EXECUTION_INTERNAL_URL") or "http://127.0.0.1:8788").rstrip("/")

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

_runtime: dict[str, Any] = {
    "watcher_started_at": None,
    "last_funded_job_observed": None,
    "last_job_id": None,
    "last_execution_started": None,
    "last_execution_completed": None,
    "last_execution_failed": None,
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


def _pending_submission_path(job_id: int) -> Path:
    return _STORAGE_DIR / f"erc8183-pending-submission-{job_id}.json"


def _save_pending_submission(job_id: int, deliverable: str, metadata: dict[str, Any]) -> None:
    _STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    path = _pending_submission_path(job_id)
    path.write_text(json.dumps({"job_id": job_id, "deliverable": deliverable, "metadata": metadata}, separators=(",", ":")), encoding="utf-8")


def _load_pending_submission(job_id: int) -> tuple[str, dict[str, Any]] | None:
    path = _pending_submission_path(job_id)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or int(payload.get("job_id", -1)) != job_id:
        return None
    deliverable = payload.get("deliverable")
    metadata = payload.get("metadata")
    if not isinstance(deliverable, str) or not isinstance(metadata, dict):
        return None
    return deliverable, metadata


def _clear_pending_submission(job_id: int) -> None:
    try:
        _pending_submission_path(job_id).unlink()
    except FileNotFoundError:
        pass


def _submission_hash(submission: Any) -> str | None:
    if isinstance(submission, str):
        return submission
    if hasattr(submission, "hash"):
        return str(submission.hash)
    if isinstance(submission, dict):
        value = submission.get("hash") or submission.get("tx_hash")
        return str(value) if value else None
    return None


async def _submit(job_id: int, deliverable: str, metadata: dict[str, Any]) -> str | None:
    _save_pending_submission(job_id, deliverable, metadata)
    try:
        submission = await _ops.submit_result(job_id, deliverable)
    except Exception:
        logger.exception("ERC-8183 submission failed job_id=%s", job_id)
        raise
    tx_hash = _submission_hash(submission)
    _clear_pending_submission(job_id)
    return tx_hash


async def _on_funded(job: dict[str, Any]) -> None:
    raw_job_id = job.get("jobId")
    try:
        job_id = int(raw_job_id)
    except (TypeError, ValueError):
        logger.warning("Funded job callback received invalid jobId=%r", raw_job_id)
        return

    _runtime["last_funded_job_observed"] = int(time.time())
    _runtime["last_job_id"] = job_id
    logger.info(
        "ERC8183_FUNDED_JOB_OBSERVED job_id=%s provider=%s network=%s chain_id=97",
        job_id,
        _provider_address(),
        config["network"],
    )

    try:
        pending = _load_pending_submission(job_id)
        if pending is not None:
            deliverable, metadata = pending
            logger.info("ERC8183_PENDING_SUBMISSION_RETRY job_id=%s provider=%s", job_id, _provider_address())
            tx_hash = await _submit(job_id, deliverable, metadata)
            _runtime["last_submission"] = {"timestamp": int(time.time()), "job_id": job_id, "tx_hash": tx_hash}
            _runtime["last_error"] = None
            logger.info(
                "ERC8183_SUBMISSION_CONFIRMED job_id=%s provider=%s tx_hash=%s network=%s chain_id=97",
                job_id,
                _provider_address(),
                tx_hash or "unknown",
                config["network"],
            )
            return

        _runtime["last_execution_started"] = int(time.time())
        logger.info(
            "ERC8183_AGENT_EXECUTION_STARTED job_id=%s provider=%s network=%s chain_id=97",
            job_id,
            _provider_address(),
            config["network"],
        )
        deliverable, metadata = await fulfill_grid_job_with_execution(job)
        execution_status = str(metadata.get("execution_status") or "").lower()
        transaction_hash = str(metadata.get("transaction_hash") or "")
        if execution_status != "executed" or not transaction_hash:
            raise RuntimeError(
                f"Grid execution did not produce successful execution evidence for job {job_id}; execution_status={execution_status or 'unknown'}"
            )

        _runtime["last_execution_completed"] = int(time.time())
        logger.info(
            "ERC8183_AGENT_DELIVERABLE_GENERATED job_id=%s provider=%s execution_status=%s tx_hash=%s",
            job_id,
            _provider_address(),
            execution_status,
            transaction_hash,
        )

        tx_hash = await _submit(job_id, deliverable, metadata)
        _runtime["last_submission"] = {"timestamp": int(time.time()), "job_id": job_id, "tx_hash": tx_hash}
        _runtime["last_error"] = None
        logger.info(
            "ERC8183_SUBMISSION_CONFIRMED job_id=%s provider=%s tx_hash=%s network=%s chain_id=97",
            job_id,
            _provider_address(),
            tx_hash or "unknown",
            config["network"],
        )
    except Exception as exc:
        _runtime["last_execution_failed"] = int(time.time())
        _runtime["last_error"] = str(exc)
        logger.exception(
            "ERC8183_AGENT_EXECUTION_FAILED job_id=%s provider=%s network=%s chain_id=97",
            job_id,
            _provider_address(),
            config["network"],
        )
        raise


async def _proxy_execution(request: Request, endpoint: str) -> Response:
    body = None if request.method in {"GET", "HEAD"} else await request.body()
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
    except httpx.HTTPError as exc:
        logger.exception("Grid local execution service unavailable")
        raise HTTPException(status_code=503, detail="Grid execution service unavailable") from exc
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers={
            "content-type": upstream.headers.get("content-type", "application/json"),
            "cache-control": "no-store",
        },
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
    description="Standalone Testnet-only ERC-8183 Grid Agent provider",
    lifespan=lifespan,
)

_cors_origin = os.getenv("GRID_CORS_ORIGIN") or "*"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_cors_origin] if _cors_origin != "*" else ["*"],
    allow_credentials=_cors_origin != "*",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
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
    }


@app.get("/erc8183/runtime-status")
async def erc8183_runtime_status() -> dict[str, Any]:
    return {
        "status": "ok",
        "network": "bsc-testnet",
        "chain_id": 97,
        "provider": _provider_address(),
        "commerce_address": str(_ops.erc8183_client.commerce.address),
        "watcher": {
            "created": _watcher_task is not None,
            "running": bool(_watcher_task and not _watcher_task.done()),
            "done": bool(_watcher_task and _watcher_task.done()),
            "cancelled": bool(_watcher_task and _watcher_task.cancelled()),
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
    }


@app.post("/erc8183/negotiate")
async def negotiate(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    if not isinstance(data, dict):
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
        "task_description": data.get("task_description") or "",
        "terms": data.get("terms") if isinstance(data.get("terms"), dict) else {},
    }


@app.get("/erc8183/execution-capabilities")
async def execution_capabilities(request: Request) -> Response:
    return await _proxy_execution(request, "/execution-capabilities" + (("?" + request.url.query) if request.url.query else ""))


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
