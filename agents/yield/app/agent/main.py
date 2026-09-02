"""Yield optimisation strategy for BSC Testnet jobs."""

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
    opportunities = p.get("opportunities")
    if not isinstance(opportunities, list) or not opportunities: raise ValueError("Yield jobs require a non-empty opportunities list")
    valid = []
    for item in opportunities:
        if not isinstance(item, dict): continue
        try: apr = float(item["apr"])
        except (KeyError, TypeError, ValueError): continue
        if apr < -100: continue
        valid.append({**item, "apr": apr})
    if not valid: raise ValueError("No valid yield opportunities were supplied")
    valid.sort(key=lambda item: (item["apr"], str(item.get("protocol", ""))), reverse=True)
    winner = valid[0]
    payload = {
        "agent": "agentmarket-yield-test", "job_id": str(job.get("jobId", job.get("id", ""))), "network": "bsc-testnet", "task": "yield_optimisation",
        "selection": {"protocol": winner.get("protocol"), "market": winner.get("market"), "apr": winner["apr"], "target": winner.get("target")},
        "candidates": [{"protocol": i.get("protocol"), "market": i.get("market"), "apr": i["apr"]} for i in valid],
        "execution": "observation_and_route_plan",
        "note": "The agent selects the highest APR from the supplied snapshot. Liquidity-moving transactions require an explicitly allowlisted Testnet target and scoped execution session.",
    }
    return json.dumps(payload, separators=(",", ":")), {"execution_status": "evaluated", "transaction_hash": None, "selected_apr": winner["apr"]}
