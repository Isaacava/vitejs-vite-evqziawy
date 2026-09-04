"""Health Factor Guardian strategy for BSC Testnet lending jobs."""
from __future__ import annotations
import json, os
from typing import Any
from agents.shared.execution_authorization import wait_for_execution_authorization
from execution_client import execute_testnet_swap

def _obj(value: Any)->dict[str,Any]:
    if isinstance(value,dict):return value
    if isinstance(value,str) and value.strip():
        try:parsed=json.loads(value);return parsed if isinstance(parsed,dict) else {}
        except json.JSONDecodeError:return {}
    return {}
def _params(job:dict[str,Any])->dict[str,Any]:
    merged={**_obj(job.get("metadata")),**_obj(job.get("description"))}
    if isinstance(merged.get("params"),dict):merged={**merged,**merged["params"]}
    execution=merged.get("execution")
    if isinstance(execution,dict):merged={**merged,**execution}
    market=merged.get("execution_market")
    if isinstance(market,dict):merged={**merged,**market}
    return merged
def fulfill_job(job:dict[str,Any])->tuple[str,dict[str,Any]]:
    p=_params(job)
    try:health_factor=float(p["health_factor"]);warning_threshold=float(p.get("warning_threshold",1.5));critical_threshold=float(p.get("critical_threshold",1.1))
    except (KeyError,TypeError,ValueError) as exc:raise ValueError("Health Factor jobs require health_factor; thresholds are optional") from exc
    if health_factor<=0 or warning_threshold<=0 or critical_threshold<=0:raise ValueError("Health factor and thresholds must be positive")
    if critical_threshold>=warning_threshold:raise ValueError("critical_threshold must be lower than warning_threshold")
    if health_factor<=critical_threshold:decision,severity="protect_now","critical"
    elif health_factor<=warning_threshold:decision,severity="reduce_risk","warning"
    else:decision,severity="monitor","healthy"
    buffer_pct=(health_factor/warning_threshold-1.0)*100.0;execution=None;execution_status="observed";transaction_hash=None
    authorization:dict[str,Any]={"required":False,"obtained":False,"status":"not_required"}
    execute_requested=str(p.get("execute","")).lower() in {"1","true","yes"}
    if execute_requested:
        if decision=="monitor":raise ValueError("Health Guardian execution requested while the position is healthy")
        try:job_id=int(job.get("jobId",job.get("id",0)))
        except (TypeError,ValueError) as exc:raise ValueError("Health Guardian execution requires a valid ERC-8183 job id") from exc
        if job_id<=0:raise ValueError("Health Guardian execution requires a positive ERC-8183 job id")
        provider_address=str(job.get("provider") or job.get("providerAddress") or job.get("provider_address") or "").strip()
        if not provider_address:raise ValueError("Health Guardian execution requires the ERC-8183 provider address")
        granted=wait_for_execution_authorization(job_id,provider_address)
        authorization={"required":True,"obtained":True,"status":"authorized","request_id":granted.get("request_id"),"execution_wallet":granted.get("execution_wallet"),"session_key_id":granted.get("session_key_id"),"session_expiry":granted.get("session_expiry"),"capital_token":granted.get("capital_token")}
        wallet=str(granted.get("execution_wallet") or p.get("execution_wallet") or "").strip()
        token_in=str(granted.get("capital_token") or p.get("token_in") or os.getenv("ALTANA_SESSION_SPEND_TOKEN") or "").strip()
        token_out=str(p.get("token_out") or os.getenv("ALTANA_SWAP_TOKEN_OUT") or "").strip()
        amount_in=str(p.get("amount_in") or p.get("execution_amount_raw") or "").strip()
        if not wallet or not token_in or not token_out or not amount_in:raise ValueError("Executing Health Guardian jobs require an authorized execution wallet, token_in, token_out and amount_in")
        execution=execute_testnet_swap(job_id=job_id,wallet_address=wallet,token_in=token_in,token_out=token_out,amount_in=amount_in,amount_out_minimum=str(p.get("amount_out_minimum") or "0"),fee=int(p.get("fee",2500)))
        transaction_hash=execution.get("transaction_hash") if isinstance(execution,dict) else None
        if not transaction_hash:raise RuntimeError("Health Guardian execution returned no transaction hash; result will not be submitted")
        execution_status="executed"
    payload={"agent":"agentmarket-health-factor-test","job_id":str(job.get("jobId",job.get("id",""))),"network":"bsc-testnet","task":"health_factor_monitoring","observation":{"health_factor":health_factor,"warning_threshold":warning_threshold,"critical_threshold":critical_threshold,"buffer_vs_warning_pct":round(buffer_pct,4)},"decision":{"severity":severity,"action":decision},"execution":execution or "risk_assessment","execution_status":execution_status,"authorization":authorization,"note":"State-changing protection requires the same job-scoped Altana session to be granted by the user through Passkey and independently verified by AgentMarket before execution."}
    return json.dumps(payload,separators=(",",":")),{"execution_status":execution_status,"transaction_hash":transaction_hash,"decision":decision,"authorization_status":authorization.get("status")}
