"""Generic AgentMarket job-scoped execution authorization polling.

Agents that need to perform state-changing actions can use this module without
embedding marketplace-specific strategy logic. The marketplace owns the
authorization record; the agent only waits for an authorized record bound to
its exact ERC-8183 job and provider identity.
"""
from __future__ import annotations

import json
import os
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class ExecutionAuthorizationError(RuntimeError):
    """Raised when a job cannot obtain a valid execution authorization."""


def _base_url() -> str:
    value = os.getenv("AGENTMARKET_EXECUTION_AUTH_STATUS_URL", "").strip()
    if not value:
        raise ExecutionAuthorizationError(
            "AGENTMARKET_EXECUTION_AUTH_STATUS_URL is not configured; refusing state-changing execution"
        )
    return value.rstrip("/")


def get_execution_authorization(job_id: int, provider_address: str, timeout_seconds: float = 10.0) -> dict:
    """Read the authorization state for one exact ERC-8183 job."""
    query = urlencode({"job": str(int(job_id)), "provider": provider_address})
    request = Request(
        f"{_base_url()}?{query}",
        headers={"Accept": "application/json"},
        method="GET",
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise ExecutionAuthorizationError(f"Unable to read execution authorization for job {job_id}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ExecutionAuthorizationError("AgentMarket returned an invalid execution-authorization response")
    return payload


def wait_for_execution_authorization(
    job_id: int,
    provider_address: str,
    *,
    timeout_seconds: float | None = None,
    poll_seconds: float | None = None,
) -> dict:
    """Wait until the marketplace reports a verified authorization for this job.

    This is deliberately a blocking wait used by provider workers. A missing,
    pending, expired, rejected, or unverifiable authorization never permits a
    state-changing action or a deliverable submission.
    """
    timeout = float(timeout_seconds or os.getenv("AGENTMARKET_EXECUTION_AUTH_TIMEOUT", "3600"))
    interval = max(1.0, float(poll_seconds or os.getenv("AGENTMARKET_EXECUTION_AUTH_POLL", "10")))
    started = time.monotonic()
    last_status = "unknown"

    while time.monotonic() - started < timeout:
        payload = get_execution_authorization(job_id, provider_address)
        if payload.get("ok") is not True:
            raise ExecutionAuthorizationError(str(payload.get("error") or "Execution authorization lookup failed"))

        required = bool(payload.get("required", True))
        status = str(payload.get("status") or "unknown").lower()
        last_status = status

        if not required:
            raise ExecutionAuthorizationError(
                f"Job {job_id} does not advertise an execution authorization requirement; refusing implicit state-changing execution"
            )

        if status == "authorized" and payload.get("authorization"):
            authorization = payload["authorization"]
            if not isinstance(authorization, dict):
                raise ExecutionAuthorizationError("Authorized execution response is malformed")
            return authorization

        if status in {"rejected", "revoked", "expired", "cancelled"}:
            raise ExecutionAuthorizationError(f"Execution authorization for job {job_id} is {status}")

        time.sleep(interval)

    raise ExecutionAuthorizationError(
        f"Timed out waiting for execution authorization for job {job_id}; last status={last_status}"
    )
