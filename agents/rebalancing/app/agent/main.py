"""Rebalancing strategy for BSC Testnet LP-position jobs."""

from __future__ import annotations
import json
import os
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.agent.execution import execute_testnet_swap


def _obj(value: Any) -> dict[str, Any]:
    if isinstance(value, dict): return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError: return {}
    return {}


def _params(job: dict[str, Any]) -> dict[str, Any]:
    merged = {**_obj(job.get("metadata")), **_obj(job.get("description"))}
    if isinstance(merged.get("params"), dict): merged = {**merged, **merged["params"]}
    execution = merged.get("execution")
    if isinstance(execution, dict): merged = {**merged, **execution}
    market = merged.get("execution_market")
    if isinstance(market, dict): merged = {**merged, **market}
    return merged


def _provider(job: dict[str, Any]) -> str:
    for key in ("provider", "providerAddress", "provider_address"):
        value = job.get(key)
        if isinstance(value, str) and value.strip(): return value.strip()
    raise RuntimeError("Rebalancing job does not contain its ERC-8183 provider address")


def _authorization_status(job_id: int, provider: str) -> dict[str, Any]:
    base = (os.getenv("AGENTMARKET_EXECUTION_AUTH_STATUS_URL") or "").strip()
    if not base:
        raise RuntimeError("AgentMarket execution-authorization status URL is not configured; refusing state-changing execution")
    separator = "&" if "?" in base else "?"
    url = f"{base}{separator}{urlencode({'job': str(job_id), 'provider': provider})}"
    request = Request(url, headers={"accept": "application/json"}, method="GET")
    try:
        with urlopen(request, timeout=float(os.getenv("EXECUTION_AUTH_STATUS_TIMEOUT", "15"))) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Unable to verify AgentMarket execution authorization: {exc}") from exc
    if not isinstance(payload, dict) or not payload.get("ok"):
        raise RuntimeError(str(payload.get("error") if isinstance(payload, dict) else "Invalid execution authorization response"))
    return payload


def _authorized_execution(job: dict[str, Any], params: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    job_id = int(job.get("jobId", job.get("id", 0)))
    if job_id <= 0: raise RuntimeError("Rebalancing execution requires a valid ERC-8183 job id")
    provider = _provider(job)
    status = _authorization_status(job_id, provider)
    if status.get("required") is not True:
        raise RuntimeError("This rebalancing job has no verified execution-capital authorization request; refusing state-changing execution")
    state = str(status.get("status") or "").lower()
    if state != "authorized":
        raise RuntimeError(f"Rebalancing execution authorization is not active: {state or 'unknown'}")
    auth = status.get("authorization") if isinstance(status.get("authorization"), dict) else {}
    wallet = str(auth.get("execution_wallet") or "").strip()
    token_in = str(params.get("token_in") or params.get("execution_token_in") or auth.get("capital_token") or "").strip()
    token_out = str(params.get("token_out") or params.get("execution_token_out") or os.getenv("EXECUTION_TOKEN_OUT") or os.getenv("ALTANA_SWAP_TOKEN_OUT") or "").strip()
    amount_in = str(params.get("amount_in") or params.get("execution_amount") or os.getenv("ALTANA_SESSION_SPEND_LIMIT") or "").strip()
    if not wallet: raise RuntimeError("Verified execution authorization did not return the user's Altana execution wallet")
    if not token_in: raise RuntimeError("Verified execution authorization did not declare an execution token")
    if not token_out: raise RuntimeError("Rebalancing execution requires token_out in task parameters or EXECUTION_TOKEN_OUT/ALTANA_SWAP_TOKEN_OUT")
    if not amount_in: raise RuntimeError("Rebalancing execution requires amount_in in task parameters or ALTANA_SESSION_SPEND_LIMIT")
    return wallet, {"status": state, "request_id": status.get("request_id"), "session_key_id": auth.get("session_key_id"), "session_expiry": auth.get("session_expiry"), "capital_token": token_in, "capital_authorized": auth.get("capital_authorized") , "token_out": token_out, "amount_in": amount_in}


def fulfill_job(job: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    p = _params(job)
    try:
        current_tick = float(p["current_tick"])
        tick_lower = float(p["tick_lower"])
        tick_upper = float(p["tick_upper"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Rebalancing jobs require current_tick, tick_lower and tick_upper") from exc
    if tick_upper <= tick_lower: raise ValueError("tick_upper must be greater than tick_lower")

    width = tick_upper - tick_lower
    edge_ratio = min(current_tick - tick_lower, tick_upper - current_tick) / width
    if current_tick < tick_lower or current_tick > tick_upper: action = "move_range"
    elif edge_ratio < 0.10: action = "widen"
    else: action = "hold"

    center = (tick_lower + tick_upper) / 2
    target_lower = current_tick - width / 2 if action != "hold" else tick_lower
    target_upper = current_tick + width / 2 if action != "hold" else tick_upper

    execution = None
    execution_status = "observed"
    transaction_hash = None
    authorization: dict[str, Any] = {"required": action != "hold", "obtained": False, "status": "not_required" if action == "hold" else "required"}

    if action != "hold":
        wallet, auth = _authorized_execution(job, p)
        authorization = {"required": True, "obtained": True, **auth}
        minimum_out = str(p.get("amount_out_minimum") or "0").strip()
        try:
            execution = execute_testnet_swap(
                job_id=int(job.get("jobId", job.get("id", 0))),
                wallet_address=wallet,
                token_in=auth["capital_token"],
                token_out=auth["token_out"],
                amount_in=auth["amount_in"],
                amount_out_minimum=minimum_out,
                fee=int(p.get("fee", 2500)),
            )
        except Exception as exc:
            raise RuntimeError(f"Rebalancing execution failed; result will not be submitted: {exc}") from exc
        transaction_hash = execution.get("transaction_hash") if isinstance(execution, dict) else None
        if not transaction_hash: raise RuntimeError("Rebalancing execution returned no transaction hash; result will not be submitted")
        execution_status = "executed"

    payload = {
        "agent": "agentmarket-rebalancing-test",
        "job_id": str(job.get("jobId", job.get("id", ""))),
        "network": "bsc-testnet",
        "task": "rebalancing",
        "observation": {"current_tick": current_tick, "tick_lower": tick_lower, "tick_upper": tick_upper, "range_width": width, "distance_to_center": abs(current_tick - center), "edge_ratio": max(0.0, edge_ratio)},
        "decision": {"action": action, "target_lower": target_lower, "target_upper": target_upper},
        "execution": execution if action != "hold" else "observation_only",
        "execution_status": execution_status,
        "authorization": authorization,
        "note": "State-changing provider execution requires an active job-scoped Altana authorization verified by AgentMarket and then confirmed by the Altana KeyStore at execution time.",
    }
    return json.dumps(payload, separators=(",", ":")), {"execution_status": execution_status, "transaction_hash": transaction_hash, "decision": action}
