from __future__ import annotations

import asyncio
import importlib
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException, Request as FastAPIRequest
from fastapi.responses import JSONResponse, Response
from bnbagent import EVMWalletProvider
from bnbagent.erc8183 import ERC8183JobOps, funded_job_watcher
from bnbagent.storage import LocalStorageProvider

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
KIND = os.getenv("AGENT_KIND", "agent").strip().lower()
DISPLAY_NAME = os.getenv("AGENT_DISPLAY_NAME", KIND.replace("_", " ").title()).strip()
NETWORK = "bsc-testnet"
CHAIN_ID = 97
SERVICE_PRICE = int(os.getenv("ERC8183_SERVICE_PRICE", "1000000000000000"))
POLL_INTERVAL = max(5, int(os.getenv("ERC8183_FUNDED_POLL_INTERVAL", "20")))
ENDPOINT = os.getenv("ERC8183_AGENT_URL", "").rstrip("/")
IMPL = os.environ["AGENT_IMPL_MODULE"]
STORAGE_DIR = Path(os.getenv("STORAGE_LOCAL_PATH") or f".agent-data-{KIND}")
EXECUTION_URL = os.getenv("ALTANA_EXECUTION_INTERNAL_URL", "http://127.0.0.1:8788").rstrip("/")

# The provider can boot before ERC-8004 wallet secrets are added in Render.
# A real private key is still required for on-chain hiring/settlement actions.
_wallet = EVMWalletProvider(password=os.getenv("WALLET_PASSWORD", f"agentmarket-{KIND}-bootstrap"), private_key=os.getenv("PRIVATE_KEY"))
_storage = LocalStorageProvider(base_dir=str(STORAGE_DIR))
_ops = ERC8183JobOps(_wallet, network=NETWORK, storage_provider=_storage, service_price=SERVICE_PRICE, agent_url=ENDPOINT or "https://invalid.local/erc8183")
_runtime = {"watcher_started_at": None, "last_funded_job": None, "last_decision": None, "last_execution": None, "last_submission": None, "last_error": None}

def provider_address() -> str: return str(_ops.agent_address)
def payment_token() -> str | None:
    try: return str(_ops.erc8183_client.payment_token)
    except Exception: return None

def _obj(value):
    if isinstance(value, dict): return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value); return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError: return {}
    return {}

def _provider(job):
    for key in ("provider", "providerAddress", "provider_address"):
        if str(job.get(key) or "").strip(): return str(job[key]).strip()
    return ""

def _funded(job):
    value = job.get("status")
    if isinstance(value, str):
        v = value.strip().upper()
        if v == "FUNDED": return True
        try: return int(v) == 1
        except ValueError: return False
    try: return int(value) == 1
    except (TypeError, ValueError): return False

def _matches(job):
    assigned = _provider(job)
    return bool(assigned) and assigned.lower() == provider_address().lower()

def _path(prefix, job_id): return STORAGE_DIR / f"erc8183-{prefix}-{job_id}.json"
def _save(prefix, job_id, payload):
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    _path(prefix, job_id).write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
def _load(prefix, job_id):
    try: payload = json.loads(_path(prefix, job_id).read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError): return None
    return payload if isinstance(payload, dict) else None

def _with_auth(job, auth):
    updated = dict(job); metadata = _obj(job.get("metadata")); metadata["execution_authorization"] = auth
    if auth.get("execution_wallet"): metadata["wallet_address"] = auth["execution_wallet"]
    updated["metadata"] = json.dumps(metadata, separators=(",", ":")); return updated

async def _submit(job_id, deliverable, metadata, job):
    if not _funded(job): raise RuntimeError("Job is not FUNDED")
    _save("pending-submission", job_id, {"job_id": job_id, "deliverable": deliverable, "metadata": metadata})
    result = await _ops.submit_result(job_id, deliverable)
    tx_hash = getattr(result, "hash", None) or (result.get("hash") if isinstance(result, dict) else None) or (result.get("tx_hash") if isinstance(result, dict) else None)
    tx_hash = str(tx_hash) if tx_hash else None
    _save("job", job_id, {"job_id": job_id, "deliverable": deliverable, "metadata": metadata, "transaction_hash": tx_hash, "submitted_at": int(time.time())})
    try: _path("pending-submission", job_id).unlink()
    except FileNotFoundError: pass
    _runtime["last_submission"] = {"timestamp": int(time.time()), "job_id": job_id, "tx_hash": tx_hash}
    return tx_hash

