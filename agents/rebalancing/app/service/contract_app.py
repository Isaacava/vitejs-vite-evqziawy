"""Standard provider-contract surface for the Rebalancing agent.

This adapter keeps the agent runtime independent from AgentMarket while exposing
one machine-readable manifest that any compatible client can consume.
"""
from __future__ import annotations

import os
from urllib.parse import urlparse

from app.service.main import app, CHAIN_ID, DISPLAY_NAME, KIND, NETWORK, SERVICE_PRICE, payment_token


def public_origin() -> str:
    candidates = [
        os.getenv("RAILWAY_PUBLIC_DOMAIN", "").strip(),
        os.getenv("RAILWAY_STATIC_URL", "").strip(),
        os.getenv("ERC8004_AGENT_ENDPOINT", "").strip(),
    ]
    for value in candidates:
        if not value:
            continue
        url = value if "://" in value else f"https://{value}"
        try:
            parsed = urlparse(url)
            if parsed.scheme in {"http", "https"} and parsed.netloc:
                return f"{parsed.scheme}://{parsed.netloc}"
        except ValueError:
            continue
    return ""


def manifest() -> dict:
    origin = public_origin()
    base = f"{origin}/erc8183" if origin else "/erc8183"
    return {
        "spec": "agent-provider/v1",
        "name": DISPLAY_NAME,
        "description": "Independent BSC Testnet portfolio rebalancing agent.",
        "version": os.getenv("AGENT_BUILD_REV", "testnet"),
        "agent": {
            "id": os.getenv("ERC8004_AGENT_ID", ""),
            "owner": os.getenv("EXPECTED_PROVIDER_WALLET", ""),
            "provider": "first-party",
        },
        "protocols": ["erc8004", "erc8183"],
        "networks": [{"chain_id": CHAIN_ID, "name": NETWORK, "environment": "testnet"}],
        "capabilities": [
            {
                "id": "portfolio-rebalancing",
                "name": "Portfolio Rebalancing",
                "description": "Analyze an LP range and decide whether to hold, widen, or move the range.",
                "input_schema": {"type": "object", "properties": {"current_tick": {"type": "number"}, "tick_lower": {"type": "number"}, "tick_upper": {"type": "number"}}},
                "output_schema": {"type": "object", "properties": {"decision": {"type": "object"}, "execution_required": {"type": "boolean"}}},
            },
            {
                "id": "erc8183-hiring",
                "name": "ERC-8183 Hiring",
                "description": "Accept quoted Testnet work through an ERC-8183 commerce job.",
                "metadata": {"operation": "quote"},
                "endpoint": f"{base}/negotiate",
                "transport": "http",
                "methods": ["POST"],
            },
            {
                "id": "erc8183-decision",
                "name": "ERC-8183 Job Decision",
                "description": "Return the agent's job-scoped decision after a funded job is observed.",
                "metadata": {"operation": "decision"},
                "endpoint": f"{base}/job/{{job_id}}/decision",
                "transport": "http",
                "methods": ["GET"],
            },
            {
                "id": "erc8183-authorization",
                "name": "Execution Authorization",
                "description": "Receive a job-scoped execution authorization when a state-changing action is required.",
                "metadata": {"operation": "authorization"},
                "endpoint": f"{base}/job/{{job_id}}/execution-authorization",
                "transport": "http",
                "methods": ["POST"],
            },
            {
                "id": "erc8183-preflight",
                "name": "Execution Preflight",
                "description": "Validate a proposed execution request before it changes state.",
                "metadata": {"operation": "preflight"},
                "endpoint": f"{base}/preflight",
                "transport": "http",
                "methods": ["POST"],
            },
            {
                "id": "erc8183-result",
                "name": "Job Result",
                "description": "Retrieve the provider's submitted response artifact for a job.",
                "metadata": {"operation": "result"},
                "endpoint": f"{base}/job/{{job_id}}/response",
                "transport": "http",
                "methods": ["GET"],
            },
            {
                "id": "health",
                "name": "Health",
                "description": "Provider liveness and readiness check.",
                "metadata": {"operation": "health"},
                "endpoint": f"{origin}/health" if origin else "/health",
                "transport": "http",
                "methods": ["GET"],
            },
        ],
        "endpoints": {
            "health": {"url": f"{origin}/health" if origin else "/health", "method": "GET"},
            "quote": {"url": f"{base}/negotiate", "method": "POST"},
            "decision": {"url": f"{base}/job/{{job_id}}/decision", "method": "GET"},
            "authorization": {"url": f"{base}/job/{{job_id}}/execution-authorization", "method": "POST"},
            "preflight": {"url": f"{base}/preflight", "method": "POST"},
            "result": {"url": f"{base}/job/{{job_id}}/response", "method": "GET"},
        },
        "hiring": {
            "protocol": "erc8183",
            "quote_required": True,
            "price": str(SERVICE_PRICE),
            "payment_token": payment_token(),
            "quote_ttl_seconds": 300,
        },
        "execution": {
            "authorization": "scoped_session",
            "mode": "provider-watcher",
            "wallet_scope": "job",
            "state_changing": True,
            "user_approval_required": True,
        },
        "discovery": {
            "canonical_url": f"{origin}/.well-known/agent-card.json" if origin else "/.well-known/agent-card.json"
        },
    }


@app.get("/agent.json")
async def agent_json():
    return manifest()


@app.get("/.well-known/agent.json")
async def well_known_agent_json():
    return manifest()


@app.get("/.well-known/agent-card.json")
async def well_known_agent_card():
    return manifest()
