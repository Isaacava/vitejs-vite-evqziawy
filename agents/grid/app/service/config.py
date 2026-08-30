"""Runtime configuration validation for the first-party Grid Agent service."""

from __future__ import annotations

import os
from typing import Mapping
from urllib.parse import urlparse


class GridServiceConfigError(RuntimeError):
    """Raised when the Grid Agent service configuration is unsafe or incomplete."""


def validate_runtime_config(env: Mapping[str, str] | None = None) -> dict[str, str | int]:
    source = env if env is not None else os.environ

    network = str(source.get("NETWORK", "")).strip().lower()
    if network != "bsc-testnet":
        raise GridServiceConfigError(
            "Grid Agent service is Testnet-only: NETWORK must be exactly 'bsc-testnet'."
        )

    endpoint = str(source.get("ERC8183_AGENT_URL", "")).strip()
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" or not parsed.netloc:
        raise GridServiceConfigError(
            "ERC8183_AGENT_URL must be a public HTTPS URL for the Testnet service."
        )
    if "mainnet" in endpoint.lower() or ("bscscan.com" in endpoint.lower() and "testnet" not in endpoint.lower()):
        raise GridServiceConfigError("Grid Agent endpoint must not reference a Mainnet service.")
    if not parsed.path.rstrip("/").endswith("/erc8183"):
        raise GridServiceConfigError("ERC8183_AGENT_URL must end with /erc8183.")

    raw_price = str(source.get("ERC8183_SERVICE_PRICE", "")).strip()
    try:
        service_price = int(raw_price)
    except ValueError as exc:
        raise GridServiceConfigError("ERC8183_SERVICE_PRICE must be an integer in raw token units.") from exc
    if service_price <= 0:
        raise GridServiceConfigError("ERC8183_SERVICE_PRICE must be greater than zero.")

    raw_poll = str(source.get("ERC8183_FUNDED_POLL_INTERVAL", "30")).strip()
    try:
        poll_interval = int(raw_poll)
    except ValueError as exc:
        raise GridServiceConfigError("ERC8183_FUNDED_POLL_INTERVAL must be an integer number of seconds.") from exc
    if poll_interval < 5 or poll_interval > 300:
        raise GridServiceConfigError("ERC8183_FUNDED_POLL_INTERVAL must be between 5 and 300 seconds.")

    return {
        "network": network,
        "endpoint": endpoint,
        "service_price": service_price,
        "poll_interval": poll_interval,
    }
