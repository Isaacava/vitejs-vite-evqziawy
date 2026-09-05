"""Publicly compatible ERC-8183 provider entrypoint for Rebalancing.

The provider service must expose public execution-capability discovery without
requiring a job_id. Job-specific capability descriptors remain supported by the
underlying Altana execution service when a job id is supplied.
"""
from __future__ import annotations

from fastapi import HTTPException, Request

from app.service import main as service_main

app = service_main.app

# Replace the legacy route rather than stacking a second route at the same path.
# Starlette resolves routes in insertion order, so simply adding another handler
# would leave the old `job_id is required` implementation first in the router.
app.router.routes = [
    route
    for route in app.router.routes
    if getattr(route, "path", None) != "/erc8183/execution-capabilities"
]


async def execution_capabilities(request: Request):
    query = request.url.query
    upstream_path = "/execution-capabilities" + (f"?{query}" if query else "")
    try:
        return service_main.proxy_get(upstream_path)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


app.add_api_route(
    "/erc8183/execution-capabilities",
    execution_capabilities,
    methods=["GET"],
    name="execution_capabilities",
)
