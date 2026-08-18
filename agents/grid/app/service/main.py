"""Public ERC-8183 service adapter for the first-party Grid Agent test runtime.

Runs a lightweight FastAPI app (so Railway's HTTP healthcheck has something to
hit) and, in the background, the BNB Agent SDK's funded-job poll loop, which
watches for FUNDED jobs assigned to this agent's wallet and forwards each one
to fulfill_grid_job().
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI

from bnbagent import EVMWalletProvider
from bnbagent.erc8183 import ERC8183JobOps, funded_job_watcher
from bnbagent.storage import LocalStorageProvider

from app.agent.main import fulfill_grid_job
from app.service.config import validate_runtime_config

logger = logging.getLogger("grid_agent")

# Fail closed at process startup. This service is deliberately Testnet-only.
config = validate_runtime_config()

_wallet = EVMWalletProvider(
    password=os.environ["WALLET_PASSWORD"],
    # Only required on first run to import a key; a wallet is auto-generated
    # otherwise and persisted by the SDK's keystore.
    private_key=os.environ.get("PRIVATE_KEY"),
)

_ops = ERC8183JobOps(
    _wallet,
    network=config["network"],
    storage_provider=LocalStorageProvider(),
    service_price=config["service_price"],
    agent_url=config["endpoint"],
)


async def _on_funded(job: dict[str, Any]) -> None:
    deliverable = fulfill_grid_job(job)
    await _ops.submit_result(job["jobId"], deliverable)


_watcher_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _watcher_task
    _watcher_task = asyncio.create_task(
        funded_job_watcher(_ops, _on_funded, interval=config["poll_interval"])
    )
    try:
        yield
    finally:
        if _watcher_task is not None:
            _watcher_task.cancel()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
