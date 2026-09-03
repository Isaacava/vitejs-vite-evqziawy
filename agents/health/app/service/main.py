"""Standalone ERC-8183 provider service for a first-party AgentMarket agent."""
from __future__ import annotations
import asyncio, importlib, json, logging, os, time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.request import Request as UrlRequest, urlopen
from fastapi import FastAPI, HTTPException, Request
from bnbagent import EVMWalletProvider
from bnbagent.erc8183 import ERC8183JobOps, funded_job_watcher
from bnbagent.storage import LocalStorageProvider
from app.service.config import validate_runtime_config
logging.basicConfig(level=logging.INFO,format="%(asctime)s %(levelname)s %(name)s %(message)s")
KIND=os.getenv("AGENT_KIND","health_factor_guardian").strip().lower();DISPLAY_NAME=os.getenv("AGENT_DISPLAY_NAME",KIND.replace("_"," ").title());config=validate_runtime_config();NETWORK=config["network"];CHAIN_ID=97;SERVICE_PRICE=config["service_price"];POLL_INTERVAL=config["poll_interval"];STORAGE_DIR=Path(os.getenv("STORAGE_LOCAL_PATH") or ".agent-data");EXECUTION_URL=os.getenv("ALTANA_EXECUTION_INTERNAL_URL","http://127.0.0.1:8788").rstrip("/")
_wallet=EVMWalletProvider(password=os.environ["WALLET_PASSWORD"],private_key=os.environ.get("PRIVATE_KEY"));_storage=LocalStorageProvider(base_dir=str(STORAGE_DIR));_ops=ERC8183JobOps(_wallet,network=NETWORK,storage_provider=_storage,service_price=SERVICE_PRICE,agent_url=config["endpoint"]);_runtime:dict[str,Any]={"watcher_started_at":None,"last_funded_job":None,"last_execution":None,"last_submission":None,"last_error":None}
def provider_address()->str:return str(_ops.agent_address)
def payment_token()->str|None:
    try:return str(_ops.erc8183_client.payment_token)
    except Exception:return None
def pending_path(job_id:int)->Path:return STORAGE_DIR/f"erc8183-pending-submission-{job_id}.json"
def save_pending(job_id:int,deliverable:str,metadata:dict[str,Any])->None:STORAGE_DIR.mkdir(parents=True,exist_ok=True);pending_path(job_id).write_text(json.dumps({"job_id":job_id,"deliverable":deliverable,"metadata":metadata},separators=(",",":")),encoding="utf-8")
def load_pending(job_id:int):
    try:payload=json.loads(pending_path(job_id).read_text())
    except (FileNotFoundError,OSError,json.JSONDecodeError):return None
    if not isinstance(payload,dict) or int(payload.get("job_id",-1))!=job_id:return None
    d,m=payload.get("deliverable"),payload.get("metadata");return (d,m) if isinstance(d,str) and isinstance(m,dict) else None
def clear_pending(job_id:int)->None:
    try:pending_path(job_id).unlink()
    except FileNotFoundError:pass
async def submit(job_id:int,deliverable:str,metadata:dict[str,Any]):
    save_pending(job_id,deliverable,metadata);result=await _ops.submit_result(job_id,deliverable);tx_hash=getattr(result,"hash",None)
    if tx_hash is None and isinstance(result,dict):tx_hash=result.get("hash") or result.get("tx_hash")
    if tx_hash is None and isinstance(result,str):tx_hash=result
    clear_pending(job_id);return str(tx_hash) if tx_hash else None
async def on_funded(job:dict[str,Any])->None:
    job_id=int(job.get("jobId"));_runtime["last_funded_job"]={"timestamp":int(time.time()),"job_id":job_id};pending=load_pending(job_id)
    if pending is not None:deliverable,metadata=pending
    else:module=importlib.import_module("app.agent.main");deliverable,metadata=await asyncio.to_thread(module.fulfill_job,job)
    status=str(metadata.get("execution_status") or "").lower()
    if status not in {"observed","evaluated","planned","executed"}:raise RuntimeError("Agent did not produce an accepted execution status")
    _runtime["last_execution"]={"timestamp":int(time.time()),"job_id":job_id,"status":status,"tx_hash":metadata.get("transaction_hash")};tx_hash=await submit(job_id,deliverable,metadata);_runtime["last_submission"]={"timestamp":int(time.time()),"job_id":job_id,"tx_hash":tx_hash}
def proxy_get(path:str)->dict[str,Any]:
    with urlopen(EXECUTION_URL+path,timeout=10) as response:payload=json.loads(response.read().decode())
    if not isinstance(payload,dict):raise RuntimeError("invalid execution response")
    return payload
def proxy_post(path:str,body:dict[str,Any])->dict[str,Any]:
    req=UrlRequest(EXECUTION_URL+path,data=json.dumps(body).encode(),headers={"content-type":"application/json"},method="POST")
    with urlopen(req,timeout=30) as response:payload=json.loads(response.read().decode())
    if not isinstance(payload,dict):raise RuntimeError("invalid execution response")
    if payload.get("error"):raise RuntimeError(str(payload["error"]))
    return payload
_watcher_task:asyncio.Task|None=None
@asynccontextmanager
async def lifespan(_:FastAPI):
    global _watcher_task;_runtime["watcher_started_at"]=int(time.time());_watcher_task=asyncio.create_task(funded_job_watcher(_ops,on_funded,interval=POLL_INTERVAL))
    try:yield
    finally:
        if _watcher_task is not None:_watcher_task.cancel();await asyncio.gather(_watcher_task,return_exceptions=True)
app=FastAPI(title=f"{DISPLAY_NAME} Agent",lifespan=lifespan)
@app.get("/health")
async def health():return {"status":"ok","agent":KIND,"network":NETWORK,"chain_id":CHAIN_ID}
@app.get("/erc8183")
async def root():return {"status":"ok","service":f"{DISPLAY_NAME} ERC-8183 provider","agent_kind":KIND,"network":NETWORK,"chain_id":CHAIN_ID,"agent_address":provider_address(),"endpoints":{"execution_capabilities":"/execution-capabilities","preflight":"/preflight"}}
@app.get("/erc8183/status")
async def status():return {"status":"ok","agent_kind":KIND,"agent_address":provider_address(),"commerce_address":str(_ops.erc8183_client.commerce.address),"router_address":str(_ops.erc8183_client.router.address),"policy_address":str(_ops.erc8183_client.policy.address),"service_price":SERVICE_PRICE,"payment_token":payment_token(),"poll_interval":POLL_INTERVAL,"execution_service":EXECUTION_URL}
@app.get("/execution-capabilities")
async def execution_capabilities():return proxy_get("/execution-capabilities")
@app.post("/preflight")
async def preflight(request:Request):
    body=await request.json();
    if not isinstance(body,dict):raise HTTPException(status_code=400,detail="Request body must be an object")
    try:return proxy_post("/preflight",body)
    except Exception as exc:raise HTTPException(status_code=409,detail=str(exc)) from exc
@app.post("/erc8183/negotiate")
async def negotiate(request:Request):return {"accepted":True,"quote_id":f"{KIND}-{int(time.time())}","price":str(SERVICE_PRICE),"currency":payment_token() or "testnet-settlement-token","quote_expires_at":int(time.time())+300,"chain_id":CHAIN_ID,"network":NETWORK,"environment":"testnet","provider_address":provider_address()}
