"""Public ERC-8183 service adapter for the first-party Grid Agent test runtime.

Run this service with the bnbagent server extra. It watches funded jobs assigned
to the configured provider wallet and forwards each job to fulfill_grid_job().
"""

from __future__ import annotations

from typing import Any

from bnbagent.erc8183.server import create_erc8183_app

from app.agent.main import fulfill_grid_job
from app.service.config import validate_runtime_config


# Fail closed at process startup. This service is deliberately Testnet-only.
# The BNB Agent SDK consumes the same environment for its ERC-8183 server.
validate_runtime_config()


def execute_job(job: dict[str, Any]) -> str:
    return fulfill_grid_job(job)


app = create_erc8183_app(on_job=execute_job)
