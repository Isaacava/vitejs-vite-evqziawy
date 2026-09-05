"""Idempotent ERC-8004 registration for first-party AgentMarket providers.

Startup behavior is deliberately testnet-only. The process never stores a private
key in source control; Railway injects it as an environment secret.
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
REGISTRATION_DELAY = max(0, int(os.getenv("ERC8004_REGISTRATION_DELAY_SECONDS", "0")))


def _provider_endpoint() -> str:
    """Return the provider root, not an operation-specific status URL.

    AgentMarket can discover a legacy ERC-8183 provider from its root response and
    can also resolve a future agent-provider/v1 manifest from this same base URL.
    """
    return f"{ENDPOINT}/erc8183"


def _endpoint() -> AgentEndpoint:
    return AgentEndpoint(
        name="Agent Provider",
        endpoint=_provider_endpoint(),
        version="1.0.0",
    )


def _metadata() -> list[dict[str, str]]:
    return [
        {"key": "protocol", "value": "ERC-8183"},
        {"key": "network", "value": "bsc-testnet"},
        {"key": "provider", "value": "AgentMarket"},
        {"key": "discovery", "value": "agent-provider/v1|legacy-erc8183-root"},
    ]


def _generated_uri(sdk: ERC8004Agent, agent_id: int | None = None) -> str:
    return sdk.generate_agent_uri(
        name=NAME,
        description=DESCRIPTION,
        endpoints=[_endpoint()],
        agent_id=agent_id,
        supported_trust=["reputation"],
    )


def _repair_existing_registration(sdk: ERC8004Agent, existing: dict) -> dict:
    agent_id = int(existing["agent_id"])
    current_uri = str(existing.get("agent_uri") or "")
    parsed = sdk.parse_agent_uri(current_uri) if current_uri else None
    registrations = parsed.get("registrations") if isinstance(parsed, dict) else None
    expected_endpoint = _provider_endpoint()

    if registrations and expected_endpoint in current_uri:
        logger.info(
            "ERC-8004 identity already complete name=%s agent_id=%s owner=%s endpoint=%s",
            NAME,
            agent_id,
            existing.get("owner_address"),
            expected_endpoint,
        )
        return existing

    if REGISTRATION_DELAY:
        logger.info("ERC-8004 incomplete identity detected name=%s agent_id=%s; waiting %ss before repair", NAME, agent_id, REGISTRATION_DELAY)
        time.sleep(REGISTRATION_DELAY)

    final_uri = _generated_uri(sdk, agent_id=agent_id)
    last_error: Exception | None = None
    for attempt in range(1, 5):
        try:
            sdk.contract.set_agent_uri(agent_id, final_uri)
            logger.info("ERC-8004 repaired agent URI name=%s agent_id=%s endpoint=%s", NAME, agent_id, expected_endpoint)
            return {**existing, "agent_uri": final_uri}
        except Exception as exc:
            last_error = exc
            logger.warning("ERC-8004 URI repair attempt %s/4 failed agent_id=%s: %s", attempt, agent_id, exc)
            time.sleep(3 * attempt)
    raise RuntimeError(f"Unable to complete ERC-8004 URI for agent_id={agent_id}") from last_error


def ensure_registration() -> dict:
    if NETWORK != "bsc-testnet":
        raise RuntimeError(f"ERC-8004 registration is restricted to bsc-testnet; got {NETWORK!r}")
    if not ENDPOINT:
        raise RuntimeError("ERC8004_AGENT_ENDPOINT or ERC8183_AGENT_URL is required")

    wallet = EVMWalletProvider(password=PASSWORD, private_key=PRIVATE_KEY)
    logger.info("ERC-8004 registration check name=%s wallet=%s network=%s endpoint=%s", NAME, wallet.address, NETWORK, _provider_endpoint())

    sdk = ERC8004Agent(wallet_provider=wallet, network=NETWORK, debug=False)
    existing = sdk.get_local_agent_info(NAME)
    if existing is not None:
        return _repair_existing_registration(sdk, existing)

    if REGISTRATION_DELAY:
        logger.info("ERC-8004 new identity registration name=%s; waiting %ss before mint", NAME, REGISTRATION_DELAY)
        time.sleep(REGISTRATION_DELAY)

    uri = _generated_uri(sdk)
    result = sdk.register_agent(agent_uri=uri, metadata=_metadata())
    logger.info(
        "ERC-8004 identity registered name=%s agent_id=%s tx=%s owner=%s endpoint=%s",
        NAME,
        result.get("agentId"),
        result.get("transactionHash"),
        wallet.address,
        _provider_endpoint(),
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
    for attempt in range(1, 6):
        try:
            ensure_registration()
            return 0
        except Exception as exc:
            last_error = exc
            logger.error("ERC-8004 registration attempt %s/5 failed: %s", attempt, exc)
            if attempt < 5:
                time.sleep(5 * attempt)
    raise RuntimeError("ERC-8004 registration failed after 5 attempts") from last_error


if __name__ == "__main__":
    raise SystemExit(main())
