"""Execution-capital capability model for the first-party Grid Agent.

Grid is BSC Testnet-only and can perform agent-owned execution through an
already-authorized Altana scoped session. This module describes that declared
capability; it does not grant permissions. The user's on-chain Altana session
remains the authoritative authorization boundary.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping


class ExecutionCapitalConfigError(ValueError):
    """Raised when execution-capital configuration is invalid."""


@dataclass(frozen=True)
class ExecutionCapitalProfile:
    enabled: bool
    network: str
    chain_id: int
    wallet_provider: str
    wallet_model: str
    transaction_authority: str
    capital_model: str
    supports_deposit: bool
    supports_withdrawal: bool
    supports_trading: bool
    supported_assets: tuple[str, ...]
    max_capital: float | None
    authorization: Mapping[str, Any]
    note: str


def build_execution_capital_profile(
    env: Mapping[str, str] | None = None,
    wallet_address: str | None = None,
) -> dict[str, Any]:
    source = env or {}
    network = str(source.get("NETWORK", "bsc-testnet")).strip().lower()
    if network != "bsc-testnet":
        raise ExecutionCapitalConfigError("Execution capital is Testnet-only: NETWORK must be bsc-testnet.")

    address = (wallet_address or str(source.get("ALTANA_WALLET_ADDRESS", "")).strip()).strip()
    if address and not (len(address) == 42 and address.startswith("0x")):
        raise ExecutionCapitalConfigError("ALTANA_WALLET_ADDRESS must be a valid-looking EVM address when provided.")

    token = str(source.get("ALTANA_SESSION_SPEND_TOKEN", "")).strip()
    if token and not (len(token) == 42 and token.startswith("0x")):
        raise ExecutionCapitalConfigError("ALTANA_SESSION_SPEND_TOKEN must be a valid-looking EVM address when provided.")

    spend_limit_raw = str(source.get("ALTANA_SESSION_SPEND_LIMIT", "")).strip()
    max_capital = None
    if spend_limit_raw.isdigit():
        max_capital = float(int(spend_limit_raw) / 10**18)

    enabled = bool(
        source.get("ALTANA_SESSION_PRIVATE_KEY")
        and address
        and token
        and spend_limit_raw.isdigit()
        and int(spend_limit_raw) > 0
    )

    profile = ExecutionCapitalProfile(
        enabled=enabled,
        network=network,
        chain_id=97,
        wallet_provider="altana",
        wallet_model="user_authorized_scoped_session",
        transaction_authority="altana_session",
        capital_model="scoped_execution_capital",
        supports_deposit=True,
        supports_withdrawal=True,
        supports_trading=enabled,
        supported_assets=((token,) if token else ()),
        max_capital=max_capital,
        authorization={
            "model": "scoped_session",
            "on_chain": True,
            "user_personal_wallet_delegation": True,
            "source": "altana_keystore",
            "allowed_targets": [
                item.strip()
                for item in str(source.get("GRID_ALLOWED_TARGETS", "")).split(",")
                if item.strip()
            ],
            "allowed_selectors": [
                item.strip()
                for item in str(source.get("GRID_ALLOWED_SELECTORS", "")).split(",")
                if item.strip()
            ],
            "session_expiry": source.get("ALTANA_SESSION_EXPIRY") or None,
        },
        note=(
            "Grid can perform BSC Testnet execution only through an already-authorized "
            "Altana scoped session. The user's on-chain session grant is authoritative; "
            "this capability declaration does not itself grant trading permission."
        ),
    )

    payload = asdict(profile)
    payload["supported_assets"] = list(profile.supported_assets)
    payload["agent_wallet_address"] = address or None
    return payload
