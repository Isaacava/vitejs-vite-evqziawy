"""Public ERC-8183 service adapter for the first-party Grid Agent test runtime.

This service is deliberately Testnet-only. The local FastAPI adapter keeps the
Grid Agent independent from optional bnbagent server-package layout changes while
using the BNB SDK ERC-8183 primitives underneath.
"""

from __future__ import annotations

from typing import Any

from app.agent.main import fulfill_grid_job
from app.service.config import validate_runtime_config
from app.service.erc8183_server import create_erc8183_app


validate_runtime_config()


def execute_job(job: dict[str, Any]) -> str:
    return fulfill_grid_job(job)


app = create_erc8183_app(on_job=execute_job)
