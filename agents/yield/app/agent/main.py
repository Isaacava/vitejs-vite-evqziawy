"""Yield optimisation strategy for BSC Testnet jobs."""
from __future__ import annotations
import json, os
from typing import Any
from agents.shared.execution_authorization import wait_for_execution_authorization
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
    authorization: dict[str,Any]={"required":False,"obtained":False,"status":"not_required"}
    execute_requested=str(p.get("execute","")).lower() in {"1","true","yes"}
    if execute_requested:
        try: job_id=int(job.get("jobId",job.get("id",0)))
        except (TypeError,ValueError) as exc: raise ValueError("Yield execution requires a valid ERC-8183 job id") from exc
        if job_id<=0: raise ValueError("Yield execution requires a positive ERC-8183 job id")
        provider_address=str(job.get("provider") or job.get("providerAddress") or job.get("provider_address") or "").strip()
        if not provider_address: raise ValueError("Yield execution requires the ERC-8183 provider address")
        granted=wait_for_execution_authorization(job_id,provider_address)
        authorization={"required":True,"obtained":True,"status":"authorized","request_id":granted.get("request_id"),"execution_wallet":granted.get("execution_wallet"),"session_key_id":granted.get("session_key_id"),"session_expiry":granted.get("session_expiry"),"capital_token":granted.get("capital_token")}
        wallet=str(granted.get("execution_wallet") or p.get("execution_wallet") or "").strip()
        token_in=str(granted.get("capital_token") or p.get("token_in") or os.getenv("ALTANA_SESSION_SPEND_TOKEN") or "").strip()
        token_out=str(p.get("token_out") or os.getenv("ALTANA_SWAP_TOKEN_OUT") or "").strip()
        amount_in=str(p.get("amount_in") or p.get("execution_amount_raw") or "").strip()
        if not wallet or not token_in or not token_out or not amount_in: raise ValueError("Executing Yield jobs require an authorized execution wallet, token_in, token_out and amount_in")
        execution=execute_testnet_swap(job_id=job_id,wallet_address=wallet,token_in=token_in,token_out=token_out,amount_in=amount_in,amount_out_minimum=str(p.get("amount_out_minimum") or "0"),fee=int(p.get("fee",2500)))
        transaction_hash=execution.get("transaction_hash") if isinstance(execution,dict) else None
        if not transaction_hash: raise RuntimeError("Yield execution returned no transaction hash; result will not be submitted")
        execution_status="executed"
    payload={"agent":"agentmarket-yield-test","job_id":str(job.get("jobId",job.get("id",""))),"network":"bsc-testnet","task":"yield_optimisation","selection":{"protocol":winner.get("protocol"),"market":winner.get("market"),"apr":winner["apr"],"target":winner.get("target")},"candidates":[{"protocol":i.get("protocol"),"market":i.get("market"),"apr":i["apr"]} for i in valid],"execution":execution or "observation_and_route_plan","execution_status":execution_status,"authorization":authorization,"note":"State-changing yield execution requires the same job-scoped Altana session to be granted by the user through Passkey and independently verified by AgentMarket before execution."}
    return json.dumps(payload,separators=(",",":")),{"execution_status":execution_status,"transaction_hash":transaction_hash,"selected_apr":winner["apr"],"authorization_status":authorization.get("status")}
