"""Standalone ERC-8183 provider service for the Grid Agent."""

from __future__ import annotations

import asyncio
import importlib
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
from fastapi.responses import JSONResponse, Response

from bnbagent import EVMWalletProvider
from bnbagent.erc8183 import ERC8183JobOps, funded_job_watcher
from bnbagent.storage import LocalStorageProvider
from app.agent.main import fulfill_grid_job_with_execution
from app.service.config import validate_runtime_config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("grid_agent")
config = validate_runtime_config()

CAPABILITY_SCHEMA = {
    "type": "object",
    "inputs": [
        {"name": "lower_price", "required": True, "type": "number", "description": "Lower grid price."},
        {"name": "upper_price", "required": True, "type": "number", "description": "Upper grid price; must be greater than lower_price."},
        {"name": "grid_levels", "required": True, "type": "integer", "description": "Number of grid levels, from 2 to 100."},
        {"name": "notional", "required": True, "type": "number", "description": "Total Testnet settlement notional."},
        {"name": "max_slippage_bps", "required": False, "type": "integer", "default": 50, "description": "Maximum swap slippage in basis points; capped at 150."},
    ],
}

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
_waiting_authorization_until: dict[int, float] = {}


def _provider_address() -> str:
    return str(_ops.agent_address)


def _payment_token() -> str | None:
    try:
        return str(_ops.erc8183_client.payment_token)
    except Exception:
        return None


def _path(name: str, job_id: int) -> Path:
    return _STORAGE_DIR / f"erc8183-{name}-{job_id}.json"


def _pending_submission_path(job_id: int) -> Path:
    return _STORAGE_DIR / f"erc8183-pending-submission-{job_id}.json"


def _response_path(job_id: int) -> Path:
    return _STORAGE_DIR / f"erc8183-job-{job_id}.json"


def _save_pending_submission(job_id: int, deliverable: str, metadata: dict[str, Any]) -> None:
    _STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    _pending_submission_path(job_id).write_text(
        json.dumps({"job_id": job_id, "deliverable": deliverable, "metadata": metadata}, separators=(",", ":")),
        encoding="utf-8",
    )


def _save_response(job_id: int, deliverable: str, metadata: dict[str, Any], tx_hash: str | None) -> None:
    _STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    _response_path(job_id).write_text(
        json.dumps({"job_id": job_id, "deliverable": deliverable, "metadata": metadata, "transaction_hash": tx_hash, "submitted_at": int(time.time())}, separators=(",", ":")),
        encoding="utf-8",
    )


