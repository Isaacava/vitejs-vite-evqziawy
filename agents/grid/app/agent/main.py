"""Grid Agent test runtime.

The first-party Grid Agent produces a strategy deliverable and declares the
execution market it expects. It does not custody or execute user trading
funds directly. The BNB Agent SDK service layer watches for FUNDED ERC-8183
jobs, calls ``fulfill_grid_job()``, stores the result, and submits the
 deliverable on-chain.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


TESTNET_CAKE2 = "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551"
TESTNET_WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd"
TESTNET_PANCAKE_FEE = 2500


@dataclass(frozen=True)
class GridPlan:
    lower_price: float
    upper_price: float
    grid_levels: int
    interval_pct: float
    total_notional: float
    risk: str


def _parse_json_object(value: Any) -> dict[str, Any]:
    """Decode an optional JSON object from an SDK job field."""
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _job_parameters(job: dict[str, Any]) -> dict[str, Any]:
    """Extract grid parameters from both legacy metadata and ERC-8183 description.

    The BNB Agent SDK's ERC-8183 ``on_job`` callback exposes the anchored task
    description. Older local tests used a ``metadata`` object, so both forms
    remain supported. ``params`` is accepted as a convenience wrapper for
    marketplace-generated descriptions.
    """
    metadata = _parse_json_object(job.get("metadata"))
    description = _parse_json_object(job.get("description"))

    params = description.get("params")
    if isinstance(params, dict):
        description = {**description, **params}

    merged = {**metadata, **description}
    return merged


def build_grid_plan(job: dict[str, Any]) -> GridPlan:
    """Build a deterministic grid strategy from a funded ERC-8183 job.

    Missing values fail closed instead of silently producing a strategy.
    This agent remains strategy-first: execution is separately controlled by
    the scoped execution service and declared capability.
    """
    parameters = _job_parameters(job)

    lower = float(parameters.get("lower_price", 0))
    upper = float(parameters.get("upper_price", 0))
    levels = int(parameters.get("grid_levels", 0))
    notional = float(parameters.get("notional", 0))
    max_slippage_bps = int(parameters.get("max_slippage_bps", 150))

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
        "job_id": str(job.get("jobId", job.get("id", ""))),
        "execution": "strategy_only",
        "execution_market": {
            "network": "bsc-testnet",
            "protocol": "pancake-v3",
            "token_in": {
                "symbol": "CAKE2",
                "address": TESTNET_CAKE2,
            },
            "token_out": {
                "symbol": "WBNB",
                "address": TESTNET_WBNB,
            },
            "fee": TESTNET_PANCAKE_FEE,
        },
        "plan": {
            "lower_price": plan.lower_price,
            "upper_price": plan.upper_price,
            "grid_levels": plan.grid_levels,
            "interval_pct": plan.interval_pct,
            "total_notional": plan.total_notional,
            "risk": plan.risk,
        },
        "note": "No user funds were traded; this deliverable declares the Testnet execution market and provides a strategy plan pending Risk Guardian approval and scoped wallet execution.",
    }
    return json.dumps(payload, separators=(",", ":"))


if __name__ == "__main__":
    sample = {
        "jobId": "test-grid-1",
        "description": json.dumps(
            {
                "marketplace": "AgentMarket",
                "params": {
                    "lower_price": 600.0,
                    "upper_price": 700.0,
                    "grid_levels": 12,
                    "notional": 100.0,
                    "max_slippage_bps": 50,
                },
            }
        ),
    }
    print(fulfill_grid_job(sample))
