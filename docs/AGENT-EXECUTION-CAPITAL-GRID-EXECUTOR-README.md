# Agent Execution Capital — Grid Executor Bridge

## Purpose

This phase connects an independently authorized Altana session in AgentMarket to the first-party Grid Agent's private execution service.

The bridge is server-to-server:

```text
User wallet
   ↓ grantSession()
Altana KeyStore verification
   ↓
execution_capital_requests = authorized
   ↓
AgentMarket Testnet API
   ↓ authenticated private request
Grid /execute
   ↓
Risk Guardian
   ↓
Altana execute() on BSC Testnet
   ↓
transaction hash / receipt
```

The Grid execution service remains the only component that stores `ALTANA_SESSION_PRIVATE_KEY`.

## Marketplace endpoint

The bridge is exposed through the existing consolidated Testnet dispatcher:

`POST /api/testnet?route=execution-capital-execute`

Body:

```json
{
  "request_id": "uuid",
  "execution_id": "optional-client-id",
  "calls": [
    {
      "to": "0x...",
      "data": "0x12345678...",
      "value": "0"
    }
  ]
}
```

The endpoint requires the authenticated AgentMarket wallet that owns the ERC-8183 job.

## Server-side controls

Before a request reaches the private executor, AgentMarket verifies:

- request status is `authorized` or `active`;
- independent Altana authorization evidence exists;
- the authenticated wallet equals `user_execution_wallet`;
- the stored session key equals the public capability session key;
- the stored capability is BSC Testnet / chain 97;
- the stored capability is Altana scoped-session;
- target addresses are inside the stored public target allowlist;
- every calldata payload contains an approved 4-byte selector;
- no more than eight calls are submitted in one batch;
- the stored session expiry has not passed;
- the authorized capital amount is a positive integer raw amount.

These checks complement, rather than replace, the Grid execution service's Risk Guardian.

## Private executor delivery

AgentMarket sends only:

- user execution wallet;
- agent session address;
- agent session public key;
- verified target allowlist;
- verified selector allowlist;
- spend limit derived from the authorized request;
- verified session expiry;
- proposed call batch.

AgentMarket never sends or stores the agent session private key.

The service is authenticated with:

```text
GRID_EXECUTION_SHARED_SECRET
```

The executor URL is obtained from `GRID_EXECUTION_ENDPOINT_URL` when explicitly configured; otherwise AgentMarket derives `/execute` from the stored public capability source URL. No agent-specific contract address is hard-coded into the generic marketplace.

## Receipt evidence

After the private executor returns a transaction hash, AgentMarket independently queries BSC Testnet for the transaction receipt.

The request evidence records:

- execution ID;
- executor URL;
- target and selector for each call;
- calldata and native value;
- Altana calls ID;
- transaction hash;
- executor status;
- receipt block/hash/status/gas data when observable;
- whether a receipt was independently observed;
- chain ID 97.

Execution-capital `capital_deployed` and P&L fields are **not** populated merely because a transaction exists. They remain evidence-driven values and require the later asset/accounting integration.

## Current boundary

Implemented:

- authorized-session gate;
- private Grid `/execute` delivery;
- capability and selector re-checking;
- receipt lookup on BSC Testnet;
- execution evidence storage;
- execution activity record;
- consolidated Testnet API routing.

Not yet implemented:

- PancakeSwap-specific call builder;
- Grid strategy → encoded swap/liquidity action translation;
- real Testnet PancakeSwap execution demonstration;
- deliverable-archive attachment of the execution receipt;
- independent asset/P&L accounting;
- session revocation and expiry worker.

## Safety boundary

This bridge must fail closed when authorization, scope, expiry, private executor configuration, or selector policy is missing. Mainnet execution is outside this feature; every execution path remains BSC Testnet / chain 97.
