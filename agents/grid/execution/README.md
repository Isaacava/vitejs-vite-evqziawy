# Grid Agent — Altana Execution Adapter

This service is the isolated execution layer for the first-party Grid Agent on **BSC Testnet (chain 97)**.

It does not replace the existing Python ERC-8183 provider. The Python service remains responsible for the marketplace job lifecycle and strategy deliverable. This TypeScript service is the separate execution-capital boundary.

## Flow

```text
AgentMarket
   ↓
execution-capital request
   ↓
user grants Altana session
   ↓
public session descriptor
   ↓
Grid execution service
   ↓
reconstruct session from ALTANA_SESSION_PRIVATE_KEY
   ↓
Risk Guardian: target + selector + expiry + batch/value checks
   ↓
@altananetwork/sdk execute()
   ↓
allowed Testnet contract call
```

The session private key is never accepted in an AgentMarket request. It exists only in the Grid execution service environment and must correspond to the public session key granted by the user.

## Public capability handoff

`GET /execution-capabilities` returns only non-secret execution metadata:

```json
{
  "network": "bsc-testnet",
  "chainId": 97,
  "wallet_provider": "altana",
  "authorization_model": "scoped_session",
  "session_key_address": "0x...",
  "session_key_public_key": "0x...",
  "allowed_targets": ["0x..."],
  "allowed_selectors": ["0x..."],
  "selectors_required": true,
  "private_key_exposed": false
}
```

The same public capability object is returned by `GET /health` so the service can be health-checked without exposing secrets.

The marketplace must treat these values as **agent-reported capability metadata** until the user's resulting Altana session is independently verified onchain. AgentMarket must never derive a permission claim solely from this endpoint.

## Required environment

```text
PORT=8788
GRID_EXECUTION_SHARED_SECRET=<private service-to-service secret>
ALTANA_SESSION_PRIVATE_KEY=<agent session private key>
GRID_ALLOWED_TARGETS=<comma-separated Testnet contract addresses>
GRID_ALLOWED_SELECTORS=<comma-separated 4-byte function selectors>
```

The selector allowlist is intentionally mandatory. An empty selector allowlist rejects every execution request. This prevents a broad contract allowlist from becoming permission to call arbitrary functions on that contract.

## Current boundary

The adapter can execute an already-approved, pre-encoded call batch through Altana `execute()` after the Risk Guardian passes it.

The PancakeSwap-specific call builder, session descriptor delivery from the AgentMarket backend, execution receipts/evidence capture, and automatic Grid strategy-to-call translation are separate integration steps. Until those are wired, the existing Grid Agent remains strategy-only and is not marked as an execution agent.
