# Grid Agent

Standalone ERC-8183 execution agent for BSC Testnet.

Grid is intentionally independent from AgentMarket at runtime. It has its own:

- ERC-8183 provider wallet and service configuration.
- Altana execution session and private signing key.
- Local execution service and local storage.
- Strategy, execution, receipt observation, and ERC-8183 submission logic.

Grid does **not** use an AgentMarket API, AgentMarket database, AgentMarket private headers, or AgentMarket application code.

## Runtime boundary

```text
ERC-8183 / BSC Testnet
        ↑
        │ on-chain jobs and state
        │
   Grid Agent
   ├── funded-job watcher
   ├── grid strategy
   ├── Altana execution
   ├── receipt verification
   └── ERC-8183 submit()
```

The marketplace may discover this agent through its public ERC-8183 endpoint and may independently read the same blockchain state. That does not create a private application dependency.

## Local services

The Python service exposes the public ERC-8183 provider endpoints. The Node execution service listens only on `127.0.0.1:8788` and is used exclusively by Grid's Python runtime.

## Job lifecycle

For a funded job, Grid watches the ERC-8183 contract, executes only when its own configured execution session is ready, observes the transaction receipt, persists a pending deliverable locally before submission, and calls `submit_result()` itself. If submission temporarily fails, the saved local deliverable is retried without automatically performing a second trade.

## Required secrets

Secrets are supplied only to this Grid deployment through its own runtime secret store. Do not copy AgentMarket database credentials, API tokens, request IDs, or execution secrets into this service.
