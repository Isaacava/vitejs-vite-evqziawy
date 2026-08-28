# Grid Agent

Grid is a standalone BSC Testnet agent that accepts work directly from users
and can also expose the ERC-8183 provider interface for external marketplaces
and hiring systems.

AgentMarket is **not** part of Grid's runtime contract. A user or integrator
can discover Grid, request a quote, submit a task, receive a result, and use
its execution interfaces without installing, configuring, or knowing anything
about AgentMarket.

## Network boundary

Grid is **BSC Testnet only** while this runtime is being developed.

- Network: **BSC Testnet**
- Chain ID: **97**
- Testnet jobs and execution evidence must never be reused against BSC Mainnet.

## Direct agent interface

The public FastAPI service exposes an agent-owned API:

- `GET /v1/capabilities` — machine-readable capabilities and supported interfaces.
- `POST /v1/quote` — request a task quote before starting work.
- `POST /v1/tasks` — submit a direct user task.
- `GET /v1/tasks/{task_id}` — retrieve the stored task result.
- `GET /v1/execution-capabilities` — inspect the optional scoped execution capability.
- `POST /v1/preflight/pancake` — read-only execution preflight.
- `POST /v1/execute` — submit an already-authorized scoped execution request.
- `GET /v1/receipt/{transaction_hash}` — independently observe a Testnet receipt.

The current task implementation generates deterministic grid strategies. It
can therefore be used directly even when no marketplace is involved.

## ERC-8183 integration

ERC-8183 is an optional hiring/payment interface, not Grid's identity.
Grid can act as an ERC-8183 provider by exposing `/erc8183`, negotiating terms,
watching for funded jobs, producing the same portable deliverable, and
submitting the result on-chain.

The ERC-8183 layer is deliberately thin: external hiring systems may use it,
while direct users can use `/v1/*` without it.

## Execution security

Grid's execution wallet, scoped session key, target allowlist, selector
allowlist, and protocol-specific preflight are controlled by Grid itself.
Those values are agent infrastructure and are never treated as marketplace
compatibility requirements.

Execution is fail-closed on BSC Testnet. The agent does not expose private keys
through its public capability manifest, and transaction receipts are observed
independently before execution evidence is marked verified.

## Current files

- `app/agent/main.py` — portable task and grid-strategy logic.
- `app/service/main.py` — public direct-user API and ERC-8183 provider adapter.
- `execution/src/*` — scoped Testnet execution, risk checks, and receipt observation.

## Configuration

A deployment may use its own runtime secret store for its own wallet and
execution session credentials.

```text
NETWORK=bsc-testnet
ERC8183_AGENT_URL=https://<your-service-host>/erc8183
ERC8183_SERVICE_PRICE=<quoted minimum in raw settlement-token units>
ERC8183_FUNDED_POLL_INTERVAL=30
PRIVATE_KEY=<agent wallet key>
WALLET_PASSWORD=<agent wallet password>
```

ERC-8183 configuration is only for agents that choose to participate in that
protocol. It is not an AgentMarket-specific requirement.
