"""Health Factor Guardian strategy for BSC Testnet lending jobs."""
from __future__ import annotations
import json, os
from typing import Any
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
    if str(p.get("execute","")).lower() in {"1","true","yes"}:
        if decision=="monitor":raise ValueError("Health Guardian execution requested while the position is healthy")
        wallet=str(p.get("execution_wallet") or p.get("user_altana_wallet") or "").strip();token_in=str(p.get("token_in") or os.getenv("ALTANA_SESSION_SPEND_TOKEN") or "").strip();token_out=str(p.get("token_out") or os.getenv("ALTANA_SWAP_TOKEN_OUT") or "").strip();amount_in=str(p.get("amount_in") or "").strip()
        if not wallet or not token_in or not token_out or not amount_in:raise ValueError("Executing Health Guardian jobs require execution_wallet, token_in, token_out and amount_in")
        execution=execute_testnet_swap(job_id=int(job.get("jobId",job.get("id",0))),wallet_address=wallet,token_in=token_in,token_out=token_out,amount_in=amount_in,amount_out_minimum=str(p.get("amount_out_minimum") or "0"),fee=int(p.get("fee",2500)));execution_status="executed";transaction_hash=execution.get("transaction_hash")
    payload={"agent":"agentmarket-health-factor-test","job_id":str(job.get("jobId",job.get("id",""))),"network":"bsc-testnet","task":"health_factor_monitoring","observation":{"health_factor":health_factor,"warning_threshold":warning_threshold,"critical_threshold":critical_threshold,"buffer_vs_warning_pct":round(buffer_pct,4)},"decision":{"severity":severity,"action":decision},"execution":execution or "risk_assessment","note":"State-changing protection is permitted only through the agent's allowlisted Altana scoped Testnet session."}
    return json.dumps(payload,separators=(",",":")),{"execution_status":execution_status,"transaction_hash":transaction_hash,"decision":decision}
