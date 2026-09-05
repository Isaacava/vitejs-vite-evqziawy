"""Standalone ERC-8183 provider service for a first-party AgentMarket agent."""
from __future__ import annotations

import asyncio, importlib, json, logging, os, time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.request import Request as UrlRequest, urlopen
from urllib.parse import urlencode

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from bnbagent import EVMWalletProvider
from bnbagent.erc8183 import ERC8183JobOps, funded_job_watcher
from bnbagent.storage import LocalStorageProvider
from app.service.config import validate_runtime_config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
KIND = os.getenv("AGENT_KIND", "defi_agent").strip().lower()
DISPLAY_NAME = os.getenv("AGENT_DISPLAY_NAME", KIND.replace("_", " ").title())
config = validate_runtime_config()
NETWORK = config["network"]
CHAIN_ID = 97
SERVICE_PRICE = config["service_price"]
POLL_INTERVAL = config["poll_interval"]
STORAGE_DIR = Path(os.getenv("STORAGE_LOCAL_PATH") or ".agent-data")
EXECUTION_URL = os.getenv("ALTANA_EXECUTION_INTERNAL_URL", "http://127.0.0.1:8788").rstrip("/")

_wallet = EVMWalletProvider(
    password=os.environ["WALLET_PASSWORD"],
    private_key=os.environ.get("PRIVATE_KEY"),
)
_storage = LocalStorageProvider(base_dir=str(STORAGE_DIR))
_ops = ERC8183JobOps(
    _wallet,
    network=NETWORK,
    storage_provider=_storage,
    service_price=SERVICE_PRICE,
    agent_url=config["endpoint"],
)
_runtime: dict[str, Any] = {
    "watcher_started_at": None,
    "last_funded_job": None,
    "last_decision": None,
    "last_execution": None,
    "last_submission": None,
    "last_error": None,
}


def provider_address() -> str:
    return str(_ops.agent_address)


def payment_token() -> str | None:
    try:
        return str(_ops.erc8183_client.payment_token)
    except Exception:
        return None


def pending_path(job_id: int) -> Path:
    return STORAGE_DIR / f"erc8183-pending-submission-{job_id}.json"


def response_path(job_id: int) -> Path:
    return STORAGE_DIR / f"erc8183-job-{job_id}.json"


def decision_path(job_id: int) -> Path:
    return STORAGE_DIR / f"erc8183-decision-{job_id}.json"


def authorization_path(job_id: int) -> Path:
    return STORAGE_DIR / f"erc8183-authorization-{job_id}.json"


def save_decision(job_id: int, job: dict[str, Any], decision: dict[str, Any]) -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    decision_path(job_id).write_text(
        json.dumps({"job": job, "decision": decision, "updated_at": int(time.time())}, separators=(",", ":")),
        encoding="utf-8",
    )
    _runtime["last_decision"] = {"timestamp": int(time.time()), "job_id": job_id, **decision}


