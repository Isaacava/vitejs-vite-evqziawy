"""Rebalancing strategy for BSC Testnet LP-position jobs."""

from __future__ import annotations
import json
from typing import Any


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
    if tick_upper <= tick_lower: raise ValueError("tick_upper must be greater than tick_lower")
    width = tick_upper - tick_lower
    edge_ratio = min(current_tick - tick_lower, tick_upper - current_tick) / width
    if current_tick < tick_lower or current_tick > tick_upper: action = "move_range"
    elif edge_ratio < 0.10: action = "widen"
    else: action = "hold"
    center = (tick_lower + tick_upper) / 2
    target_lower = current_tick - width / 2 if action != "hold" else tick_lower
    target_upper = current_tick + width / 2 if action != "hold" else tick_upper
    payload = {
        "agent": "agentmarket-rebalancing-test", "job_id": str(job.get("jobId", job.get("id", ""))),
        "network": "bsc-testnet", "task": "rebalancing",
        "observation": {"current_tick": current_tick, "tick_lower": tick_lower, "tick_upper": tick_upper, "range_width": width, "distance_to_center": abs(current_tick-center), "edge_ratio": max(0.0, edge_ratio)},
        "decision": {"action": action, "target_lower": target_lower, "target_upper": target_upper},
        "execution": "observation_and_plan",
        "note": "The agent determines the LP range action from the job position state. State-changing execution requires an explicitly allowlisted target and scoped Testnet session.",
    }
    return json.dumps(payload, separators=(",", ":")), {"execution_status": "observed", "transaction_hash": None, "decision": action}
