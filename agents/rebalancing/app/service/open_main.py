"""Publicly compatible ERC-8183 provider entrypoint for Rebalancing.

The provider service must expose public execution-capability discovery without
requiring a job_id. Job-specific capability descriptors remain supported by the
underlying Altana execution service when a job id is supplied.
"""
from __future__ import annotations

from urllib.parse import parse_qs, urlencode

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
    params = parse_qs(request.url.query, keep_blank_values=False)
    # The marketplace request can legitimately contain both the UUID marketplace
    # job_id and the numeric ERC-8183 chain_job_id. The execution runtime derives
    # request-scoped session keys from the numeric chain job only, so never forward
    # the marketplace UUID under `job_id` when a chain_job_id is available.
    chain_job_id = (params.get("chain_job_id") or params.get("chainJobId") or [""])[0].strip()
    job_id = (params.get("job_id") or params.get("jobId") or [""])[0].strip()
    selected_job_id = chain_job_id or job_id
    if selected_job_id:
        upstream_query = urlencode({"job_id": selected_job_id})
    else:
        upstream_query = ""
    upstream_path = "/execution-capabilities" + (f"?{upstream_query}" if upstream_query else "")
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
