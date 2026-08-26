"""Public Grid Agent service with an embedded Altana execution boundary."""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import Request
from fastapi.responses import Response

from app.agent.main import fulfill_grid_job
from app.service.config import validate_runtime_config
from app.service.erc8183_server import create_erc8183_app


validate_runtime_config()


def execute_job(job: dict[str, Any]) -> str:
    return fulfill_grid_job(job)


app = create_erc8183_app(on_job=execute_job)

_EXECUTOR_URL = os.getenv("GRID_EXECUTION_INTERNAL_URL", "http://127.0.0.1:8788").rstrip("/")
_PROXY_TIMEOUT = httpx.Timeout(20.0, connect=5.0)


async def _proxy(request: Request, path: str) -> Response:
    body = await request.body()
    headers: dict[str, str] = {}
    authorization = request.headers.get("authorization")
    if authorization:
        headers["authorization"] = authorization
    content_type = request.headers.get("content-type")
    if content_type:
        headers["content-type"] = content_type
    try:
        async with httpx.AsyncClient(timeout=_PROXY_TIMEOUT) as client:
            upstream = await client.request(
                request.method,
                f"{_EXECUTOR_URL}{path}",
                headers=headers,
                content=body,
            )
    except httpx.HTTPError as exc:
        return Response(
            content='{"error":"Embedded Grid execution service unavailable"}',
            status_code=503,
            media_type="application/json",
        )

    response_headers = {
        key: value
        for key, value in upstream.headers.items()
        if key.lower() in {"content-type", "cache-control"}
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
    )


@app.get("/execution-capabilities")
async def execution_capabilities(request: Request):
    return await _proxy(request, "/execution-capabilities")


@app.get("/health")
async def execution_health(request: Request):
    return await _proxy(request, "/health")


@app.post("/preflight/pancake")
async def pancake_preflight(request: Request):
    return await _proxy(request, "/preflight/pancake")


@app.post("/execute")
async def execute(request: Request):
    return await _proxy(request, "/execute")
