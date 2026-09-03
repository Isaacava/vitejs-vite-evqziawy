"""Yield optimisation strategy for BSC Testnet jobs."""
from __future__ import annotations
import json, os
from typing import Any
from execution_client import execute_testnet_swap

def _obj(value: Any) -> dict[str, Any]:
    if isinstance(value,dict): return value
    if isinstance(value,str) and value.strip():
        try: parsed=json.loads(value); return parsed if isinstance(parsed,dict) else {}
        except json.JSONDecodeError: return {}
    return {}
def _params(job: dict[str,Any])->dict[str,Any]:
    merged={**_obj(job.get("metadata")),**_obj(job.get("description"))}
    if isinstance(merged.get("params"),dict): merged={**merged,**merged["params"]}
    return merged
def fulfill_job(job: dict[str,Any])->tuple[str,dict[str,Any]]:
    p=_params(job); opportunities=p.get("opportunities")
    if not isinstance(opportunities,list) or not opportunities: raise ValueError("Yield jobs require a non-empty opportunities list")
    valid=[]
    for item in opportunities:
        if not isinstance(item,dict): continue
        try: apr=float(item["apr"])
        except (KeyError,TypeError,ValueError): continue
        if apr>=-100: valid.append({**item,"apr":apr})
    if not valid: raise ValueError("No valid yield opportunities were supplied")
    valid.sort(key=lambda item:(item["apr"],str(item.get("protocol",""))),reverse=True); winner=valid[0]
    execution=None; execution_status="evaluated"; transaction_hash=None
    if str(p.get("execute","")).lower() in {"1","true","yes"}:
        wallet=str(p.get("execution_wallet") or p.get("user_altana_wallet") or "").strip(); token_in=str(p.get("token_in") or os.getenv("ALTANA_SESSION_SPEND_TOKEN") or "").strip(); token_out=str(p.get("token_out") or os.getenv("ALTANA_SWAP_TOKEN_OUT") or "").strip(); amount_in=str(p.get("amount_in") or "").strip()
        if not wallet or not token_in or not token_out or not amount_in: raise ValueError("Executing Yield jobs require execution_wallet, token_in, token_out and amount_in")
        execution=execute_testnet_swap(job_id=int(job.get("jobId",job.get("id",0))),wallet_address=wallet,token_in=token_in,token_out=token_out,amount_in=amount_in,amount_out_minimum=str(p.get("amount_out_minimum") or "0"),fee=int(p.get("fee",2500))); execution_status="executed"; transaction_hash=execution.get("transaction_hash")
    payload={"agent":"agentmarket-yield-test","job_id":str(job.get("jobId",job.get("id",""))),"network":"bsc-testnet","task":"yield_optimisation","selection":{"protocol":winner.get("protocol"),"market":winner.get("market"),"apr":winner["apr"],"target":winner.get("target")},"candidates":[{"protocol":i.get("protocol"),"market":i.get("market"),"apr":i["apr"]} for i in valid],"execution":execution or "observation_and_route_plan","note":"State-changing yield execution is permitted only through the agent's allowlisted Altana scoped Testnet session."}
    return json.dumps(payload,separators=(",",":")),{"execution_status":execution_status,"transaction_hash":transaction_hash,"selected_apr":winner["apr"]}
