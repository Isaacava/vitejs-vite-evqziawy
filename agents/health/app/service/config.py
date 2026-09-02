"""Shared runtime configuration validation for the first-party Testnet agents."""
from __future__ import annotations
from urllib.parse import urlparse

def validate_runtime_config(env=None):
    source = env or __import__("os").environ
    if source.get("NETWORK", "bsc-testnet").strip().lower() != "bsc-testnet":
        raise RuntimeError("NETWORK must be exactly bsc-testnet")
    endpoint = source.get("ERC8183_AGENT_URL", "").strip()
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" or not parsed.netloc or not parsed.path.rstrip("/").endswith("/erc8183"):
        raise RuntimeError("ERC8183_AGENT_URL must be public HTTPS and end in /erc8183")
    if "mainnet" in endpoint.lower(): raise RuntimeError("Agent endpoint must not reference mainnet")
    price = int(source.get("ERC8183_SERVICE_PRICE", "0"))
    if price <= 0: raise RuntimeError("ERC8183_SERVICE_PRICE must be positive")
    poll = int(source.get("ERC8183_FUNDED_POLL_INTERVAL", "30"))
    if not 5 <= poll <= 300: raise RuntimeError("ERC8183_FUNDED_POLL_INTERVAL must be between 5 and 300")
    return {"network":"bsc-testnet","endpoint":endpoint,"service_price":price,"poll_interval":poll}
