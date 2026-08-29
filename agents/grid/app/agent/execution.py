"""Agent-owned bridge from a funded Grid job to the local Altana executor.

This module deliberately depends only on the Grid job payload and Grid's own
execution service. It does not call AgentMarket APIs or require marketplace
secrets.
"""

from __future__ import annotations

import os
from typing import Any

import httpx


DEFAULT_AMOUNT_RAW = "1000000000000000000"
DEFAULT_AMOUNT_OUT_MINIMUM_RAW = "0"


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    return value if value not in (None, "") else default


def _required_address(name: str, default: str | None = None) -> str:
    value = (_env(name, default) or "").strip()
    if not value.startswith("0x") or len(value) != 42:
        raise RuntimeError(f"{name} must be a valid EVM address")
    return value


def _required_raw(name: str, default: str) -> str:
    value = (_env(name, default) or "").strip()
    if not value.isdigit() or int(value) <= 0:
        raise RuntimeError(f"{name} must be a positive integer raw amount")
    return value


def _job_execution_parameters(job: dict[str, Any]) -> dict[str, Any]:
    metadata = job.get("metadata")
    description = job.get("description")

    def as_object(value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return value
        if not isinstance(value, str) or not value.strip():
            return {}
        try:
            import json
            parsed = json.loads(value)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}

    merged = {**as_object(metadata), **as_object(description)}
    params = merged.get("params")
    if isinstance(params, dict):
        merged = {**merged, **params}
    execution = merged.get("execution")
    if isinstance(execution, dict):
        merged = {**merged, **execution}
    execution_market = merged.get("execution_market")
    if isinstance(execution_market, dict):
        merged = {**merged, **execution_market}
    return merged


async def execute_grid_trade(job: dict[str, Any]) -> dict[str, Any]:
    """Run Grid's own Testnet execution path using its existing Altana session."""
    base_url = (_env("GRID_EXECUTION_INTERNAL_URL", "http://127.0.0.1:8788") or "http://127.0.0.1:8788").rstrip("/")
    router = _required_address("PANCAKE_TESTNET_ROUTER", "0x9a489505a00cE272eAa5e07Dba6491314CaE3796")
    token_in = _required_address("GRID_DEFAULT_TOKEN_IN", "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551")
    token_out = _required_address("GRID_DEFAULT_TOKEN_OUT", "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd")
    recipient = _required_address("ALTANA_WALLET_ADDRESS")
    fee = int(_env("PANCAKE_TESTNET_POOL_FEE", "2500") or "2500")

    params = _job_execution_parameters(job)
    amount = str(params.get("execution_amount_raw") or params.get("amount_in_raw") or _env("GRID_TESTNET_EXECUTION_AMOUNT_RAW", DEFAULT_AMOUNT_RAW) or DEFAULT_AMOUNT_RAW)
    amount_out_minimum = str(params.get("amount_out_minimum_raw") or _env("GRID_TESTNET_AMOUNT_OUT_MINIMUM_RAW", DEFAULT_AMOUNT_OUT_MINIMUM_RAW) or DEFAULT_AMOUNT_OUT_MINIMUM_RAW)

    timeout = httpx.Timeout(90.0, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        preflight_response = await client.post(
            f"{base_url}/preflight/pancake",
            json={
                "router": router,
                "tokenIn": token_in,
                "tokenOut": token_out,
                "recipient": recipient,
                "fee": fee,
                "amountIn": amount,
                "amountOutMinimum": amount_out_minimum,
            },
        )
        preflight_body = preflight_response.json()
        if preflight_response.status_code >= 400 or not preflight_body.get("ok"):
            raise RuntimeError(preflight_body.get("error") or "Grid execution preflight failed")

        result = preflight_body.get("result") or {}
        call = result.get("call")
        if not isinstance(call, dict) or not call.get("to") or not call.get("data"):
            raise RuntimeError("Grid execution preflight did not return executable calldata")

        execute_response = await client.post(
            f"{base_url}/execute-configured",
            json={"calls": [call]},
        )
        execute_body = execute_response.json()
        if execute_response.status_code >= 400 or not execute_body.get("ok"):
            raise RuntimeError(execute_body.get("error") or "Grid Altana execution failed")

        execution = execute_body.get("result") or {}
        transaction_hash = execution.get("transactionHash")
        if not transaction_hash:
            raise RuntimeError("Grid Altana execution returned no transaction hash")

        receipt_response = await client.get(f"{base_url}/receipt/{transaction_hash}")
        receipt_body = receipt_response.json()
        if receipt_response.status_code >= 400 or not receipt_body.get("ok"):
            raise RuntimeError(receipt_body.get("error") or "Grid could not independently observe the Testnet receipt")

        receipt = receipt_body.get("result") or {}
        return {
            "transaction_hash": transaction_hash,
            "calls_id": execution.get("callsId"),
            "status": execution.get("status"),
            "preflight": result,
            "receipt": receipt,
        }
