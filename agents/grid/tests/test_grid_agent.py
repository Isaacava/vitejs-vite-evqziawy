import json

from app.agent.main import build_grid_plan, fulfill_grid_job


def test_build_grid_plan_is_deterministic():
    job = {
        "id": "smoke-1",
        "metadata": {
            "lower_price": 600,
            "upper_price": 700,
            "grid_levels": 12,
            "notional": 100,
            "max_slippage_bps": 50,
        },
    }

    plan = build_grid_plan(job)

    assert plan.lower_price == 600
    assert plan.upper_price == 700
    assert plan.grid_levels == 12
    assert plan.total_notional == 100
    assert plan.risk == "conservative"
    assert plan.interval_pct > 0


def test_build_grid_plan_rejects_invalid_range():
    try:
        build_grid_plan(
            {
                "metadata": {
                    "lower_price": 700,
                    "upper_price": 600,
                    "grid_levels": 12,
                    "notional": 100,
                }
            }
        )
    except ValueError as exc:
        assert "upper > lower" in str(exc)
    else:
        raise AssertionError("Expected invalid grid range to fail")


def test_fulfill_grid_job_is_strategy_only():
    deliverable = fulfill_grid_job(
        {
            "id": "smoke-2",
            "metadata": {
                "lower_price": 600,
                "upper_price": 700,
                "grid_levels": 12,
                "notional": 100,
                "max_slippage_bps": 50,
            },
        }
    )

    payload = json.loads(deliverable)
    assert payload["execution"] == "strategy_only"
    assert payload["job_id"] == "smoke-2"
    assert payload["plan"]["grid_levels"] == 12
    assert "No user funds were traded" in payload["note"]
