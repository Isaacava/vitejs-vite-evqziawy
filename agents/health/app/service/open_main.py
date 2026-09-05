"""Open ERC-8183 provider entrypoint for the Health/Risk agent."""
from __future__ import annotations

from fastapi import HTTPException, Request

from app.service import main as service_main

app = service_main.app
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