def load_decision_context(job_id: int) -> tuple[dict[str, Any], dict[str, Any]] | None:
    try:
        payload = json.loads(decision_path(job_id).read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    job = payload.get("job")
    decision = payload.get("decision")
    if not isinstance(job, dict) or not isinstance(decision, dict):
        return None
    return job, decision


def save_authorization(job_id: int, authorization: dict[str, Any]) -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    authorization_path(job_id).write_text(
        json.dumps({"job_id": job_id, "authorization": authorization, "updated_at": int(time.time())}, separators=(",", ":")),
        encoding="utf-8",
    )


def load_authorization(job_id: int) -> dict[str, Any] | None:
    try:
        payload = json.loads(authorization_path(job_id).read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    authorization = payload.get("authorization") if isinstance(payload, dict) else None
    return authorization if isinstance(authorization, dict) else None


def with_authorization(job: dict[str, Any], authorization: dict[str, Any]) -> dict[str, Any]:
    updated = dict(job)
    metadata = _obj(job.get("metadata"))
    metadata["execution_authorization"] = authorization
    if authorization.get("execution_wallet"):
        metadata["wallet_address"] = authorization["execution_wallet"]
    updated["metadata"] = json.dumps(metadata, separators=(",", ":"))
    return updated


def save_pending(job_id: int, deliverable: str, metadata: dict[str, Any]) -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    pending_path(job_id).write_text(
        json.dumps({"job_id": job_id, "deliverable": deliverable, "metadata": metadata}, separators=(",", ":")),
        encoding="utf-8",
    )


def save_response(job_id: int, deliverable: str, metadata: dict[str, Any], tx_hash: str | None) -> None:
    """Persist the provider response under the standard Agent SDK response path."""
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    response_path(job_id).write_text(
        json.dumps(
            {"job_id": job_id, "deliverable": deliverable, "metadata": metadata, "transaction_hash": tx_hash, "submitted_at": int(time.time())},
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )


def load_pending(job_id: int):
    try:
        payload = json.loads(pending_path(job_id).read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or int(payload.get("job_id", -1)) != job_id:
        return None
    deliverable, metadata = payload.get("deliverable"), payload.get("metadata")
    return (deliverable, metadata) if isinstance(deliverable, str) and isinstance(metadata, dict) else None


def clear_pending(job_id: int) -> None:
    try:
        pending_path(job_id).unlink()
    except FileNotFoundError:
        pass


def _obj(value: Any) -> dict[str, Any]:
    if isinstance(value, dict): return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _job_provider(job: dict[str, Any]) -> str:
    for key in ("provider", "providerAddress", "provider_address"):
        value = job.get(key)
        if value is not None and str(value).strip(): return str(value).strip()
    return ""


def _is_funded(job: dict[str, Any]) -> bool:
    value = job.get("status")
    if isinstance(value, str):
        text = value.strip().upper()
        if text == "FUNDED": return True
        try: return int(text) == 1
        except ValueError: return False
    try: return int(value) == 1
    except (TypeError, ValueError): return False


def _job_matches_agent(job: dict[str, Any], has_pending: bool = False) -> bool:
    if has_pending: return True
    assigned = _job_provider(job)
    if not assigned:
        logging.warning("%s funded job=%s has no provider assignment in watcher payload; refusing to execute", DISPLAY_NAME, job.get("jobId"))
        return False
    return assigned.lower() == provider_address().lower()


async def submit(job_id: int, deliverable: str, metadata: dict[str, Any], job: dict[str, Any]):
    if not _is_funded(job): raise RuntimeError(f"ERC-8183 job {job_id} is not FUNDED; refusing submission")
    save_pending(job_id, deliverable, metadata)
    result = await _ops.submit_result(job_id, deliverable)
    tx_hash = getattr(result, "hash", None)
    if tx_hash is None and isinstance(result, dict): tx_hash = result.get("hash") or result.get("tx_hash")
    if tx_hash is None and isinstance(result, str): tx_hash = result
    tx_hash = str(tx_hash) if tx_hash else None
    try: save_response(job_id, deliverable, metadata, tx_hash)
    except Exception: logging.exception("%s submitted job=%s but could not persist the response artifact", DISPLAY_NAME, job_id)
    clear_pending(job_id)
    return tx_hash


async def on_funded(job: dict[str, Any]) -> None:
    try: job_id = int(job.get("jobId"))
    except (TypeError, ValueError): logging.warning("%s funded callback missing valid jobId", DISPLAY_NAME); return
    if not _is_funded(job):
        logging.warning("%s received non-FUNDED callback job=%s status=%r; ignoring", DISPLAY_NAME, job_id, job.get("status")); return
    _runtime["last_funded_job"] = {"timestamp": int(time.time()), "job_id": job_id}
    pending = load_pending(job_id)
    if not _job_matches_agent(job, has_pending=pending is not None):
        logging.info("%s ignoring funded job=%s because on-chain provider does not match this agent", DISPLAY_NAME, job_id); return
    try:
        module = importlib.import_module("app.agent.main")
        decision = await asyncio.to_thread(module.decide_job, job)
        save_decision(job_id, job, decision)
        if bool(decision.get("execution_required")):
            authorization = load_authorization(job_id)
            if not authorization:
                _runtime["last_execution"] = {"timestamp": int(time.time()), "job_id": job_id, "status": "awaiting_authorization", "decision": decision.get("decision", {}).get("action")}
                _runtime["last_error"] = None
                logging.info("%s job=%s decision=%s requires job-scoped authorization; waiting", DISPLAY_NAME, job_id, decision.get("decision", {}).get("action"))
                return
            job = with_authorization(job, authorization)
        if pending is not None and not bool(decision.get("execution_required")):
            deliverable, metadata = pending
        else:
            deliverable, metadata = await asyncio.to_thread(module.fulfill_job, job)
        status = str(metadata.get("execution_status") or "").lower()
        decision_action = str(metadata.get("decision") or decision.get("decision", {}).get("action") or "").lower()
        if status not in {"observed", "executed"}:
            raise RuntimeError("Rebalancing agent did not produce an accepted terminal execution status")
        if decision_action in {"move_range", "widen"} and status != "executed":
            raise RuntimeError(f"Rebalancing decision '{decision_action}' requires successful execution before ERC-8183 submission")
        if status == "executed" and not metadata.get("transaction_hash"):
            raise RuntimeError("Rebalancing execution reported executed but no transaction hash was returned; refusing submission")
        _runtime["last_execution"] = {"timestamp": int(time.time()), "job_id": job_id, "status": status, "tx_hash": metadata.get("transaction_hash"), "decision": decision_action}
        tx_hash = await submit(job_id, deliverable, metadata, job)
        _runtime["last_submission"] = {"timestamp": int(time.time()), "job_id": job_id, "tx_hash": tx_hash}
        _runtime["last_error"] = None
    except Exception as exc:
        _runtime["last_error"] = {"timestamp": int(time.time()), "job_id": job_id, "error": str(exc)}
        logging.error("%s job=%s not submitted: %s", DISPLAY_NAME, job_id, exc)


def proxy_get(path: str, query: dict[str, str] | None = None) -> dict[str, Any]:
    url = EXECUTION_URL + path
    if query: url += ("&" if "?" in url else "?") + urlencode({k: v for k, v in query.items() if v})
    with urlopen(url, timeout=float(os.getenv("ALTANA_EXECUTION_TIMEOUT", "10"))) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict): raise RuntimeError("Altana execution service returned invalid response")
    return payload


def proxy_post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    request = UrlRequest(EXECUTION_URL + path, data=json.dumps(body).encode("utf-8"), headers={"content-type": "application/json"}, method="POST")
    with urlopen(request, timeout=float(os.getenv("ALTANA_EXECUTION_TIMEOUT", "30"))) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict): raise RuntimeError("Altana execution service returned invalid response")
    if payload.get("error"): raise RuntimeError(str(payload["error"]))
    return payload


_watcher_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _watcher_task
    _runtime["watcher_started_at"] = int(time.time())
    logging.info("%s watcher starting provider=%s network=%s chain_id=%s poll=%ss", DISPLAY_NAME, provider_address(), NETWORK, CHAIN_ID, POLL_INTERVAL)
    _watcher_task = asyncio.create_task(funded_job_watcher(_ops, on_funded, interval=POLL_INTERVAL))
    try: yield
    finally:
        if _watcher_task is not None:
            _watcher_task.cancel()
            await asyncio.gather(_watcher_task, return_exceptions=True)


app = FastAPI(title=f"{DISPLAY_NAME} Agent", description=f"Standalone Testnet-only ERC-8183 {DISPLAY_NAME} provider", lifespan=lifespan)


@app.get("/health")
async def health(): return {"status": "ok", "agent": KIND, "network": NETWORK, "chain_id": CHAIN_ID}


@app.get("/erc8183")
async def root():
    return {"status": "ok", "service": f"{DISPLAY_NAME} ERC-8183 provider", "agent_kind": KIND, "network": NETWORK, "chain_id": CHAIN_ID, "agent_address": provider_address(), "endpoints": {"health": "/erc8183/health", "status": "/erc8183/status", "runtime_status": "/erc8183/runtime-status", "decision": "/erc8183/job/{job_id}/decision", "authorization": "/erc8183/job/{job_id}/execution-authorization", "negotiate": "/erc8183/negotiate", "execution_capabilities": "/erc8183/execution-capabilities", "preflight": "/erc8183/preflight", "job_response": "/erc8183/job/{job_id}/response"}}


@app.get("/erc8183/health")
async def erc_health(): return {"status": "ok", "service": DISPLAY_NAME, "network": NETWORK, "chain_id": CHAIN_ID}


@app.get("/erc8183/status")
async def status():
    return {"status": "ok", "agent_kind": KIND, "agent_address": provider_address(), "commerce_address": str(_ops.erc8183_client.commerce.address), "router_address": str(_ops.erc8183_client.router.address), "policy_address": str(_ops.erc8183_client.policy.address), "service_price": SERVICE_PRICE, "payment_token": payment_token(), "poll_interval": POLL_INTERVAL, "execution_service": EXECUTION_URL}


@app.get("/erc8183/runtime-status")
async def runtime():
    return {"status": "ok", "agent_kind": KIND, "agent_address": provider_address(), "watcher": {"created": _watcher_task is not None, "running": bool(_watcher_task and not _watcher_task.done()), "started_at": _runtime["watcher_started_at"], "poll_interval_seconds": POLL_INTERVAL}, "last_funded_job": _runtime["last_funded_job"], "last_decision": _runtime["last_decision"], "last_execution": _runtime["last_execution"], "last_submission": _runtime["last_submission"], "last_error": _runtime["last_error"]}


@app.get("/erc8183/job/{job_id}/decision")
async def job_decision(job_id: int):
    context = load_decision_context(job_id)
    if context is None: return JSONResponse({"error": "Decision not available yet; the funded job has not been observed by this provider"}, status_code=404)
    job, decision = context
    return {"ok": True, **decision, "provider_address": provider_address(), "job_id": job_id}


@app.post("/erc8183/job/{job_id}/execution-authorization")
async def receive_execution_authorization(job_id: int, request: Request):
    try: body = await request.json()
    except Exception as exc: raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    if not isinstance(body, dict): raise HTTPException(status_code=400, detail="Request body must be an object")
    authorization = body.get("execution_authorization") if isinstance(body.get("execution_authorization"), dict) else body
    if not isinstance(authorization, dict): raise HTTPException(status_code=400, detail="execution_authorization is required")
    context = load_decision_context(job_id)
    if context is None: raise HTTPException(status_code=404, detail="No funded-job decision context exists for this job")
    job, decision = context
    if not bool(decision.get("execution_required")): raise HTTPException(status_code=409, detail="This Rebalancing decision does not require execution authorization")
    try: capability = proxy_get("/execution-capabilities", {"job_id": str(job_id)})
    except Exception as exc: raise HTTPException(status_code=502, detail=f"Unable to validate execution capability: {exc}") from exc
    if str(authorization.get("session_key_address") or "").lower() != str(capability.get("session_key_address") or "").lower(): raise HTTPException(status_code=409, detail="Session key address does not match the provider-declared job capability")
    if str(authorization.get("session_key_public_key") or "").lower() != str(capability.get("session_key_public_key") or "").lower(): raise HTTPException(status_code=409, detail="Session key public key does not match the provider-declared job capability")
    wallet = str(authorization.get("execution_wallet") or authorization.get("wallet_address") or "").strip()
    if not wallet.startswith("0x") or len(wallet) != 42: raise HTTPException(status_code=409, detail="A valid execution wallet is required")
    authorization = {**authorization, "execution_wallet": wallet, "wallet_provider": "altana", "authorization_model": "scoped_session", "chain_id": CHAIN_ID, "session_binding": "erc8183_job_id"}
    save_authorization(job_id, authorization)
    asyncio.create_task(on_funded(job))
    return {"ok": True, "accepted": True, "job_id": job_id, "decision": decision, "execution_authorization": authorization}


@app.get("/erc8183/execution-capabilities")
async def execution_capabilities(request: Request):
    job_id = request.query_params.get("job_id") or request.query_params.get("jobId")
    if not job_id: return JSONResponse({"error": "job_id is required"}, status_code=400)
    try: return proxy_get("/execution-capabilities", {"job_id": job_id})
    except Exception as exc: raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/erc8183/job/{job_id}/response")
async def job_response(job_id: int):
    path = response_path(job_id)
    try: body = path.read_bytes()
    except FileNotFoundError: return JSONResponse({"error": "submitted response not found", "job_id": job_id}, status_code=404)
    except OSError as exc: return JSONResponse({"error": f"unable to read submitted response: {exc}", "job_id": job_id}, status_code=500)
    return Response(content=body, media_type="application/json", headers={"cache-control": "no-store"})


@app.post("/erc8183/preflight")
async def preflight(request: Request):
    try: body = await request.json()
    except Exception as exc: raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    if not isinstance(body, dict): raise HTTPException(status_code=400, detail="Request body must be an object")
    try: return proxy_post("/preflight", body)
    except Exception as exc: raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/erc8183/negotiate")
async def negotiate(request: Request):
    try: data = await request.json()
    except Exception as exc: raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    if not isinstance(data, dict): raise HTTPException(status_code=400, detail="Request body must be an object")
    return {"accepted": True, "quote_id": f"{KIND}-{int(time.time())}", "price": str(SERVICE_PRICE), "currency": payment_token() or "testnet-settlement-token", "quote_expires_at": int(time.time()) + 300, "chain_id": CHAIN_ID, "network": NETWORK, "environment": "testnet", "provider_address": provider_address(), "task_description": data.get("task_description") or "", "terms": data.get("terms") if isinstance(data.get("terms"), dict) else {}}
