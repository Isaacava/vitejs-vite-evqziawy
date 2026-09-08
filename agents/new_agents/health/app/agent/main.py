from __future__ import annotations

import json, os
from typing import Any
from web3 import Web3

RPC = os.getenv("BSC_TESTNET_RPC_URL", "https://bsc-testnet-rpc.publicnode.com")
DEFAULT_COMPTROLLER = os.getenv("VENUS_COMPTROLLER", "").strip()
WARNING = float(os.getenv("HEALTH_WARNING_THRESHOLD", "1.50"))
CRITICAL = float(os.getenv("HEALTH_CRITICAL_THRESHOLD", "1.20"))
w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 15}))

COMP_ABI = [
    {"name":"getAccountLiquidity","type":"function","stateMutability":"view","inputs":[{"name":"account","type":"address"}],"outputs":[{"type":"uint256"},{"type":"uint256"},{"type":"uint256"}]},
    {"name":"getAllMarkets","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"address[]"}]},
]
VTOKEN_ABI = [
    {"name":"borrowBalanceStored","type":"function","stateMutability":"view","inputs":[{"name":"account","type":"address"}],"outputs":[{"type":"uint256"}]},
    {"name":"balanceOf","type":"function","stateMutability":"view","inputs":[{"name":"account","type":"address"}],"outputs":[{"type":"uint256"}]},
    {"name":"symbol","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
]


def _obj(v: Any)->dict[str,Any]:
    if isinstance(v,dict): return v
    if isinstance(v,str) and v.strip():
        try:
            x=json.loads(v); return x if isinstance(x,dict) else {}
        except json.JSONDecodeError: return {}
    return {}

def _params(job:dict[str,Any])->dict[str,Any]:
    m={**_obj(job.get("metadata")),**_obj(job.get("description"))}
    if isinstance(m.get("params"),dict):m={**m,**m["params"]}
    return m

def _wallet(v:Any)->str:
    s=str(v or "").strip()
    if not Web3.is_address(s): raise ValueError("Health Guardian requires a valid position wallet address")
    return Web3.to_checksum_address(s)

def inspect_account(wallet:str, comptroller_address:str)->dict[str,Any]:
    if not w3.is_connected(): raise RuntimeError("BSC Testnet RPC is unavailable")
    comptroller=Web3.to_checksum_address(comptroller_address)
    c=w3.eth.contract(address=comptroller,abi=COMP_ABI)
    error, liquidity, shortfall=c.functions.getAccountLiquidity(wallet).call()
    markets=c.functions.getAllMarkets().call()
    borrow_markets=[]
    total_borrow_raw=0
    for market in markets:
        try:
            vc=w3.eth.contract(address=Web3.to_checksum_address(market),abi=VTOKEN_ABI)
            debt=int(vc.functions.borrowBalanceStored(wallet).call())
            if debt>0:
                try:symbol=str(vc.functions.symbol().call())
                except Exception:symbol=str(market)
                borrow_markets.append({"market":Web3.to_checksum_address(market),"symbol":symbol,"borrow_balance_raw":str(debt)})
                total_borrow_raw += debt
        except Exception:
            continue
    if shortfall>0:
        health_factor=0.0
    elif total_borrow_raw>0:
        health_factor=1.0+float(liquidity)/float(total_borrow_raw)
    else:
        health_factor=float("inf")
    return {"wallet":wallet,"comptroller":comptroller,"rpc":RPC,"error_code":int(error),"liquidity_raw":str(liquidity),"shortfall_raw":str(shortfall),"active_market_count":len(markets),"borrow_positions":borrow_markets,"borrow_balance_raw_total":str(total_borrow_raw),"health_factor":None if health_factor==float("inf") else round(health_factor,6),"position_state":"liquidation_risk" if shortfall>0 else ("borrowing" if total_borrow_raw>0 else "no_detected_borrow")}

def decide_job(job:dict[str,Any])->dict[str,Any]:
    p=_params(job); wallet=_wallet(p.get("wallet_address") or p.get("position_wallet") or p.get("execution_wallet")); comptroller=str(p.get("venus_comptroller") or DEFAULT_COMPTROLLER).strip()
    if not Web3.is_address(comptroller): raise ValueError("A Venus/Compound-compatible Comptroller address must be configured for the BSC Testnet job")
    obs=inspect_account(wallet,comptroller)
    hf=obs["health_factor"]
    warning=float(p.get("warning_threshold",WARNING)); critical=float(p.get("critical_threshold",CRITICAL))
    if critical>=warning: raise ValueError("critical_threshold must be lower than warning_threshold")
    if obs["shortfall_raw"]!="0" or (hf is not None and hf<=critical): action,severity="protect_now","critical"
    elif hf is not None and hf<=warning: action,severity="reduce_risk","warning"
    else: action,severity="monitor","healthy"
    return {"job_id":str(job.get("jobId",job.get("id",""))),"network":"bsc-testnet","task":"health_factor_monitoring","observation":obs,"decision":{"action":action,"severity":severity,"warning_threshold":warning,"critical_threshold":critical},"execution_required":False,"authorization_required":False}

def fulfill_job(job:dict[str,Any])->tuple[str,dict[str,Any]]:
    decision=decide_job(job)
    obs=decision["observation"]; d=decision["decision"]
    payload={"agent":"health-factor-guardian-v2","job_id":decision["job_id"],"network":"bsc-testnet","task":"health_factor_monitoring","observation":obs,"decision":d,"execution_status":"observed","workflow":["read_wallet","read_comptroller_liquidity","scan_live_borrow_markets","classify_risk"],"note":"Risk is derived from live BSC Testnet Comptroller liquidity/shortfall and current borrow positions; the agent does not trust a supplied health_factor number."}
    return json.dumps(payload,separators=(",",":")),{"execution_status":"observed","transaction_hash":None,"decision":d["action"]}
