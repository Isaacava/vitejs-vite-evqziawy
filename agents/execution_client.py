"""Small synchronous client for an agent-local Altana execution sidecar."""
from __future__ import annotations
import json
import os
from urllib.request import Request, urlopen


def execute_testnet_swap(*, job_id: int, wallet_address: str, token_in: str, token_out: str, amount_in: str, amount_out_minimum: str, fee: int = 2500) -> dict:
    endpoint = os.getenv("ALTANA_EXECUTION_INTERNAL_URL", "http://127.0.0.1:8788").rstrip("/") + "/execute-swap"
    body = {"jobId": job_id, "walletAddress": wallet_address, "tokenIn": token_in, "tokenOut": token_out, "amountIn": str(amount_in), "amountOutMinimum": str(amount_out_minimum), "fee": int(fee), "recipient": wallet_address}
    req = Request(endpoint, data=json.dumps(body).encode("utf-8"), headers={"content-type": "application/json"}, method="POST")
    with urlopen(req, timeout=float(os.getenv("ALTANA_EXECUTION_TIMEOUT", "30"))) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict): raise RuntimeError("Altana execution service returned an invalid response")
    if payload.get("error"): raise RuntimeError(str(payload["error"]))
    if payload.get("status") == "FAILED": raise RuntimeError("Altana execution reported FAILED")
    return payload
