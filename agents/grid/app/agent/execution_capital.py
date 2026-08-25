"""Execution-capital capability model for the first-party Grid Agent.

This module deliberately describes and validates the execution-capital boundary;
it does not transfer, custody, or trade funds. The first implementation remains
BSC Testnet-only until a real DeFi execution adapter and supported authorization
mechanism are wired in.
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


def build_execution_capital_profile(env: Mapping[str, str] | None = None, wallet_address: str | None = None) -> dict[str, Any]:
    source = env or {}
    network = str(source.get("NETWORK", "bsc-testnet")).strip().lower()
    if network != "bsc-testnet":
        raise ExecutionCapitalConfigError("Execution capital is Testnet-only: NETWORK must be bsc-testnet.")

    address = (wallet_address or str(source.get("AGENT_WALLET_ADDRESS", "")).strip()).strip()
    if address and not (len(address) == 42 and address.startswith("0x")):
        raise ExecutionCapitalConfigError("AGENT_WALLET_ADDRESS must be a valid-looking EVM address when provided.")

    profile = ExecutionCapitalProfile(
        enabled=False,
        network=network,
        chain_id=97,
        wallet_provider="evm",
        wallet_model="agent_owned",
        transaction_authority="agent_wallet",
        capital_model="strategy_only",
        supports_deposit=False,
        supports_withdrawal=False,
        supports_trading=False,
        supported_assets=(),
        max_capital=None,
        authorization={
            "model": "agent_wallet",
            "scoped_session": False,
            "user_personal_wallet_delegation": False,
            "source": "first_party_grid_agent",
        },
        note=(
            "The Grid Agent currently produces strategy deliverables only. "
            "No user execution capital is accepted, moved, or traded."
        ),
    )

    payload = asdict(profile)
    payload["supported_assets"] = list(profile.supported_assets)
    payload["agent_wallet_address"] = address or None
    return payload
