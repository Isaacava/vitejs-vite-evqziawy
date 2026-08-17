from __future__ import annotations

import asyncio
import inspect
import logging
import os
from contextlib import asynccontextmanager
from typing import Any, Callable

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from bnbagent import EVMWalletProvider
from bnbagent.erc8183 import ERC8183JobOps
from bnbagent.erc8183.negotiation import NegotiationHandler
from bnbagent.storage import LocalStorageProvider

logger = logging.getLogger(__name__)


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    return value if value not in (None, "") else default


def _build_state() -> tuple[ERC8183JobOps, NegotiationHandler]:
    network = (_env("NETWORK", "bsc-testnet") or "bsc-testnet").strip().lower()
    if network != "bsc-testnet":
        raise RuntimeError("Grid Agent Testnet service requires NETWORK=bsc-testnet")

    agent_url = _env("ERC8183_AGENT_URL")
    if not agent_url or not agent_url.startswith("https://") or not agent_url.endswith("/erc8183"):
        raise RuntimeError("ERC8183_AGENT_URL must be a public HTTPS URL ending in /erc8183")

    service_price_raw = _env("ERC8183_SERVICE_PRICE")
    if not service_price_raw:
        raise RuntimeError("ERC8183_SERVICE_PRICE is required")
    service_price = int(service_price_raw)
    if service_price <= 0:
        raise RuntimeError("ERC8183_SERVICE_PRICE must be positive")

    password = _env("WALLET_PASSWORD")
    if not password:
        raise RuntimeError("WALLET_PASSWORD is required for the Grid Agent provider wallet")

    private_key = _env("PRIVATE_KEY")
    wallet = EVMWalletProvider(password=password, private_key=private_key)
    storage = LocalStorageProvider()
    ops = ERC8183JobOps(
        wallet,
        network=network,
        storage_provider=storage,
        service_price=service_price,
        agent_url=agent_url,
    )

    currency = ""
    decimals = 18
    try:
        currency = ops.erc8183_client.payment_token
        decimals = ops.erc8183_client.token_decimals()
    except Exception as exc:
        logger.warning("payment token lookup failed during startup: %s", exc)

    negotiation = NegotiationHandler(
        service_price=service_price,
        currency=currency,
        wallet_provider=wallet,
        chain_id=ops.erc8183_client.network.chain_id,
        verifying_contract=ops.erc8183_client.commerce.address,
    )
    negotiation._agent_metadata = {
        "agent_address": ops.agent_address,
        "currency": currency,
        "decimals": decimals,
    }
    return ops, negotiation


def create_erc8183_app(on_job: Callable[..., Any]) -> FastAPI:
    ops, negotiation = _build_state()
    interval = float(_env("ERC8183_FUNDED_POLL_INTERVAL", "30") or "30")
    tasks: set[asyncio.Task[Any]] = set()
    stop = asyncio.Event()

    async def process_job(job_id: int) -> None:
        verification = await ops.verify_job(job_id)
        if not verification.get("valid"):
            logger.warning("Grid job %s skipped: %s", job_id, verification.get("error"))
            return

        job = verification["job"]
        try:
            result = on_job(job)
            if inspect.isawaitable(result):
                result = await result
            metadata = None
            if isinstance(result, tuple):
                result, metadata = result
            submission = await ops.submit_result(
                job_id=job_id,
                response_content=str(result),
                metadata=metadata,
            )
            if submission.get("success"):
                logger.info("Grid job %s submitted: %s", job_id, submission.get("txHash"))
            else:
                logger.error("Grid job %s submission failed: %s", job_id, submission.get("error"))
        except Exception:
            logger.exception("Grid job %s execution failed", job_id)

    async def poll_loop() -> None:
        logger.info("Grid Agent funded-job poll loop started (interval=%ss)", interval)
        while not stop.is_set():
            try:
                pending = await ops.get_pending_jobs()
                if pending.get("success"):
                    for job in pending.get("jobs", []):
                        await process_job(int(job["jobId"]))
                else:
                    logger.warning("funded-job poll failed: %s", pending.get("error"))
            except Exception:
                logger.exception("funded-job poll iteration failed")
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
            except asyncio.TimeoutError:
                continue

    router = APIRouter(prefix="/erc8183", tags=["ERC-8183"])

    @router.post("/negotiate")
    async def negotiate(request: Request):
        try:
            body = await request.json()
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid JSON") from exc
        if not isinstance(body, dict) or "terms" not in body:
            raise HTTPException(status_code=400, detail="Request must include terms")
        try:
            quote = negotiation.negotiate(body)
            return quote.to_dict()
        except Exception as exc:
            logger.exception("Negotiation failed")
            raise HTTPException(status_code=500, detail="Negotiation failed") from exc

    @router.get("/status")
    async def status():
        return {
            "status": "ok",
            "network": (_env("NETWORK", "bsc-testnet") or "bsc-testnet"),
            "agent_address": ops.agent_address,
            "commerce_address": ops.erc8183_client.commerce.address,
            "router_address": ops.erc8183_client.router.address,
            "policy_address": ops.erc8183_client.policy.address,
            "service_price": int(_env("ERC8183_SERVICE_PRICE", "0") or "0"),
            "currency": negotiation._agent_metadata["currency"],
            "decimals": negotiation._agent_metadata["decimals"],
        }

    @router.get("/health")
    async def health():
        return {"status": "ok", "service": "AgentMarket Grid ERC-8183", "network": "bsc-testnet"}

    @router.get("/job/{job_id}")
    async def get_job(job_id: int):
        result = await ops.get_job(job_id)
        if not result.get("success"):
            return JSONResponse(result, status_code=404)
        if hasattr(result.get("status"), "value"):
            result["status"] = result["status"].value
        return result

    @router.get("/job/{job_id}/response")
    async def get_response(job_id: int):
        result = await ops.get_response(job_id)
        if not result.get("success"):
            return JSONResponse(result, status_code=404)
        return result

    @router.get("/job/{job_id}/verify")
    async def verify(job_id: int):
        result = await ops.verify_job(job_id)
        return JSONResponse(result, status_code=200 if result.get("valid") else 400)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        task = asyncio.create_task(poll_loop())
        tasks.add(task)
        try:
            yield
        finally:
            stop.set()
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            tasks.discard(task)

    app = FastAPI(
        title="AgentMarket Grid Agent",
        description="Testnet-only ERC-8183 provider service",
        lifespan=lifespan,
    )
    app.include_router(router)

    @app.get("/")
    async def root():
        return {
            "service": "AgentMarket Grid Agent",
            "network": "bsc-testnet",
            "endpoints": {
                "health": "/erc8183/health",
                "status": "/erc8183/status",
                "negotiate": "/erc8183/negotiate",
            },
        }

    return app
