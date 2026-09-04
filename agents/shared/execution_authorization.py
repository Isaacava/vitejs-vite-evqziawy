"""Generic job-scoped execution authorization client for first-party agents.

The agent runtime never receives a user private key. It asks AgentMarket for the
status of the authorization request bound to its ERC-8183 job and may execute
state-changing calls only after the marketplace reports an independently
verified Altana scoped session.
"""
from __future__ import annotations

import os
import time
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def _status_url() -> str:
    value = (os.getenv("AGENTMARKET_EXECUTION_AUTH_STATUS_URL") or "").strip()
    if not value:
        raise RuntimeError("AGENTMARKET_EXECUTION_AUTH_STATUS_URL is not configured")
    return value


def _fetch(job_id: int, provider_address: str) -> dict[str, Any]:
    if not isinstance(job_id, int) or job_id <= 0:
        raise RuntimeError("A positive ERC-8183 job id is required for execution authorization")
    if not isinstance(provider_address, str) or len(provider_address) != 42 or not provider_address.startswith("0x"):
        raise RuntimeError("A valid provider address is required for execution authorization")
    url = _status_url()
    query = urlencode({"job": str(job_id), "provider": provider_address})
    separator = "&" if "?" in url else "?"
    request = Request(f"{url}{separator}{query}", headers={"accept": "application/json"}, method="GET")
    try:
        with urlopen(request, timeout=float(os.getenv("AGENTMARKET_EXECUTION_AUTH_TIMEOUT", "15"))) as response:
            import json
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Unable to read AgentMarket execution authorization: {exc}") from exc
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise RuntimeError(str(payload.get("error") if isinstance(payload, dict) else "Invalid authorization response"))
    return payload


def get_execution_authorization(job_id: int, provider_address: str) -> dict[str, Any]:
    """Read the current job-scoped authorization state."""
    return _fetch(job_id, provider_address)


def wait_for_execution_authorization(
    job_id: int,
    provider_address: str,
    *,
    timeout_seconds: int | None = None,
    poll_seconds: int | None = None,
) -> dict[str, Any]:
    """Wait until a job is explicitly authorized, or fail closed.

    State-changing agent execution is never allowed while the request is
    missing, pending, rejected, revoked, expired, cancelled, or malformed.
    """
    timeout = int(timeout_seconds or os.getenv("AGENTMARKET_EXECUTION_AUTH_TIMEOUT_SECONDS", "900"))
    interval = max(1, int(poll_seconds or os.getenv("AGENTMARKET_EXECUTION_AUTH_POLL_SECONDS", "5")))
    deadline = time.time() + timeout
    last_status = "unknown"
    while time.time() < deadline:
        payload = get_execution_authorization(job_id, provider_address)
        if payload.get("required") is False:
            raise RuntimeError("This job has no verified execution-authorization request; state-changing execution is blocked")
        status = str(payload.get("status") or "").strip().lower()
        last_status = status or "unknown"
        authorization = payload.get("authorization")
        if status == "authorized" and isinstance(authorization, dict):
            wallet = str(authorization.get("execution_wallet") or "").strip()
            token = str(authorization.get("capital_token") or "").strip()
            expiry = authorization.get("session_expiry")
            if not wallet or not token or not isinstance(expiry, (int, float, str)):
                raise RuntimeError("AgentMarket reported authorized execution without a complete scoped-session grant")
            return {"status": "authorized", **authorization, "request_id": payload.get("request_id")}
        if status in {"rejected", "revoked", "expired", "cancelled", "canceled"}:
            raise RuntimeError(f"Execution authorization is {status}; state-changing execution is blocked")
        time.sleep(interval)
    raise RuntimeError(f"Timed out waiting for job-scoped Altana authorization; last status={last_status}")
