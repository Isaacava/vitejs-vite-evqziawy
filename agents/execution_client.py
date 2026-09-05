"""Agent-local execution adapter.

Agents receive execution authorization in the ERC-8183 job context. This module
never calls, imports, or depends on a marketplace-specific API. A marketplace
may provide the authorization envelope, but the agent only consumes the job's
self-contained execution context and invokes its configured execution adapter.
"""
from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from typing import Any


def _valid_address(value: object) -> bool:
    return isinstance(value, str) and value.startswith("0x") and len(value) == 42


def _authorization_wallet(execution_authorization: Any) -> str | None:
    if not isinstance(execution_authorization, dict):
        return None
    for key in ("execution_wallet", "wallet_address", "wallet", "execution_wallet_address"):
        value = execution_authorization.get(key)
        if _valid_address(value):
            return str(value).strip()
    return None


def resolve_execution_wallet(*, explicit_wallet: str | None = None, execution_authorization: Any = None) -> str:
    if explicit_wallet and _valid_address(explicit_wallet.strip()):
        return explicit_wallet.strip()

    wallet = _authorization_wallet(execution_authorization)
    if wallet:
        return wallet

    raise RuntimeError(
        "State-changing execution requires a valid execution authorization in the ERC-8183 job context; "
        "the agent does not query a marketplace for authorization."
    )


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
    endpoint = os.getenv("ALTANA_EXECUTION_INTERNAL_URL", "http://127.0.0.1:8788").rstrip("/") + "/execute-swap"
    wallet = resolve_execution_wallet(
        explicit_wallet=wallet_address,
        execution_authorization=execution_authorization,
    )
    body = {
        "jobId": job_id,
        "walletAddress": wallet,
        "tokenIn": token_in,
        "tokenOut": token_out,
        "amountIn": str(amount_in),
        "amountOutMinimum": str(amount_out_minimum),
        "fee": int(fee),
        "recipient": wallet,
    }
    req = Request(
        endpoint,
        data=json.dumps(body).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=float(os.getenv("ALTANA_EXECUTION_TIMEOUT", "30"))) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            error_body = json.loads(exc.read().decode("utf-8"))
            detail = error_body.get("error") if isinstance(error_body, dict) else None
        except Exception:
            detail = None
        raise RuntimeError(detail or f"Execution adapter returned HTTP {exc.code}") from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError("Execution adapter failed to return a valid response") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("Execution adapter returned an invalid response")
    if payload.get("error"):
        raise RuntimeError(str(payload["error"]))
    if payload.get("status") == "FAILED":
        raise RuntimeError("Execution adapter reported FAILED")
    return payload
