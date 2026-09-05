"""Runtime compatibility patch for public execution-capability discovery.

The ERC-8183 provider must advertise its public execution scope before a job exists.
The underlying Altana execution service already supports that mode; this module patches
an older provider proxy route that still required a job_id.
"""
from __future__ import annotations

import logging

from fastapi import HTTPException, Request

from app.service import main as service_main

logger = logging.getLogger(__name__)


async def _public_or_job_scoped_execution_capabilities(request: Request):
    job_id = request.query_params.get("job_id") or request.query_params.get("jobId")
    try:
        if job_id:
            return service_main.proxy_get("/execution-capabilities", {"job_id": job_id})
        return service_main.proxy_get("/execution-capabilities")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


patched = False
for route in service_main.app.router.routes:
    if getattr(route, "path", None) == "/erc8183/execution-capabilities":
        route.endpoint = _public_or_job_scoped_execution_capabilities
        if hasattr(route, "dependant"):
            route.dependant.call = _public_or_job_scoped_execution_capabilities
        patched = True
        break

if not patched:
    raise RuntimeError("Unable to locate /erc8183/execution-capabilities route for compatibility patch")

logger.info("ERC8183_PUBLIC_EXECUTION_CAPABILITY_PATCH_APPLIED")