async def _on_funded(job):
    try: job_id = int(job.get("jobId"))
    except (TypeError, ValueError): return
    if not _funded(job) or not _matches(job): return
    _runtime["last_funded_job"] = {"timestamp": int(time.time()), "job_id": job_id}
    try:
        module = importlib.import_module(IMPL); decision = await asyncio.to_thread(module.decide_job, job)
        _save("decision", job_id, {"job": job, "decision": decision, "updated_at": int(time.time())})
        _runtime["last_decision"] = {"timestamp": int(time.time()), "job_id": job_id, **decision}
        if bool(decision.get("execution_required")):
            auth_payload = _load("authorization", job_id); auth = auth_payload.get("authorization") if isinstance(auth_payload, dict) else None
            if not isinstance(auth, dict):
                _runtime["last_execution"] = {"timestamp": int(time.time()), "job_id": job_id, "status": "awaiting_authorization"}; return
            job = _with_auth(job, auth)
        deliverable, metadata = await asyncio.to_thread(module.fulfill_job, job)
        status = str(metadata.get("execution_status") or "observed").lower()
        if status not in {"observed", "evaluated", "executed"}: raise RuntimeError(f"Unsupported terminal execution status: {status}")
        if bool(decision.get("execution_required")) and status != "executed": raise RuntimeError("Execution-required decision did not produce an executed result")
        if status == "executed" and not metadata.get("transaction_hash"): raise RuntimeError("Executed result is missing transaction_hash")
        _runtime["last_execution"] = {"timestamp": int(time.time()), "job_id": job_id, "status": status, "decision": metadata.get("decision"), "transaction_hash": metadata.get("transaction_hash")}
        await _submit(job_id, deliverable, metadata, job); _runtime["last_error"] = None
    except Exception as exc:
        _runtime["last_error"] = {"timestamp": int(time.time()), "job_id": job_id, "error": str(exc)}; logging.exception("%s job=%s failed", DISPLAY_NAME, job_id)

_watcher_task = None
@asynccontextmanager
async def lifespan(_: FastAPI):
    global _watcher_task
    _runtime["watcher_started_at"] = int(time.time())
    _watcher_task = asyncio.create_task(funded_job_watcher(_ops, _on_funded, interval=POLL_INTERVAL))
    try: yield
    finally:
        if _watcher_task:
            _watcher_task.cancel(); await asyncio.gather(_watcher_task, return_exceptions=True)

app = FastAPI(title=DISPLAY_NAME, description=f"Isolated {DISPLAY_NAME} provider on BSC Testnet", lifespan=lifespan)
def _manifest(base: str):
    capability=os.getenv("AGENT_CAPABILITY_ID",f"{KIND}.service")
    return {"spec":"agent-provider/v1","name":DISPLAY_NAME,"description":os.getenv("AGENT_PROVIDER_DESCRIPTION",f"{DISPLAY_NAME} provider on BSC Testnet."),"version":os.getenv("AGENT_PROVIDER_VERSION","1.0.0"),"agent":{"provider":"AgentMarket first-party"},"protocols":["erc-8183","http"],"networks":[{"chain_id":CHAIN_ID,"name":"BSC Testnet","environment":"testnet"}],"capabilities":[{"id":capability,"name":os.getenv("AGENT_CAPABILITY_NAME",DISPLAY_NAME),"description":os.getenv("AGENT_CAPABILITY_DESCRIPTION","Autonomous domain analysis and provider execution."),"metadata":{"agent_kind":KIND}}],"endpoints":{"health":{"url":base+"/erc8183/health","method":"GET","transport":"http","capability":capability},"quote":{"url":base+"/erc8183/negotiate","method":"POST","transport":"http","capability":capability},"decision":{"url":base+"/erc8183/job/{job_id}/decision","method":"GET","transport":"http","capability":capability},"authorization":{"url":base+"/erc8183/job/{job_id}/execution-authorization","method":"POST","transport":"http","capability":capability},"execution_capabilities":{"url":base+"/erc8183/execution-capabilities","method":"GET","transport":"http","capability":capability},"result":{"url":base+"/erc8183/job/{job_id}/response","method":"GET","transport":"http","capability":capability}},"hiring":{"protocol":"ERC-8183","quote_required":True,"quote_ttl_seconds":300,"price":str(SERVICE_PRICE),"payment_token":payment_token()},"execution":{"mode":"provider-watcher","authorization":"erc8183-job-scoped","state_changing":os.getenv("AGENT_STATE_CHANGING","false").lower() in {"1","true","yes"},"user_approval_required":True},"discovery":{"canonical_url":base+"/agent.json","agent_card":base+"/agent.json"}}

