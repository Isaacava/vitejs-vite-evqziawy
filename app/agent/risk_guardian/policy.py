"""Risk Guardian decision policy.

This module is deliberately non-custodial. It evaluates a proposed action and
returns a decision; it never signs transactions or moves user funds.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal, Sequence

Decision = Literal["approve", "block", "user_approval"]


@dataclass(frozen=True)
class GuardrailPolicy:
    max_spend: Decimal
    max_slippage_bps: int = 100
    allowed_tokens: tuple[str, ...] = ()
    allowed_protocols: tuple[str, ...] = ()
    require_expiry: bool = True


@dataclass(frozen=True)
class ActionProposal:
    token: str
    protocol: str
    notional: Decimal
    risk_level: str
    slippage_bps: int
    expires_at: datetime | None


@dataclass(frozen=True)
class DecisionResult:
    decision: Decision
    reasons: tuple[str, ...]


def _normalise(value: str) -> str:
    return value.strip().lower()


def evaluate(policy: GuardrailPolicy, proposal: ActionProposal) -> DecisionResult:
    reasons: list[str] = []

    token = _normalise(proposal.token)
    protocol = _normalise(proposal.protocol)
    risk = _normalise(proposal.risk_level)

    if policy.allowed_tokens and token not in {_normalise(v) for v in policy.allowed_tokens}:
        reasons.append("Token is outside the approved allowlist.")

    if policy.allowed_protocols and protocol not in {_normalise(v) for v in policy.allowed_protocols}:
        reasons.append("Protocol is outside the approved allowlist.")

    if proposal.notional > policy.max_spend:
        reasons.append("Requested value exceeds the configured spend cap.")

    if proposal.slippage_bps > policy.max_slippage_bps:
        reasons.append("Requested slippage exceeds the configured guardrail.")

    if risk in {"high", "critical"}:
        reasons.append("Risk classification requires explicit user approval.")

    if policy.require_expiry:
        if proposal.expires_at is None:
            reasons.append("Proposal expiry is required.")
        elif proposal.expires_at <= datetime.now(timezone.utc):
            reasons.append("Proposal expiry is missing or already elapsed.")

    if not reasons:
        return DecisionResult("approve", ("Proposal is within the configured guardrails.",))

    hard_blocks = (
        "allowlist",
        "spend cap",
        "slippage",
        "already elapsed",
    )
    if any(any(marker in reason.lower() for marker in hard_blocks) for reason in reasons):
        return DecisionResult("block", tuple(reasons))

    return DecisionResult("user_approval", tuple(reasons))
