"""Idempotent ERC-8004 registration for first-party AgentMarket providers.

This script is intended to run inside an agent container at startup. It uses the
same EVM wallet already used by the agent's ERC-8183 provider, checks whether an
ERC-8004 registration already exists for the configured name, and registers it
only when necessary.

Testnet only. No private key is stored in source control.
"""
from __future__ import annotations

import logging
import os
import time

from bnbagent import AgentEndpoint, ERC8004Agent, EVMWalletProvider

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("agentmarket_erc8004")

NETWORK = (os.getenv("NETWORK") or "bsc-testnet").strip().lower()
NAME = (os.getenv("ERC8004_AGENT_NAME") or os.getenv("AGENT_DISPLAY_NAME") or "AgentMarket Agent").strip()
DESCRIPTION = (
    os.getenv("ERC8004_AGENT_DESCRIPTION")
    or f"First-party AgentMarket {NAME} provider on BSC Testnet."
).strip()
ENDPOINT = (os.getenv("ERC8004_AGENT_ENDPOINT") or os.getenv("ERC8183_AGENT_URL") or "").rstrip("/")
PASSWORD = os.environ["WALLET_PASSWORD"]
PRIVATE_KEY = os.getenv("PRIVATE_KEY")


def ensure_registration() -> dict:
    if NETWORK != "bsc-testnet":
        raise RuntimeError(f"ERC-8004 registration is restricted to bsc-testnet; got {NETWORK!r}")
    if not ENDPOINT:
        raise RuntimeError("ERC8004_AGENT_ENDPOINT or ERC8183_AGENT_URL is required")

    wallet = EVMWalletProvider(password=PASSWORD, private_key=PRIVATE_KEY)
    logger.info("ERC-8004 registration check name=%s wallet=%s network=%s", NAME, wallet.address, NETWORK)

    sdk = ERC8004Agent(wallet_provider=wallet, network=NETWORK, debug=False)
    existing = sdk.get_local_agent_info(NAME)
    if existing is not None:
        logger.info(
            "ERC-8004 identity already registered name=%s agent_id=%s owner=%s",
            NAME,
            existing.get("agent_id"),
            existing.get("owner_address"),
        )
        return existing

    uri = sdk.generate_agent_uri(
        name=NAME,
        description=DESCRIPTION,
        endpoints=[
            AgentEndpoint(
                name="ERC-8183",
                endpoint=f"{ENDPOINT}/erc8183/status",
                version="0.1.0",
            )
        ],
        supported_trust=["reputation"],
    )

    result = sdk.register_agent(
        agent_uri=uri,
        metadata=[
            {"key": "protocol", "value": "ERC-8183"},
            {"key": "network", "value": "bsc-testnet"},
            {"key": "provider", "value": "AgentMarket"},
        ],
    )
    logger.info(
        "ERC-8004 identity registered name=%s agent_id=%s tx=%s owner=%s",
        NAME,
        result.get("agentId"),
        result.get("transactionHash"),
        wallet.address,
    )
    return {
        "name": NAME,
        "agent_id": result.get("agentId"),
        "owner_address": wallet.address,
        "agent_uri": result.get("agentURI"),
        "transaction_hash": result.get("transactionHash"),
    }


def main() -> int:
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            ensure_registration()
            return 0
        except Exception as exc:
            last_error = exc
            logger.error("ERC-8004 registration attempt %s/3 failed: %s", attempt, exc)
            if attempt < 3:
                time.sleep(5 * attempt)
    raise RuntimeError("ERC-8004 registration failed after 3 attempts") from last_error


if __name__ == "__main__":
    raise SystemExit(main())
