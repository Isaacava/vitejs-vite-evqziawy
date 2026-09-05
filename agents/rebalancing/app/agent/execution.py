"""Agent-local execution adapter for Rebalancing.

Authorization is supplied by the ERC-8183 job context. This module has no
knowledge of AgentMarket or any other hiring venue.
"""
from __future__ import annotations

from typing import Any

from agents.execution_client import execute_testnet_swap as _execute_testnet_swap

# Deployment marker: the watched rebalancing tree must redeploy after the
# job-scoped authorization pipeline changes on the marketplace side.
EXECUTION_AUTH_MODE = "erc8183-job-scoped-v1"


def execute_testnet_swap(
    *,
    job_id: int,
    wallet_address: str | None,
    token_in: str,
    token_out: str,
    amount_in: str,
    amount_out_minimum: str,
    fee: int = 2500,
    execution_authorization: Any = None,
) -> dict:
    return _execute_testnet_swap(
        job_id=job_id,
        wallet_address=wallet_address,
        token_in=token_in,
        token_out=token_out,
        amount_in=amount_in,
        amount_out_minimum=amount_out_minimum,
        fee=fee,
        execution_authorization=execution_authorization,
    )
