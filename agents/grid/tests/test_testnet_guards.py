from app.agent.main import build_grid_plan


def test_slippage_guard_rejects_values_above_test_limit():
    try:
        build_grid_plan(
            {
                "metadata": {
                    "lower_price": 600,
                    "upper_price": 700,
                    "grid_levels": 12,
                    "notional": 100,
                    "max_slippage_bps": 151,
                }
            }
        )
    except ValueError as exc:
        assert "test guardrail" in str(exc)
    else:
        raise AssertionError("Expected the Testnet slippage guardrail to reject 151 bps")


def test_grid_levels_are_bounded():
    for levels in (1, 101):
        try:
            build_grid_plan(
                {
                    "metadata": {
                        "lower_price": 600,
                        "upper_price": 700,
                        "grid_levels": levels,
                        "notional": 100,
                        "max_slippage_bps": 50,
                    }
                }
            )
        except ValueError as exc:
            assert "between 2 and 100" in str(exc)
        else:
            raise AssertionError(f"Expected grid_levels={levels} to fail")