def _load_pending_submission(job_id: int) -> tuple[str, dict[str, Any]] | None:
    try:
        payload = json.loads(_pending_submission_path(job_id).read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or int(payload.get("job_id", -1)) != job_id:
        return None
    deliverable, metadata = payload.get("deliverable"), payload.get("metadata")
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


def _authorization_path(job_id: int) -> Path:
    return _path("authorization", job_id)


def _decision_path(job_id: int) -> Path:
    return _path("decision", job_id)


def _save_decision(job_id: int, job: dict[str, Any], decision: dict[str, Any]) -> None:
    _STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    _decision_path(job_id).write_text(
        json.dumps({"job": job, "decision": decision, "updated_at": int(time.time())}, separators=(",", ":")),
        encoding="utf-8",
    )


def _load_decision(job_id: int) -> tuple[dict[str, Any], dict[str, Any]] | None:
    try:
        payload = json.loads(_decision_path(job_id).read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    job = payload.get("job") if isinstance(payload, dict) else None
    decision = payload.get("decision") if isinstance(payload, dict) else None
    return (job, decision) if isinstance(job, dict) and isinstance(decision, dict) else None


def _save_authorization(job_id: int, authorization: dict[str, Any]) -> None:
    _STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    _authorization_path(job_id).write_text(
        json.dumps({"job_id": job_id, "authorization": authorization, "updated_at": int(time.time())}, separators=(",", ":")),
        encoding="utf-8",
    )


def _load_authorization(job_id: int) -> dict[str, Any] | None:
    try:
        payload = json.loads(_authorization_path(job_id).read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    authorization = payload.get("authorization") if isinstance(payload, dict) else None
    return authorization if isinstance(authorization, dict) else None


def _obj(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _valid_address(value: Any) -> bool:
    return isinstance(value, str) and value.strip().startswith("0x") and len(value.strip()) == 42


def _with_authorization(job: dict[str, Any], authorization: dict[str, Any]) -> dict[str, Any]:
    updated = dict(job)
    metadata = _obj(job.get("metadata"))
    metadata["execution_authorization"] = authorization
    if authorization.get("execution_wallet"):
        metadata["wallet_address"] = authorization["execution_wallet"]
    updated["metadata"] = json.dumps(metadata, separators=(",", ":"))
    return updated


async def _submit(job_id: int, deliverable: str, metadata: dict[str, Any]) -> str | None:
    _save_pending_submission(job_id, deliverable, metadata)
    try:
        submission = await _ops.submit_result(job_id, deliverable)
    except Exception:
        logger.exception("ERC-8183 submission failed job_id=%s", job_id)
        raise
    tx_hash = _submission_hash(submission)
    try:
        _save_response(job_id, deliverable, metadata, tx_hash)
    except Exception:
        logger.exception("ERC-8183 response persistence failed after successful submit job_id=%s", job_id)
    _clear_pending_submission(job_id)
    return tx_hash


def _is_waiting_authorization_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return "authorization" in text or "execution wallet" in text or "allowance" in text


async def _on_funded(job: dict[str, Any]) -> None:
    raw_job_id = job.get("jobId")
    try:
        job_id = int(raw_job_id)
    except (TypeError, ValueError):
        logger.warning("Funded job callback received invalid jobId=%r", raw_job_id)
        return
    now = time.time()
    wait_until = _waiting_authorization_until.get(job_id, 0.0)
    if wait_until > now:
        logger.info("ERC8183_WAITING_FOR_USER_AUTHORIZATION job_id=%s retry_in=%ss", job_id, max(1, int(wait_until - now)))
        return
    _waiting_authorization_until.pop(job_id, None)
    _runtime["last_funded_job_observed"] = int(now)
    _runtime["last_job_id"] = job_id
    logger.info("ERC8183_FUNDED_JOB_OBSERVED job_id=%s provider=%s network=%s chain_id=97 poll_interval=%s", job_id, _provider_address(), config["network"], config["poll_interval"])
    try:
        pending = _load_pending_submission(job_id)
        if pending is not None:
            deliverable, metadata = pending
            tx_hash = await _submit(job_id, deliverable, metadata)
            _runtime["last_submission"] = {"timestamp": int(time.time()), "job_id": job_id, "tx_hash": tx_hash}
            _runtime["last_error"] = None
            return

        module = importlib.import_module("app.agent.main")
        authorization = _load_authorization(job_id)
        execution_job = _with_authorization(job, authorization) if authorization else job
        _runtime["last_execution_started"] = int(time.time())
        logger.info(
            "ERC8183_AGENT_EXECUTION_STARTED job_id=%s provider=%s network=%s chain_id=97 authorization=%s",
            job_id,
            _provider_address(),
            config["network"],
            "present" if authorization else "absent",
        )
        deliverable, metadata = await module.fulfill_grid_job_with_execution(execution_job)
        execution_status = str(metadata.get("execution_status") or "").lower()
        transaction_hash = str(metadata.get("transaction_hash") or "")
        if execution_status != "executed" or not transaction_hash:
            raise RuntimeError(f"Grid execution did not produce successful execution evidence for job {job_id}; execution_status={execution_status or 'unknown'}")
        _runtime["last_execution_completed"] = int(time.time())
        tx_hash = await _submit(job_id, deliverable, metadata)
        _runtime["last_submission"] = {"timestamp": int(time.time()), "job_id": job_id, "tx_hash": tx_hash}
        _runtime["last_error"] = None
        logger.info("ERC8183_SUBMISSION_CONFIRMED job_id=%s provider=%s tx_hash=%s network=%s chain_id=97", job_id, _provider_address(), tx_hash or "unknown", config["network"],)
    except ValueError as exc:
        message = str(exc)
        if message.startswith(("Grid range must", "grid_levels must", "notional must", "max_slippage_bps")):
            _runtime["last_execution_failed"] = int(time.time())
            _runtime["last_error"] = message
            logger.error("ERC8183_FUNDED_JOB_SKIPPED_INVALID_PARAMETERS job_id=%s provider=%s reason=%s", job_id, _provider_address(), message)
            return
        raise
    except Exception as exc:
        _runtime["last_execution_failed"] = int(time.time())
        _runtime["last_error"] = str(exc)
        if _is_waiting_authorization_error(exc):
            retry_seconds = max(120, min(600, int(config["poll_interval"]) * 10))
            _waiting_authorization_until[job_id] = time.time() + retry_seconds
            logger.warning("ERC8183_WAITING_FOR_USER_AUTHORIZATION job_id=%s provider=%s retry_in=%ss reason=%s", job_id, _provider_address(), retry_seconds, str(exc))
            return
        logger.exception("ERC8183_AGENT_EXECUTION_FAILED job_id=%s provider=%s network=%s chain_id=97", job_id, _provider_address(), config["network"])
        raise


async def _proxy_execution(request: Request, endpoint: str, method: str | None = None) -> Response:
    upstream_method = method or request.method
    body = None if upstream_method in {"GET", "HEAD"} else await request.body()
    headers: dict[str, str] = {}
    for name in ("authorization", "content-type", "accept"):
        value = request.headers.get(name)
        if value:
            headers[name] = value
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            upstream = await client.request(upstream_method, f"{_EXECUTION_INTERNAL_URL}{endpoint}", headers=headers, content=body)
    except httpx.HTTPError as exc:
        logger.exception("Grid local execution service unavailable")
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
    _runtime["watcher_started_at"] = int(time.time())
    logger.info("ERC8183_WATCHER_STARTING provider=%s network=%s chain_id=97 poll_interval=%s", _provider_address(), config["network"], config["poll_interval"])
    _watcher_task = asyncio.create_task(funded_job_watcher(_ops, _on_funded, interval=config["poll_interval"]))
    try:
        yield
    finally:
        if _watcher_task is not None:
            _watcher_task.cancel()
            await asyncio.gather(_watcher_task, return_exceptions=True)
        logger.info("ERC8183_WATCHER_STOPPED provider=%s network=%s chain_id=97", _provider_address(), config["network"])


app = FastAPI(title="Grid Agent", description="Standalone Testnet-only ERC-8183 Grid Agent provider", lifespan=lifespan)
_cors_origin = os.getenv("GRID_CORS_ORIGIN") or "*"
app.add_middleware(CORSMiddleware, allow_origins=[_cors_origin] if _cors_origin != "*" else ["*"], allow_credentials=_cors_origin != "*", allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])


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
            "execution_authorization": "/erc8183/job/{job_id}/execution-authorization",
            "execution_health": "/erc8183/execution-health",
            "preflight_pancake": "/erc8183/preflight/pancake",
            "execute": "/erc8183/execute",
            "receipt": "/erc8183/receipt/{transaction_hash}",
            "job_response": "/erc8183/job/{job_id}/response",
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
        "waiting_for_user_authorization": {str(job_id): max(0, int(until - time.time())) for job_id, until in _waiting_authorization_until.items() if until > time.time()},
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


@app.post("/erc8183/job/{job_id}/execution-authorization")
async def execution_authorization(job_id: int, request: Request) -> dict[str, Any]:
    if job_id <= 0:
        raise HTTPException(status_code=400, detail="job_id must be positive")
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Request body must be an object")

    authorization = body.get("execution_authorization") if isinstance(body.get("execution_authorization"), dict) else body
    if not isinstance(authorization, dict):
        raise HTTPException(status_code=400, detail="execution_authorization is required")

    execution_wallet = next(
        (authorization.get(key) for key in ("execution_wallet", "wallet_address", "wallet", "execution_wallet_address") if _valid_address(authorization.get(key))),
        None,
    )
    session_key = next(
        (authorization.get(key) for key in ("session_key_address", "agent_session_address") if _valid_address(authorization.get(key))),
        None,
    )
    session_public_key = next(
        (authorization.get(key) for key in ("session_key_public_key", "agent_session_public_key") if isinstance(authorization.get(key), str) and authorization.get(key).strip()),
        None,
    )
    if not execution_wallet:
        raise HTTPException(status_code=409, detail="A valid job-scoped execution wallet is required")
    if not session_key or not session_public_key:
        raise HTTPException(status_code=409, detail="A complete job-scoped execution session is required")

    try:
        capability_response = await _proxy_execution(request, f"/execution-capabilities?job_id={job_id}", method="GET")
        payload = json.loads(capability_response.body.decode("utf-8")) if isinstance(capability_response.body, (bytes, bytearray)) else {}
        if isinstance(payload, dict):
            expected_session = str(payload.get("session_key_address") or "")
            expected_public = str(payload.get("session_key_public_key") or "")
            if expected_session and session_key.lower() != expected_session.lower():
                raise HTTPException(status_code=409, detail="Session key address does not match provider-declared job capability")
            if expected_public and session_public_key.lower() != expected_public.lower():
                raise HTTPException(status_code=409, detail="Session key public key does not match provider-declared job capability")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Unable to validate execution capability: {exc}") from exc

    normalized = {
        **authorization,
        "execution_wallet": str(execution_wallet).strip(),
        "wallet_provider": "altana",
        "authorization_model": "scoped_session",
        "chain_id": 97,
        "session_binding": "erc8183_job_id",
    }
    _save_authorization(job_id, normalized)
    logger.info("ERC8183_JOB_AUTHORIZATION_RECEIVED job_id=%s wallet=%s", job_id, normalized["execution_wallet"])
    asyncio.create_task(_on_funded({"jobId": job_id, "status": "FUNDED"}))
    return {"ok": True, "accepted": True, "job_id": job_id, "execution_authorization": normalized}


@app.get("/erc8183/job/{job_id}/authorization")
async def job_authorization(job_id: int) -> dict[str, Any]:
    authorization = _load_authorization(job_id)
    if not authorization:
        raise HTTPException(status_code=404, detail="Execution authorization not available for this job")
    return {"ok": True, "job_id": job_id, "execution_authorization": authorization}


@app.get("/erc8183/job/{job_id}/response")
async def job_response(job_id: int) -> Response:
    filepath = _response_path(job_id)
    try:
        content = filepath.read_bytes()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="No deliverable found for this job") from exc
    return Response(content=content, media_type="application/json", headers={"cache-control": "no-store"})


@app.post("/erc8183/preflight/pancake")
async def pancake_preflight(request: Request) -> Response:
    return await _proxy_execution(request, "/preflight/pancake")


@app.post("/erc8183/execute")
async def execute(request: Request) -> Response:
    return await _proxy_execution(request, "/execute")


@app.get("/erc8183/receipt/{transaction_hash}")
async def execution_receipt(transaction_hash: str, request: Request) -> Response:
    return await _proxy_execution(request, f"/receipt/{transaction_hash}")


@app.get("/erc8183/execution-health")
async def execution_health(request: Request) -> Response:
    return await _proxy_execution(request, "/health")
