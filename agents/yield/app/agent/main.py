"""Yield optimisation strategy for BSC Testnet jobs."""
from __future__ import annotations
import json
from typing import Any
from execution_client import execute_testnet_swap

def _obj(value: Any)->dict[str,Any]:
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
        wallet=str(p.get("execution_wallet") or p.get("user_altana_wallet") or "").strip(); token_in=str(p.get("token_in") or "").strip(); token_out=str(p.get("token_out") or "").strip(); amount_in=str(p.get("amount_in") or "").strip()
        if not wallet or not token_in or not token_out or not amount_in: raise ValueError("Executing Yield jobs require execution_wallet, token_in, token_out and amount_in embedded in the job")
        for name,value in (("execution_wallet",wallet),("token_in",token_in),("token_out",token_out)):
            if not (value.startswith("0x") and len(value)==42): raise ValueError(f"{name} must be a valid EVM address")
        job_id=int(job.get("jobId",job.get("id",0)))
        if job_id<=0: raise ValueError("Yield execution requires a valid ERC-8183 jobId")
        execution=execute_testnet_swap(job_id=job_id,wallet_address=wallet,token_in=token_in,token_out=token_out,amount_in=amount_in,amount_out_minimum=str(p.get("amount_out_minimum") or "0"),fee=int(p.get("fee",2500)))
        transaction_hash=execution.get("transaction_hash") if isinstance(execution,dict) else None
        if not transaction_hash: raise RuntimeError("Yield execution returned no transaction hash; result will not be submitted")
        execution_status="executed"
    payload={"agent":"agentmarket-yield-test","job_id":str(job.get("jobId",job.get("id",""))),"network":"bsc-testnet","task":"yield_optimisation","selection":{"protocol":winner.get("protocol"),"market":winner.get("market"),"apr":winner["apr"],"target":winner.get("target")},"candidates":[{"protocol":i.get("protocol"),"market":i.get("market"),"apr":i["apr"]} for i in valid],"execution":execution or "observation_and_route_plan","execution_status":execution_status,"transaction_hash":transaction_hash,"note":"State-changing yield execution requires job-scoped Altana execution inputs and successful transaction evidence."}
    return json.dumps(payload,separators=(",",":")),{"execution_status":execution_status,"transaction_hash":transaction_hash,"selected_apr":winner["apr"]}
