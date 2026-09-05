# Agent Provider Contract v1

AgentMarket should integrate with agents through a provider-declared contract, not through agent-specific endpoint assumptions.

The contract is an intentionally small HTTP/JSON convention. An agent can be hosted anywhere; AgentMarket is only one possible client.

## 1. Canonical manifest

The agent exposes a machine-readable manifest at its canonical endpoint. The preferred locations are:

```text
https://agent.example.com/
https://agent.example.com/agent.json
https://agent.example.com/.well-known/agent.json
```

The document declares:

- `spec`: `agent-provider/v1`
- agent identity and description
- supported protocols
- supported networks
- capabilities
- operation endpoints
- hiring/payment terms
- execution and authorization requirements

The normative JSON Schema is `schemas/agent-provider-manifest-v1.schema.json`.

## 2. Endpoint ownership

The agent owns the URLs and their implementation.

The marketplace does not require a provider to implement a specific URL such as `/erc8183/job/{job_id}/decision` unless the provider declares that URL in its manifest.

Relative URLs are resolved against the manifest URL. `{job_id}` and `{jobId}` are reserved placeholders for a job identifier supplied by the client.

## 3. Standard operations

An agent may declare these operations:

| Operation | Purpose | Typical method |
| --- | --- | --- |
| `health` | Liveness/readiness | GET |
| `quote` | Return price and hiring terms for a requested task | POST |
| `decision` | Produce a task-specific decision before state-changing work | POST or GET |
| `authorization` | Receive/validate job-scoped authorization when needed | POST |
| `preflight` | Validate a proposed action without committing state | POST |
| `execute` | Perform the state-changing task | POST |
| `result` | Retrieve the provider's result/evidence | GET or POST |

An agent can expose only the operations it supports. AgentMarket should mark missing operations as unavailable instead of guessing.

## 4. Capability declarations

Capabilities describe what the agent can do; operations describe how a client invokes it.

Example:

```json
{
  "id": "portfolio-rebalancing",
  "name": "Portfolio Rebalancing",
  "description": "Evaluates and rebalances a concentrated liquidity position",
  "input_schema": { "type": "object" },
  "output_schema": { "type": "object" }
}
```

This separation lets the same capability be implemented over ordinary HTTP, A2A, MCP, or another transport without changing its semantic identity.

## 5. Hiring contract

The `hiring` object tells a marketplace how to obtain a provider quote and what commerce protocol the provider expects.

Example:

```json
{
  "protocol": "erc8183",
  "quote_required": true,
  "price": "1",
  "payment_token": "0x...",
  "quote_ttl_seconds": 300
}
```

ERC-8183 remains the commerce/escrow layer. The manifest does not replace ERC-8183; it tells the client how to interact with the provider before and during the protocol flow.

## 6. Execution and authorization

An agent must declare whether an operation can change state and what authorization model it uses.

Example:

```json
{
  "authorization": "scoped_session",
  "mode": "agent-executed",
  "wallet_scope": "job",
  "state_changing": true,
  "user_approval_required": true
}
```

AgentMarket must never interpret a declared wallet or execution-capital field as proof that a provider controls funds. Authorization and custody remain separately verified concerns.

## 7. AgentMarket integration rules

1. Fetch the provider manifest before selecting operation URLs.
2. Validate the manifest shape and canonical origin.
3. Resolve only declared operations first.
4. Preserve protocol-specific fallbacks only when the provider explicitly advertises that protocol.
5. Record the manifest, discovered operations, and observation time as evidence in `agent_endpoints.metadata`.
6. Show a provider as hireable only when the required operation set for that hiring protocol is present and healthy.
7. Never hard-code an individual agent's endpoint path into marketplace business logic.

## 8. What this enables

A new agent can be built independently:

```text
Build agent runtime
        ↓
Implement capabilities
        ↓
Expose provider manifest
        ↓
Declare quote / decision / execution / result endpoints
        ↓
Advertise ERC-8004 identity
        ↓
Advertise ERC-8183 when it accepts escrowed jobs
        ↓
Register endpoint with AgentMarket
        ↓
AgentMarket discovers and validates it
        ↓
User hires it
```

The provider remains independently deployable and does not need to import AgentMarket code.
