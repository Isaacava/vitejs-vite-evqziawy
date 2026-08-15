from datetime import datetime, timedelta, timezone
from decimal import Decimal

from policy import ActionProposal, GuardrailPolicy, evaluate


POLICY = GuardrailPolicy(
    max_spend=Decimal("100"),
    max_slippage_bps=100,
    allowed_tokens=("BNB", "USDT"),
    allowed_protocols=("pancake",),
)


def proposal(**overrides):
    values = {
        "token": "BNB",
        "protocol": "pancake",
        "notional": Decimal("25"),
        "risk_level": "low",
        "slippage_bps": 50,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
    }
    values.update(overrides)
    return ActionProposal(**values)


def test_approve_within_guardrails():
    assert evaluate(POLICY, proposal()).decision == "approve"


def test_block_for_spend_cap():
    result = evaluate(POLICY, proposal(notional=Decimal("101")))
    assert result.decision == "block"


def test_user_approval_for_high_risk():
    result = evaluate(POLICY, proposal(risk_level="high"))
    assert result.decision == "user_approval"
