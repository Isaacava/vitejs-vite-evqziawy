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
    execution=merged.get("execution")
    if isinstance(execution,dict): merged={**merged,**execution}
    market=merged.get("execution_market")
    if isinstance(market,dict): merged={**merged,**market}
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
        try: job_id=int(job.get("jobId",job.get("id",0)))
        except (TypeError,ValueError) as exc: raise ValueError("Executing Yield jobs require a valid ERC-8183 jobId") from exc
        if job_id<=0: raise ValueError("Executing Yield jobs require a positive ERC-8183 jobId")
        wallet_value=str(p.get("execution_wallet") or p.get("user_altana_wallet") or "").strip(); wallet=wallet_value if wallet_value.startswith("0x") and len(wallet_value)==42 else None
        execution_authorization=p.get("execution_authorization") or p.get("authorization")
        token_in=str(p.get("token_in") or "").strip(); token_out=str(p.get("token_out") or "").strip(); amount_in=str(p.get("amount_in") or "").strip()
        if not token_in or not token_out or not amount_in: raise ValueError("Executing Yield jobs require token_in, token_out and amount_in")
        execution=execute_testnet_swap(job_id=job_id,wallet_address=wallet,token_in=token_in,token_out=token_out,amount_in=amount_in,amount_out_minimum=str(p.get("amount_out_minimum") or "0"),fee=int(p.get("fee",2500)),execution_authorization=execution_authorization); execution_status="executed"; transaction_hash=execution.get("transaction_hash")
        if not transaction_hash: raise RuntimeError("Yield execution returned no transaction hash")
    payload={"agent":"yield-optimisation-test","job_id":str(job.get("jobId",job.get("id",""))),"network":"bsc-testnet","task":"yield_optimisation","selection":{"protocol":winner.get("protocol"),"market":winner.get("market"),"apr":winner["apr"],"target":winner.get("target")},"candidates":[{"protocol":i.get("protocol"),"market":i.get("market"),"apr":i["apr"]} for i in valid],"execution":execution or "observation_and_route_plan","note":"Mission creation and hiring venue are independent of execution authorization. State-changing execution consumes a job-scoped authorization supplied by the hiring client."}
    return json.dumps(payload,separators=(",",":")),{"execution_status":execution_status,"transaction_hash":transaction_hash,"selected_apr":winner["apr"]}
