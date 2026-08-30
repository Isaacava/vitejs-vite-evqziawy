"""AgentMarket provider adapter for Grid Agent.

Grid is an independently hired ERC-8183 provider. AgentMarket owns the
client-side workflow and user execution authorization. This adapter prevents
the legacy funded-job watcher from treating one Railway wallet as every user's
wallet; execution is initiated through the provider's scoped execution
endpoint with the user/job-specific Altana session descriptor.
"""

from __future__ import annotations

from typing import Any

from app.service import main as grid_service


async def marketplace_managed_on_funded(job: dict[str, Any]) -> None:
    job_id = job.get("jobId")
    grid_service._runtime["last_funded_job_observed"] = __import__("time").time()
    if job_id is not None:
        try:
            grid_service._runtime["last_job_id"] = int(job_id)
        except (TypeError, ValueError):
            grid_service._runtime["last_job_id"] = None
    grid_service._runtime["last_error"] = None
    grid_service.logger.info(
        "ERC8183_FUNDED_JOB_WAITING_FOR_MARKETPLACE_EXECUTION job_id=%s provider=%s network=%s chain_id=97",
        job_id,
        grid_service._provider_address(),
        grid_service.config["network"],
    )


# The underlying service lifespan resolves _on_funded from its module globals
# when the watcher starts. Replace only that callback; all provider endpoints,
# wallet code, ERC-8183 operations, and execution capability remain unchanged.
grid_service._on_funded = marketplace_managed_on_funded
app = grid_service.app