@app.get("/health")
async def health(): return {"status":"ok","agent":KIND,"network":NETWORK,"chain_id":CHAIN_ID,"provider_address":provider_address()}
@app.get("/agent.json")
async def agent_json(request: FastAPIRequest): return _manifest(str(request.base_url).rstrip("/"))
@app.get("/erc8183/agent.json")
async def agent_json2(request: FastAPIRequest): return _manifest(str(request.base_url).rstrip("/"))
@app.get("/erc8183")
async def root(): return {"status":"ok","agent_kind":KIND,"agent_address":provider_address(),"network":NETWORK,"chain_id":CHAIN_ID,"endpoints":{"agent":"/agent.json","health":"/erc8183/health","status":"/erc8183/status","quote":"/erc8183/negotiate"}}
@app.get("/erc8183/health")
async def erc_health(): return await health()
@app.get("/erc8183/status")
async def status(): return {"status":"ok","agent_kind":KIND,"agent_address":provider_address(),"commerce_address":str(_ops.erc8183_client.commerce.address),"router_address":str(_ops.erc8183_client.router.address),"policy_address":str(_ops.erc8183_client.policy.address),"service_price":SERVICE_PRICE,"payment_token":payment_token()}
@app.get("/erc8183/runtime-status")
async def runtime(): return {"status":"ok","agent_kind":KIND,"agent_address":provider_address(),"watcher":{"running":bool(_watcher_task and not _watcher_task.done()),"started_at":_runtime["watcher_started_at"],"poll_interval_seconds":POLL_INTERVAL},**{k:_runtime[k] for k in _runtime if k!="watcher_started_at"}}
@app.get("/erc8183/job/{job_id}/decision")
async def decision(job_id:int):
    payload=_load("decision",job_id)
    if not payload:return JSONResponse({"error":"Decision not available yet"},status_code=404)
    return {"ok":True,**payload.get("decision",{}),"provider_address":provider_address(),"job_id":job_id}
@app.post("/erc8183/job/{job_id}/execution-authorization")
async def authorization(job_id:int,request:FastAPIRequest):
    body=await request.json();auth=body.get("execution_authorization") if isinstance(body,dict) and isinstance(body.get("execution_authorization"),dict) else body
    ctx=_load("decision",job_id)
    if not ctx or not bool(ctx.get("decision",{}).get("execution_required")):raise HTTPException(status_code=409,detail="This job does not currently require execution authorization")
    if not isinstance(auth,dict):raise HTTPException(status_code=400,detail="execution_authorization is required")
    if not auth.get("execution_wallet") and not auth.get("wallet_address"):raise HTTPException(status_code=400,detail="execution wallet is required")
    normalized={**auth,"execution_wallet":auth.get("execution_wallet") or auth.get("wallet_address"),"wallet_provider":"altana","authorization_model":"scoped_session","chain_id":CHAIN_ID,"session_binding":"erc8183_job_id"}
    _save("authorization",job_id,{"job_id":job_id,"authorization":normalized,"updated_at":int(time.time())});asyncio.create_task(_on_funded(ctx["job"]))
    return {"ok":True,"accepted":True,"job_id":job_id,"execution_authorization":normalized}
@app.get("/erc8183/execution-capabilities")
async def execution_capabilities():
    try:
        with urlopen(EXECUTION_URL+"/execution-capabilities",timeout=10) as response:return json.loads(response.read().decode("utf-8"))
    except Exception as exc:raise HTTPException(status_code=502,detail=str(exc))
@app.post("/erc8183/preflight")
async def preflight(request:FastAPIRequest):
    data=await request.json();req=Request(EXECUTION_URL+"/preflight",data=json.dumps(data).encode(),headers={"content-type":"application/json"},method="POST")
    try:
        with urlopen(req,timeout=20) as response:return json.loads(response.read().decode())
    except Exception as exc:raise HTTPException(status_code=409,detail=str(exc))
@app.post("/erc8183/negotiate")
async def negotiate(request:FastAPIRequest):
    data=await request.json();return {"accepted":True,"quote_id":f"{KIND}-{int(time.time())}","price":str(SERVICE_PRICE),"currency":payment_token() or "testnet-settlement-token","quote_expires_at":int(time.time())+300,"chain_id":CHAIN_ID,"network":NETWORK,"environment":"testnet","provider_address":provider_address(),"task_description":data.get("task_description","") if isinstance(data,dict) else ""}
@app.get("/erc8183/job/{job_id}/response")
async def response(job_id:int):
    try:body=_path("job",job_id).read_bytes()
    except FileNotFoundError:return JSONResponse({"error":"submitted response not found","job_id":job_id},status_code=404)
    return Response(content=body,media_type="application/json",headers={"cache-control":"no-store"})
