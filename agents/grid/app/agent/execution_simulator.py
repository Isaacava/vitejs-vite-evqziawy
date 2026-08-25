"""Non-custodial Testnet execution simulator for the first-party Grid Agent.

This module models execution-capital state without signing transactions,
requesting token approvals, moving assets, or calling a DEX. It exists so the
marketplace can exercise the execution lifecycle safely before a real,
protocol-supported execution adapter is introduced.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any


class ExecutionSimulationError(ValueError):
    """Raised when a simulation request is invalid."""


@dataclass(frozen=True)
class SimulationPolicy:
    """Guardrails used by the simulator."""

    max_capital: Decimal = Decimal("1000")
    max_duration_seconds: int = 86_400


@dataclass
class ExecutionSimulation:
    """An in-memory, non-custodial execution-capital simulation."""

    requested_capital: Decimal
    duration_seconds: int
    policy: SimulationPolicy = field(default_factory=SimulationPolicy)
    status: str = "prepared"
    deployed_capital: Decimal = Decimal("0")
    ending_value: Decimal = Decimal("0")
    realized_pnl: Decimal = Decimal("0")
    events: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.requested_capital <= 0:
            raise ExecutionSimulationError("requested_capital must be positive")
        if self.requested_capital > self.policy.max_capital:
            raise ExecutionSimulationError("requested_capital exceeds simulator guardrail")
        if self.duration_seconds <= 0 or self.duration_seconds > self.policy.max_duration_seconds:
            raise ExecutionSimulationError("duration_seconds exceeds simulator guardrail")
        self.events.append(
            {
                "type": "prepared",
                "capital": str(self.requested_capital),
                "duration_seconds": self.duration_seconds,
                "custody": "none",
                "execution": "simulation_only",
            }
        )

    def start(self) -> None:
        if self.status != "prepared":
            raise ExecutionSimulationError("simulation can only start from prepared state")
        self.status = "running"
        self.deployed_capital = self.requested_capital
        self.ending_value = self.requested_capital
        self.events.append({"type": "started", "deployed_capital": str(self.deployed_capital)})

    def apply_pnl(self, pnl: Decimal | str | float) -> None:
        if self.status != "running":
            raise ExecutionSimulationError("P&L can only be applied while simulation is running")
        try:
            value = Decimal(str(pnl))
        except (InvalidOperation, ValueError) as exc:
            raise ExecutionSimulationError("pnl must be numeric") from exc
        self.realized_pnl += value
        self.ending_value = self.requested_capital + self.realized_pnl
        self.events.append(
            {
                "type": "pnl_update",
                "pnl": str(value),
                "cumulative_pnl": str(self.realized_pnl),
                "ending_value": str(self.ending_value),
            }
        )

    def finish(self) -> dict[str, Any]:
        if self.status != "running":
            raise ExecutionSimulationError("simulation can only finish while running")
        self.status = "finished"
        self.events.append(
            {
                "type": "finished",
                "starting_capital": str(self.requested_capital),
                "ending_value": str(self.ending_value),
                "realized_pnl": str(self.realized_pnl),
                "capital_return_model": "simulation_only_no_asset_transfer",
            }
        )
        return self.snapshot()

    def snapshot(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "requested_capital": str(self.requested_capital),
            "deployed_capital": str(self.deployed_capital),
            "ending_value": str(self.ending_value),
            "realized_pnl": str(self.realized_pnl),
            "custody": "none",
            "asset_transfer": False,
            "transactions": [],
            "events": list(self.events),
        }


def build_simulation_from_job(job: dict[str, Any]) -> ExecutionSimulation:
    """Build a simulator from job metadata without touching a wallet or chain."""
    metadata = job.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    try:
        capital = Decimal(str(metadata.get("execution_capital", "100")))
        duration = int(metadata.get("execution_duration_seconds", 3_600))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ExecutionSimulationError("Invalid execution simulation parameters") from exc

    return ExecutionSimulation(requested_capital=capital, duration_seconds=duration)
