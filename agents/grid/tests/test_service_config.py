import pytest

from app.service.config import GridServiceConfigError, validate_runtime_config


def base_config() -> dict[str, str]:
    return {
        "NETWORK": "bsc-testnet",
        "ERC8183_AGENT_URL": "https://grid-test.example.com/erc8183",
        "ERC8183_SERVICE_PRICE": "1000000000000000000",
        "ERC8183_FUNDED_POLL_INTERVAL": "30",
    }


def test_accepts_safe_testnet_configuration() -> None:
    result = validate_runtime_config(base_config())
    assert result["network"] == "bsc-testnet"
    assert result["service_price"] == 1000000000000000000
    assert result["poll_interval"] == 30


def test_rejects_mainnet_network() -> None:
    env = base_config()
    env["NETWORK"] = "bsc-mainnet"
    with pytest.raises(GridServiceConfigError, match="Testnet-only"):
        validate_runtime_config(env)


def test_rejects_non_https_endpoint() -> None:
    env = base_config()
    env["ERC8183_AGENT_URL"] = "http://grid-test.example.com/erc8183"
    with pytest.raises(GridServiceConfigError, match="public HTTPS"):
        validate_runtime_config(env)


def test_rejects_endpoint_without_erc8183_path() -> None:
    env = base_config()
    env["ERC8183_AGENT_URL"] = "https://grid-test.example.com/apex"
    with pytest.raises(GridServiceConfigError, match="end with /erc8183"):
        validate_runtime_config(env)


def test_rejects_non_positive_price() -> None:
    env = base_config()
    env["ERC8183_SERVICE_PRICE"] = "0"
    with pytest.raises(GridServiceConfigError, match="greater than zero"):
        validate_runtime_config(env)


def test_rejects_invalid_poll_interval() -> None:
    env = base_config()
    env["ERC8183_FUNDED_POLL_INTERVAL"] = "2"
    with pytest.raises(GridServiceConfigError, match="between 5 and 300"):
        validate_runtime_config(env)
