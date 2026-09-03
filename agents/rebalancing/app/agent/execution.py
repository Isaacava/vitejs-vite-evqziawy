"""Job-bound Altana execution client for the Rebalancing provider."""
from __future__ import annotations
import json
import os
from urllib.request import Request, urlopen


def execute_testnet_swap(*, job_id: int, wallet_address: str, token_in: str, token_out: str, amount_in: str, amount_out_minimum: str, fee: int = 2500) -> dict:
    endpoint = os.getenv("ALTANA_EXECUTION_INTERNAL_URL", "http://127.0.0.1:8788").rstrip("/") + "/execute-swap"
    body = {
        "jobId": job_id,
        "walletAddress": wallet_address,
        "tokenIn": token_in,
        "tokenOut": token_out,
        "amountIn": str(amount_in),
        "amountOutMinimum": str(amount_out_minimum),
        "fee": int(fee),
        "recipient": wallet_address,
    }
    request = Request(endpoint, data=json.dumps(body).encode("utf-8"), headers={"content-type": "application/json"}, method="POST")
    with urlopen(request, timeout=float(os.getenv("ALTANA_EXECUTION_TIMEOUT", "30"))) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict) or not payload.get("transaction_hash") and payload.get("status") == "FAILED":
        raise RuntimeError(f"Altana execution failed: {payload}")
    return payload
