"""Public service for the standalone Grid Agent.

Grid can be used directly by users or through an external hiring protocol such
as ERC-8183. AgentMarket is not a runtime dependency and is not part of the
agent's public contract.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response

from bnbagent import EVMWalletProvider
from bnbagent.erc8183 import ERC8183JobOps, funded_job_watcher
from bnbagent.storage import LocalStorageProvider

from app.agent.main import AGENT_ID, AGENT_VERSION, fulfill_grid_job, fulfill_user_task
from app.service.config import validate_runtime_config

logger = logging.getLogger("grid_agent")
config = validate_runtime_config()

_STORAGE_DIR = Path(os.getenv("STORAGE_LOCAL_PATH") or ".agent-data")
_TASK_DIR = _STORAGE_DIR / "tasks"
_EXECUTION_INTERNAL_URL = (
    os.getenv("GRID_EXECUTION_INTERNAL_URL") or "http://127.0.0.1:8788"
).rstrip("/")
_EXECUTION_CAPITAL_WINDOW_SECONDS = max(
    0,
    int(float(os.getenv("ERC8183_EXECUTION_CAPITAL_WINDOW_SECONDS") or "3600")),
)

_ERC8183_ENABLED = bool(config["erc8183_enabled"])
_wallet: EVMWalletProvider | None = None
_ops: ERC8183JobOps | None = None

if _ERC8183_ENABLED:
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
    if _ops is not None:
        return str(_ops.agent_address)
    return str(os.getenv("AGENT_PUBLIC_ADDRESS") or "unregistered")


def _payment_token() -> str | None:
    if _ops is None:
        return None
    try:
        return str(_ops.erc8183_client.payment_token)
    except Exception:
        return None


def _public_identity() -> dict[str, Any]:
    return {
        "id": AGENT_ID,
        "version": AGENT_VERSION,
        "name": "Grid Agent",
        "description": "Standalone BSC Testnet grid-strategy agent with optional scoped execution support.",
        "network": "bsc-testnet",
        "chain_id": 97,
        "capabilities": ["grid-strategy", "erc-8183-provider", "scoped-execution"],
        "protocols": ["pancake-v3", "erc-8183"],
        "direct_interface": {
            "capabilities": "/v1/capabilities",
            "quote": "/v1/quote",
            "tasks": "/v1/tasks",
            "task": "/v1/tasks/{task_id}",
        },
        "erc8183_interface": {
            "enabled": _ERC8183_ENABLED,
            "root": "/erc8183",
        },
    }


def _require_erc8183() -> None:
    if not _ERC8183_ENABLED or _ops is None:
        raise HTTPException(status_code=404, detail="ERC-8183 provider interface is disabled for this deployment")


_funded_first_seen: dict[int, float] = {}


async def _on_funded(job: dict[str, Any]) -> None:
    if _ops is None:
        return
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
            return
        _funded_first_seen.pop(job_id_int, None)

    logger.info(
        "ERC8183_EXECUTION_STARTED job_id=%s provider=%s network=%s chain_id=97",
        job_id_int,
        _provider_address(),
        config["network"],
    )
    try:
        deliverable = fulfill_grid_job(job)
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
        logger.exception("ERC8183_EXECUTION_FAILED job_id=%s provider=%s", job_id_int, _provider_address())
        raise


def _save_task(task: dict[str, Any]) -> None:
    _TASK_DIR.mkdir(parents=True, exist_ok=True)
    task_id = str(task["task_id"])
    (_TASK_DIR / f"{task_id}.json").write_text(
        json.dumps(task, separators=(",", ":")), encoding="utf-8"
    )


def _load_task(task_id: str) -> dict[str, Any]:
    try:
        return json.loads((_TASK_DIR / f"{task_id}.json").read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Stored task is invalid") from exc


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
    except httpx.HTTPError as exc:
        logger.exception("Grid execution upstream unavailable")
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
    _TASK_DIR.mkdir(parents=True, exist_ok=True)
    if _ERC8183_ENABLED and _ops is not None:
        logger.info(
            "ERC8183_WATCHER_STARTING provider=%s network=%s chain_id=97 poll_interval=%s",
            _provider_address(),
            config["network"],
            config["poll_interval"],
        )
        _watcher_task = asyncio.create_task(
            funded_job_watcher(_ops, _on_funded, interval=config["poll_interval"])
        )
    else:
        logger.info("ERC8183_DISABLED direct_user_mode=true network=%s chain_id=97", config["network"])
    try:
        yield
    finally:
        if _watcher_task is not None:
            _watcher_task.cancel()
            await asyncio.gather(_watcher_task, return_exceptions=True)
        logger.info("GRID_AGENT_STOPPED provider=%s network=%s chain_id=97", _provider_address(), config["network"])


app = FastAPI(
    title="Grid Agent",
    description="Standalone BSC Testnet grid-strategy agent with optional ERC-8183 and scoped execution interfaces.",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", **_public_identity()}


@app.get("/v1/capabilities")
async def capabilities() -> dict[str, Any]:
    return {
        **_public_identity(),
        "provider_address": _provider_address(),
        "pricing": {
            "erc8183_service_price_raw": config["service_price"] if _ERC8183_ENABLED else None,
            "payment_token": _payment_token(),
        },
        "execution": {
            "strategy_only": True,
            "scoped_execution_available": True,
            "execution_capabilities": "/v1/execution-capabilities",
            "preflight": "/v1/preflight/pancake",
            "execute": "/v1/execute",
            "receipt": "/v1/receipt/{transaction_hash}",
        },
    }


@app.post("/v1/quote")
async def quote(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Request body must be an object")
    description = body.get("task_description") or body.get("description") or ""
    if not isinstance(description, str):
        raise HTTPException(status_code=400, detail="task_description must be a string")
    return {
        "accepted": True,
        "quote_id": str(uuid.uuid4()),
        "agent": _public_identity(),
        "price": str(config["service_price"]) if _ERC8183_ENABLED else None,
        "currency": _payment_token() if _ERC8183_ENABLED else None,
        "quote_mode": "erc-8183" if _ERC8183_ENABLED else "direct-task",
        "chain_id": 97,
        "network": "bsc-testnet",
        "quote_expires_at": int(time.time()) + 300,
        "task_description": description,
    }


@app.post("/v1/tasks")
async def create_direct_task(request: Request) -> dict[str, Any]:
    """Process one direct user task without AgentMarket or ERC-8183."""
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Request body must be an object")

    task_id = str(body.get("task_id") or uuid.uuid4())
    params = body.get("params") if isinstance(body.get("params"), dict) else body.get("parameters")
    task: dict[str, Any] = {
        "task_id": task_id,
        "description": body.get("description") or body.get("task_description") or "",
        "params": params if isinstance(params, dict) else {},
        "created_at": int(time.time()),
        "status": "processing",
    }
    if not isinstance(task["description"], str):
        raise HTTPException(status_code=400, detail="description must be a string")

    try:
        result = fulfill_user_task(task)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    task["status"] = "completed"
    task["result"] = result
    _save_task(task)
    return {"ok": True, "task_id": task_id, "status": "completed", "agent": _public_identity(), "result": result}


@app.get("/v1/tasks/{task_id}")
async def get_direct_task(task_id: str) -> dict[str, Any]:
    return _load_task(task_id)


@app.get("/erc8183")
async def erc8183_root() -> dict[str, Any]:
    _require_erc8183()
    return {
        "status": "ok",
        "service": "Grid Agent ERC-8183 Provider",
        "network": "bsc-testnet",
        "chain_id": 97,
        "agent_address": _provider_address(),
        "agent_id": AGENT_ID,
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
    _require_erc8183()
    return {"status": "ok", "service": "Grid Agent ERC-8183 Provider", "network": "bsc-testnet", "chain_id": 97}


@app.get("/erc8183/status")
async def erc8183_status() -> dict[str, Any]:
    _require_erc8183()
    assert _ops is not None
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


@app.post("/erc8183/negotiate")
async def negotiate(request: Request) -> dict[str, Any]:
    _require_erc8183()
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Request body must be an object")
    task_description = body.get("task_description")
    if task_description is not None and not isinstance(task_description, str):
        raise HTTPException(status_code=400, detail="task_description must be a string")
    return {
        "accepted": True,
        "quote_id": str(uuid.uuid4()),
        "price": str(config["service_price"]),
        "currency": _payment_token() or "testnet-settlement-token",
        "quote_expires_at": int(time.time()) + 300,
        "chain_id": 97,
        "network": "bsc-testnet",
        "environment": "testnet",
        "provider_address": _provider_address(),
        "task_description": task_description or "",
    }


@app.get("/v1/execution-capabilities")
async def direct_execution_capabilities(request: Request) -> Response:
    return await _proxy_execution(request, "/execution-capabilities")


@app.post("/v1/preflight/pancake")
async def direct_pancake_preflight(request: Request) -> Response:
    return await _proxy_execution(request, "/preflight/pancake")


@app.post("/v1/execute")
async def direct_execute(request: Request) -> Response:
    return await _proxy_execution(request, "/execute")


@app.get("/v1/receipt/{transaction_hash}")
async def direct_execution_receipt(transaction_hash: str, request: Request) -> Response:
    return await _proxy_execution(request, f"/receipt/{transaction_hash}")


@app.get("/erc8183/execution-capabilities")
async def execution_capabilities(request: Request) -> Response:
    _require_erc8183()
    return await _proxy_execution(request, "/execution-capabilities")


@app.get("/erc8183/execution-health")
async def execution_health(request: Request) -> Response:
    _require_erc8183()
    return await _proxy_execution(request, "/health")


@app.post("/erc8183/preflight/pancake")
async def pancake_preflight(request: Request) -> Response:
    _require_erc8183()
    return await _proxy_execution(request, "/preflight/pancake")


@app.post("/erc8183/execute")
async def execute(request: Request) -> Response:
    _require_erc8183()
    return await _proxy_execution(request, "/execute")


@app.get("/erc8183/receipt/{transaction_hash}")
async def execution_receipt(transaction_hash: str, request: Request) -> Response:
    _require_erc8183()
    return await _proxy_execution(request, f"/receipt/{transaction_hash}")


@app.get("/erc8183/job/{job_id}/response")
async def job_response(job_id: int) -> Response:
    _require_erc8183()
    filepath = _STORAGE_DIR / f"erc8183-job-{job_id}.json"
    try:
        content = filepath.read_bytes()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="No deliverable found for this job") from exc
    return Response(content=content, media_type="application/json")
