"""Agent-local bridge to the Altana execution sidecar.

ERC-8183 mission creation does not require an Altana session. A state-changing
agent execution may require one later; in that case the job-scoped execution
wallet is resolved from AgentMarket's independently verified authorization
record before the local Altana sidecar is called.
"""
from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def _valid_address(value: object) -> bool:
    return isinstance(value, str) and value.startswith("0x") and len(value) == 42


def resolve_job_execution_wallet(*, job_id: int, explicit_wallet: str | None = None) -> str:
    if explicit_wallet and _valid_address(explicit_wallet.strip()):
        return explicit_wallet.strip()

    status_url = (os.getenv("AGENTMARKET_EXECUTION_AUTH_STATUS_URL") or "").strip().rstrip("/")
    provider_url = (os.getenv("ERC8183_AGENT_URL") or "").strip().rstrip("/")
    if not status_url or not provider_url:
        raise RuntimeError(
            "State-changing execution requires a job-scoped Altana authorization record. "
            "AGENTMARKET_EXECUTION_AUTH_STATUS_URL and ERC8183_AGENT_URL must be configured."
        )

    try:
        with urlopen(f"{provider_url}/status", timeout=10) as response:
            provider_status = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError("Unable to resolve the provider wallet needed to verify job-scoped execution authorization") from exc

    provider_address = provider_status.get("agent_address") if isinstance(provider_status, dict) else None
    if not _valid_address(provider_address):
        raise RuntimeError("Provider status did not expose a valid ERC-8183 provider wallet address")

    query = urlencode({"job": str(job_id), "provider": provider_address})
    try:
        with urlopen(f"{status_url}?{query}", timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
            detail = body.get("error") if isinstance(body, dict) else None
        except Exception:
            detail = None
        raise RuntimeError(detail or f"AgentMarket authorization status returned HTTP {exc.code}") from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError("AgentMarket execution authorization status could not be reached") from exc

    if not isinstance(payload, dict) or not payload.get("ok"):
        raise RuntimeError("AgentMarket did not return a valid execution authorization status")
    authorization = payload.get("authorization")
    if not isinstance(authorization, dict):
        raise RuntimeError("This funded ERC-8183 job has no Altana execution authorization yet. Complete the user authorization step before the agent can execute.")
    wallet = authorization.get("execution_wallet")
    if not _valid_address(wallet):
        raise RuntimeError("Altana execution authorization is incomplete: no valid user execution wallet is recorded for this job")
    return str(wallet)


def execute_testnet_swap(*, job_id: int, wallet_address: str | None, token_in: str, token_out: str, amount_in: str, amount_out_minimum: str, fee: int = 2500) -> dict:
    endpoint = os.getenv("ALTANA_EXECUTION_INTERNAL_URL", "http://127.0.0.1:8788").rstrip("/") + "/execute-swap"
    wallet = resolve_job_execution_wallet(job_id=job_id, explicit_wallet=wallet_address)
    body = {"jobId": job_id, "walletAddress": wallet, "tokenIn": token_in, "tokenOut": token_out, "amountIn": str(amount_in), "amountOutMinimum": str(amount_out_minimum), "fee": int(fee), "recipient": wallet}
    req = Request(endpoint, data=json.dumps(body).encode("utf-8"), headers={"content-type": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=float(os.getenv("ALTANA_EXECUTION_TIMEOUT", "30"))) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
            detail = body.get("error") if isinstance(body, dict) else None
        except Exception:
            detail = None
        raise RuntimeError(detail or f"Altana execution returned HTTP {exc.code}") from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError("Altana execution service failed to return a valid response") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("Altana execution service returned an invalid response")
    if payload.get("error"): raise RuntimeError(str(payload["error"]))
    if payload.get("status") == "FAILED": raise RuntimeError("Altana execution reported FAILED")
    return payload
