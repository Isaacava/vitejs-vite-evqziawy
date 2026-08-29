"""Grid Agent test runtime.

Grid is the first-party BNB Agent Studio test agent for AgentMarket. It accepts
ERC-8183 jobs, builds a grid strategy, and—when its own execution configuration
and an already-authorized Altana session are present—performs the declared BSC
Testnet execution itself before the ERC-8183 deliverable is submitted.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

from app.agent.execution import execute_grid_trade


TESTNET_CAKE2 = "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551"
TESTNET_WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd"
TESTNET_PANCAKE_FEE = 500


@dataclass(frozen=True)
class GridPlan:
    lower_price: float
    upper_price: float
    grid_levels: int
    interval_pct: float
    total_notional: float
    risk: str


def _parse_json_object(value: Any) -> dict[str, Any]:
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
    metadata = _parse_json_object(job.get("metadata"))
    description = _parse_json_object(job.get("description"))

    params = description.get("params")
    if isinstance(params, dict):
        description = {**description, **params}

    merged = {**metadata, **description}
    execution = merged.get("execution")
    if isinstance(execution, dict):
        merged = {**merged, **execution}
    execution_market = merged.get("execution_market")
    if isinstance(execution_market, dict):
        merged = {**merged, **execution_market}
    return merged


def build_grid_plan(job: dict[str, Any]) -> GridPlan:
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
    return GridPlan(lower, upper, levels, round(interval_pct, 6), notional, risk)


def _strategy_payload(job: dict[str, Any], plan: GridPlan) -> dict[str, Any]:
    return {
        "agent": "agentmarket-grid-test",
        "job_id": str(job.get("jobId", job.get("id", ""))),
        "execution_market": {
            "network": "bsc-testnet",
            "protocol": "pancake-v3",
            "token_in": {"symbol": "CAKE2", "address": TESTNET_CAKE2},
            "token_out": {"symbol": "WBNB", "address": TESTNET_WBNB},
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
    }


def fulfill_grid_job(job: dict[str, Any]) -> str:
    """Synchronous strategy-only helper retained for local tests."""
    plan = build_grid_plan(job)
    payload = _strategy_payload(job, plan)
    payload["execution"] = "strategy_only"
    payload["note"] = "Strategy-only helper. The live ERC-8183 service invokes the agent-owned execution path when Grid's authorized Altana session is configured."
    return json.dumps(payload, separators=(",", ":"))


async def fulfill_grid_job_with_execution(job: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Execute the funded job through Grid's own scoped Altana session.

    A live ERC-8183 provider result is submit-worthy only after the agent has
    completed its execution and observed a successful receipt. Authorization,
    funding, allowance, or execution failures are raised back to the watcher so
    the funded job remains pending and can be retried after the blocker clears.
    """
    plan = build_grid_plan(job)
    payload = _strategy_payload(job, plan)
    execution_enabled = (os.getenv("GRID_AUTO_EXECUTE_TESTNET", "true") or "true").strip().lower() not in {"0", "false", "no", "off"}

    if not execution_enabled:
        raise RuntimeError("Grid Testnet execution is disabled; no ERC-8183 deliverable will be submitted")

    result = await execute_grid_trade(job)
    transaction_hash = result.get("transaction_hash")
    execution_status = result.get("status")
    if not transaction_hash:
        raise RuntimeError("Grid execution completed without a transaction hash")
    if execution_status not in {"CONFIRMED", "PENDING"}:
        raise RuntimeError(f"Grid execution did not return an acceptable transaction status: {execution_status}")

    receipt = result.get("receipt") or {}
    receipt_status = str(receipt.get("status") or receipt.get("executionStatus") or "").lower()
    if receipt_status and receipt_status not in {"success", "confirmed", "0x1", "1"}:
        raise RuntimeError(f"Grid observed an unsuccessful Testnet receipt for transaction {transaction_hash}")

    payload["execution"] = "agent_owned_testnet"
    payload["execution_result"] = {
        "status": execution_status,
        "calls_id": result.get("calls_id"),
        "transaction_hash": transaction_hash,
        "receipt": receipt,
    }
    payload["note"] = "Grid autonomously ran the authorized Testnet execution through its own Altana session and observed the receipt before submitting this ERC-8183 deliverable."
    return json.dumps(payload, separators=(",", ":")), {
        "execution_status": "executed",
        "transaction_hash": transaction_hash,
        "calls_id": result.get("calls_id"),
    }


if __name__ == "__main__":
    sample = {
        "jobId": "test-grid-1",
        "description": json.dumps({"params": {"lower_price": 600.0, "upper_price": 700.0, "grid_levels": 12, "notional": 100.0, "max_slippage_bps": 50}}),
    }
    print(fulfill_grid_job(sample))
