"""Rebalancing strategy for BSC Testnet LP-position jobs."""

from __future__ import annotations
import json
import os
from typing import Any

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

    execute_requested = str(p.get("execute", "")).lower() in {"1", "true", "yes"}

    # A state-changing rebalancing decision is never valid as an observation-only submission.
    if action != "hold" and not execute_requested:
        raise RuntimeError(
            f"Rebalancing decision '{action}' requires execution authorization and an execution token before submission"
        )

    execution = None
    execution_status = "observed"
    transaction_hash = None

    if execute_requested:
        if action == "hold":
            raise ValueError("Rebalancing execution requested but the strategy decision is hold")

        wallet = str(p.get("execution_wallet") or p.get("user_altana_wallet") or "").strip()
        token_in = str(p.get("token_in") or os.getenv("ALTANA_SESSION_SPEND_TOKEN") or "").strip()
        token_out = str(p.get("token_out") or os.getenv("ALTANA_SWAP_TOKEN_OUT") or "").strip()
        amount_in = str(p.get("amount_in") or "").strip()
        minimum_out = str(p.get("amount_out_minimum") or "0").strip()

        if not wallet or not token_in or not token_out or not amount_in:
            raise RuntimeError(
                "Rebalancing execution requires execution_wallet, token_in, token_out and amount_in; no result will be submitted"
            )
        if not os.getenv("ALTANA_SESSION_SPEND_TOKEN") and not p.get("token_in"):
            raise RuntimeError("Execution token authorization is missing; request the scoped execution token before submission")

        try:
            execution = execute_testnet_swap(
                job_id=int(job.get("jobId", job.get("id", 0))),
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
        "authorization": {"required": action != "hold", "obtained": bool(execution), "token": token_in if execution else None},
        "note": "State-changing execution is permitted only through the agent's allowlisted Altana scoped Testnet session and must succeed before result submission.",
    }
    return json.dumps(payload, separators=(",", ":")), {
        "execution_status": execution_status,
        "transaction_hash": transaction_hash,
        "decision": action,
    }
