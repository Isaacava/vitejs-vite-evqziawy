"""Rebalancing strategy for BSC Testnet LP-position jobs."""

from __future__ import annotations
import json
from typing import Any

from agents.shared.execution_authorization import wait_for_execution_authorization
from app.agent.execution import execute_testnet_swap


def _obj(value: Any) -> dict[str, Any]:
    if isinstance(value, dict): return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _params(job: dict[str, Any]) -> dict[str, Any]:
    merged = {**_obj(job.get("metadata")), **_obj(job.get("description"))}
    if isinstance(merged.get("params"), dict): merged = {**merged, **merged["params"]}
    execution = merged.get("execution")
    if isinstance(execution, dict): merged = {**merged, **execution}
    market = merged.get("execution_market")
    if isinstance(market, dict): merged = {**merged, **market}
    return merged


def fulfill_job(job: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    p = _params(job)
    try:
        current_tick = float(p["current_tick"])
        tick_lower = float(p["tick_lower"])
        tick_upper = float(p["tick_upper"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Rebalancing jobs require current_tick, tick_lower and tick_upper") from exc
    if tick_upper <= tick_lower:
        raise ValueError("tick_upper must be greater than tick_lower")

    width = tick_upper - tick_lower
    edge_ratio = min(current_tick - tick_lower, tick_upper - current_tick) / width
    if current_tick < tick_lower or current_tick > tick_upper:
        action = "move_range"
    elif edge_ratio < 0.10:
        action = "widen"
    else:
        action = "hold"

    center = (tick_lower + tick_upper) / 2
    target_lower = current_tick - width / 2 if action != "hold" else tick_lower
    target_upper = current_tick + width / 2 if action != "hold" else tick_upper

    execution = None
    execution_status = "observed"
    transaction_hash = None
    authorization: dict[str, Any] = {"required": False, "obtained": False, "status": "not_required"}

    if action != "hold":
        try:
            job_id = int(job.get("jobId", job.get("id", 0)))
        except (TypeError, ValueError) as exc:
            raise RuntimeError("Rebalancing execution requires a valid ERC-8183 job id") from exc
        if job_id <= 0:
            raise RuntimeError("Rebalancing execution requires a positive ERC-8183 job id")

        provider_address = str(job.get("provider") or job.get("providerAddress") or job.get("provider_address") or "").strip()
        if not provider_address:
            raise RuntimeError("Rebalancing execution requires the ERC-8183 provider address")

        # A state-changing decision cannot execute until the same ERC-8183
        # job has an independently verified Altana scoped session. The agent
        # polls the marketplace status endpoint; it never receives a user key.
        granted = wait_for_execution_authorization(job_id, provider_address)
        authorization = {
            "required": True,
            "obtained": True,
            "status": "authorized",
            "request_id": granted.get("request_id"),
            "execution_wallet": granted.get("execution_wallet"),
            "session_key_id": granted.get("session_key_id"),
            "session_expiry": granted.get("session_expiry"),
            "capital_token": granted.get("capital_token"),
        }

        wallet = str(granted.get("execution_wallet") or "").strip()
        token_in = str(granted.get("capital_token") or p.get("token_in") or "").strip()
        token_out = str(p.get("token_out") or "").strip()
        amount_in = str(p.get("amount_in") or p.get("execution_amount_raw") or "").strip()
        minimum_out = str(p.get("amount_out_minimum") or p.get("amount_out_minimum_raw") or "0").strip()

        if not wallet or not token_in or not token_out or not amount_in:
            raise RuntimeError("Rebalancing execution requires an authorized execution wallet, token_in, token_out and amount_in; no result will be submitted")

        try:
            execution = execute_testnet_swap(
                job_id=job_id,
                wallet_address=wallet,
                token_in=token_in,
                token_out=token_out,
                amount_in=amount_in,
                amount_out_minimum=minimum_out,
                fee=int(p.get("fee", 2500)),
            )
        except Exception as exc:
            raise RuntimeError(f"Rebalancing execution failed; result will not be submitted: {exc}") from exc

        transaction_hash = execution.get("transaction_hash") if isinstance(execution, dict) else None
        if not transaction_hash:
            raise RuntimeError("Rebalancing execution returned no transaction hash; result will not be submitted")
        execution_status = "executed"

    payload = {
        "agent": "agentmarket-rebalancing-test",
        "job_id": str(job.get("jobId", job.get("id", ""))),
        "network": "bsc-testnet",
        "task": "rebalancing",
        "observation": {
            "current_tick": current_tick,
            "tick_lower": tick_lower,
            "tick_upper": tick_upper,
            "range_width": width,
            "distance_to_center": abs(current_tick - center),
            "edge_ratio": max(0.0, edge_ratio),
        },
        "decision": {"action": action, "target_lower": target_lower, "target_upper": target_upper},
        "execution": execution if action != "hold" else "observation_only",
        "execution_status": execution_status,
        "authorization": authorization,
        "note": "State-changing execution requires a request-scoped Altana session verified by AgentMarket before the standalone provider executes.",
    }
    return json.dumps(payload, separators=(",", ":")), {
        "execution_status": execution_status,
        "transaction_hash": transaction_hash,
        "decision": action,
        "authorization_status": authorization.get("status"),
    }
