#!/bin/sh
set -eu

# Provider HTTP starts immediately; ERC-8004 registration stays in the background.
(
  python /app/erc8004_register.py
) > /tmp/erc8004-registration.log 2>&1 &
REGISTER_PID=$!

node --enable-source-maps /execution/dist/server.js &
NODE_PID=$!

cleanup() {
  kill "$NODE_PID" 2>/dev/null || true
  kill "$REGISTER_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
  wait "$REGISTER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Shared, agent-agnostic provider manifest bootstrap. It attaches /agent.json and
# /erc8183/agent.json to the already-created FastAPI app, deriving capabilities and
# operation URLs from the provider's own runtime routes and environment.
exec python -c '
import importlib, os
from fastapi import Request

spec = os.environ["AGENT_APP_MODULE"]
module_name, app_name = spec.split(":", 1)
module = importlib.import_module(module_name)
app = getattr(module, app_name)

kind = (os.getenv("AGENT_KIND") or os.getenv("EXECUTION_AGENT_KIND") or "agent").strip().lower()
display = (os.getenv("AGENT_DISPLAY_NAME") or kind.replace("_", " ").title()).strip()
defaults = {
  "grid": ("grid.strategy", "Controlled Grid Strategy", "Execute a controlled grid strategy within provider-declared execution constraints."),
  "grid_strategy": ("grid.strategy", "Controlled Grid Strategy", "Execute a controlled grid strategy within provider-declared execution constraints."),
  "yield": ("yield.optimization", "Yield Optimization", "Analyze and execute yield optimization strategies within provider-declared constraints."),
  "yield_optimizer": ("yield.optimization", "Yield Optimization", "Analyze and execute yield optimization strategies within provider-declared constraints."),
  "rebalancing": ("portfolio.rebalance", "Portfolio Rebalancing", "Rebalance a portfolio according to requested allocation and provider risk constraints."),
  "portfolio_rebalance": ("portfolio.rebalance", "Portfolio Rebalancing", "Rebalance a portfolio according to requested allocation and provider risk constraints."),
  "health": ("risk.monitor", "Risk and Health Monitoring", "Monitor portfolio health and provide risk-aware decisions and guidance."),
  "health_factor_guardian": ("risk.monitor", "Risk and Health Monitoring", "Monitor portfolio health and provide risk-aware decisions and guidance."),
  "risk_guardian": ("risk.monitor", "Risk and Health Monitoring", "Monitor portfolio health and provide risk-aware decisions and guidance."),
}
cap_id, cap_name, cap_desc = defaults.get(kind, (f"{kind}.service", display, f"Provide the {display} capability through a machine-readable provider contract."))
cap_id = (os.getenv("AGENT_CAPABILITY_ID") or cap_id).strip()
cap_name = (os.getenv("AGENT_CAPABILITY_NAME") or cap_name).strip()
cap_desc = (os.getenv("AGENT_CAPABILITY_DESCRIPTION") or cap_desc).strip()


def routes():
    out = {}
    for route in getattr(app, "routes", []):
        path = getattr(route, "path", "")
        methods = sorted(getattr(route, "methods", set()) or [])
        if path:
            out[path] = methods
    return out


def pick(candidates, preferred):
    available = routes()
    for path in candidates:
        if path in available:
            methods = available[path]
            method = next((m for m in preferred if m in methods), methods[0] if methods else "GET")
            return path, method
    return None, None


def env_bool(name, fallback):
    value = os.getenv(name)
    if value is None or not value.strip():
        return fallback
    return value.strip().lower() in {"1", "true", "yes", "on"}


def manifest(base):
    base = base.rstrip("/")
    endpoint_specs = {
      "health": (["/erc8183/health", "/health"], ["GET"]),
      "quote": (["/erc8183/negotiate", "/negotiate"], ["POST", "GET"]),
      "decision": (["/erc8183/job/{job_id}/decision"], ["GET"]),
      "authorization": (["/erc8183/job/{job_id}/execution-authorization"], ["POST"]),
      "preflight": (["/erc8183/preflight", "/erc8183/preflight/pancake", "/preflight"], ["POST"]),
      "execute": (["/erc8183/execute", "/execute"], ["POST"]),
      "result": (["/erc8183/job/{job_id}/response", "/job/{job_id}/response"], ["GET"]),
    }
    endpoints = {}
    for name, (candidates, preferred) in endpoint_specs.items():
        path, method = pick(candidates, preferred)
        if path:
            endpoints[name] = {"url": base + path, "method": method, "transport": "http", "capability": cap_id}

    execute_present = "execute" in endpoints
    authorization_present = "authorization" in endpoints
    execution_mode = (os.getenv("AGENT_EXECUTION_MODE") or ("provider-watcher" if execute_present else "request-response")).strip()
    authorization_model = (os.getenv("AGENT_AUTHORIZATION_MODEL") or ("provider-declared" if authorization_present else "none")).strip()
    wallet_scope = (os.getenv("AGENT_WALLET_SCOPE") or "").strip()

    execution_metadata = {
      "mode": execution_mode,
      "authorization": authorization_model,
      "state_changing": env_bool("AGENT_STATE_CHANGING", execute_present),
      "user_approval_required": env_bool("AGENT_USER_APPROVAL_REQUIRED", authorization_present),
    }
    if wallet_scope:
        execution_metadata["wallet_scope"] = wallet_scope

    result = {
      "spec": "agent-provider/v1",
      "name": display,
      "description": (os.getenv("AGENT_PROVIDER_DESCRIPTION") or f"{display} provider on BSC Testnet.").strip(),
      "version": (os.getenv("AGENT_PROVIDER_VERSION") or "1.0.0").strip(),
      "agent": {"provider": "AgentMarket first-party"},
      "protocols": ["erc-8183", "http"],
      "networks": [{"chain_id": 97, "name": "BSC Testnet", "environment": "testnet"}],
      "capabilities": [{"id": cap_id, "name": cap_name, "description": cap_desc, "metadata": {"agent_kind": kind}}],
      "endpoints": endpoints,
      "hiring": {"protocol": "ERC-8183", "quote_required": "quote" in endpoints, "quote_ttl_seconds": 300},
      "execution": execution_metadata,
      "discovery": {"canonical_url": base + "/agent.json", "agent_card": base + "/agent.json"},
      "metadata": {"discovery": "agent-provider/v1", "generated_by": "shared-agent-runtime"},
    }
    price = getattr(module, "SERVICE_PRICE", None)
    if price is not None:
        result["hiring"]["price"] = str(price)
    payment = getattr(module, "payment_token", None)
    if callable(payment):
        try:
            token = payment()
            if token:
                result["hiring"]["payment_token"] = str(token)
        except Exception:
            pass
    return result


async def manifest_endpoint(request: Request):
    return manifest(str(request.base_url).rstrip("/"))

app.add_api_route("/agent.json", manifest_endpoint, methods=["GET"], include_in_schema=False, name="agent_provider_manifest")
app.add_api_route("/erc8183/agent.json", manifest_endpoint, methods=["GET"], include_in_schema=False, name="agent_provider_manifest_erc8183")

import uvicorn
uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
'
