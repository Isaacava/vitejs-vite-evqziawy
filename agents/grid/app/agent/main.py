"""Grid Agent test runtime.

The first-party Grid Agent deliberately produces a strategy deliverable only.
It does not custody or execute user trading funds. The next integration layer
can place a Risk Guardian approval and scoped wallet session in front of any
future execution adapter.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class GridPlan:
    lower_price: float
    upper_price: float
    grid_levels: int
    interval_pct: float
    total_notional: float
    risk: str



def build_grid_plan(job: dict[str, Any]) -> GridPlan:
    """Build a deterministic grid strategy from a funded job description.

    The service expects optional JSON in job['metadata'] or job['description'].
    Missing values use conservative test defaults and do not execute trades.
    """
    metadata = job.get("metadata") or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except json.JSONDecodeError:
            metadata = {}

    lower = float(metadata.get("lower_price", 0))
    upper = float(metadata.get("upper_price", 0))
    levels = int(metadata.get("grid_levels", 0))
    notional = float(metadata.get("notional", 0))
    max_slippage_bps = int(metadata.get("max_slippage_bps", 150))

    if lower <= 0 or upper <= 0 or upper <= lower:
        raise ValueError("Grid range must have positive lower and upper prices with upper > lower")
    if levels < 2 or levels > 100:
        raise ValueError("grid_levels must be between 2 and 100")
    if notional <= 0:
        raise ValueError("notional must be positive")
    if max_slippage_bps < 0 or max_slippage_bps > 150:
        raise ValueError("max_slippage_bps exceeds the test guardrail")

    interval_pct = ((upper / lower) ** (1 / (levels - 1)) - 1) * 100
    risk = "conservative" if max_slippage_bps <= 50 else "standard"

    return GridPlan(
        lower_price=lower,
        upper_price=upper,
        grid_levels=levels,
        interval_pct=round(interval_pct, 6),
        total_notional=notional,
        risk=risk,
    )


def fulfill_grid_job(job: dict[str, Any]) -> str:
    """Produce the deliverable for one funded ERC-8183 Grid job."""
    plan = build_grid_plan(job)
    payload = {
        "agent": "agentmarket-grid-test",
        "job_id": str(job.get("id", "")),
        "execution": "strategy_only",
        "plan": {
            "lower_price": plan.lower_price,
            "upper_price": plan.upper_price,
            "grid_levels": plan.grid_levels,
            "interval_pct": plan.interval_pct,
            "total_notional": plan.total_notional,
            "risk": plan.risk,
        },
        "note": "No user funds were traded; this deliverable is a testnet execution plan pending Risk Guardian approval and scoped wallet execution.",
    }
    return json.dumps(payload, separators=(",", ":"))


if __name__ == "__main__":
    sample = {
        "id": "test-grid-1",
        "metadata": {
            "lower_price": 600.0,
            "upper_price": 700.0,
            "grid_levels": 12,
            "notional": 100.0,
            "max_slippage_bps": 50,
        },
    }
    print(fulfill_grid_job(sample))
