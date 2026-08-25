# Agent Execution Capital — Altana Integration

## Purpose

This feature adds the execution-capital layer that sits beside, not inside, the existing ERC-8183 job budget.

```text
ERC-8183 job budget
= payment for hiring the agent

Execution capital
= capital the user authorizes the agent to operate with
```

AgentMarket remains a general-purpose marketplace. This execution-capital path is currently restricted to agents that explicitly advertise the Altana scoped-session execution model.

## Official protocol basis

The current BNB Agent SDK documents three wallet providers:

- `EVMWalletProvider` — agent-owned EVM wallet with local signing policy.
- `TWAKProvider` — Trust Wallet Agent Kit with a constrained command surface.
- `AltanaWalletProvider` — EIP-7702 wallet model with onchain session-key containment: call whitelist, spend cap, expiry and revocation.

The current Altana TypeScript SDK exposes:

- `createClient`
- `BNB_TESTNET`
- `createWallet`
- `grantSession`
- `revokeSession`
- `execute`

Altana's SDK source also defines an injected-wallet signer adapter in its current development tree. AgentMarket does not fall back to a generated private key if that surface is unavailable in the installed package; it fails closed.

## Wallet ownership model

For third-party marketplace execution capital:

```text
User
 └─ WalletConnect signer
      └─ Altana wallet / EIP-7702 wallet authority

Agent
 └─ session key / authorized signer
```

The database therefore keeps these concepts separate:

- `user_execution_wallet`
- `agent_session_key`
- `session_key_id`

The marketplace must never substitute the agent's wallet for the user's execution wallet.

## Database

`execution_capital_requests` is one row per marketplace job.

The table is intentionally Altana-only:

- `wallet_provider = 'altana'`
- `authorization_model = 'scoped_session'`

`capital_requested`, `capital_authorized`, `capital_deployed`, `capital_returned`, and P&L fields are nullable. Unknown is represented by `NULL`, not zero.

There are intentionally no public Supabase RLS policies on this table. Server routes must perform authentication and job-ownership checks before reading or writing execution-capital state.

## Current API behavior

`POST /api/testnet/execution-capital`

Required body:

```json
{
  "job_id": "uuid",
  "capital_requested": 100,
  "purpose": "Grid trading",
  "duration_seconds": 86400
}
```

The route currently requires:

1. authenticated AgentMarket user;
2. valid BSC Testnet wallet;
3. job belongs to that wallet;
4. the job is confirmed `FUNDED` on chain;
5. provider metadata explicitly declares `execution.wallet_provider = 'altana'`;
6. provider metadata explicitly declares `execution.transaction_authority = 'scoped_session'`.

The endpoint only creates a `requested` row. It does **not** grant a session and does **not** move capital.

## Wallet gate

`src/lib/altanaWallet.ts` and `src/AltanaWalletGate.tsx` implement the first authorization step:

- reuse the existing WalletConnect provider;
- use the user's signer;
- configure Altana for BSC Testnet;
- resolve/create the Altana wallet handle;
- stop before `grantSession`.

The next stage is to wire the returned wallet into a real `grantSession` call with the requested spend and allowed contract calls, then independently verify the resulting session before changing the request state to `authorized`.

## Evidence boundary

AgentMarket must not claim live `capital_deployed` or live P&L merely because an agent reports them.

Until an independent read path exists, those values remain `NULL` and are populated only from hash-verified execution evidence captured through the existing ERC-8183 deliverable archive pipeline.

## Current status

### Implemented

- Altana SDK dependency added (`@altananetwork/sdk` 0.8.0).
- User-wallet Altana adapter added.
- Altana wallet gate added.
- Altana-only execution-capital database migration added.
- Execution-capital types/evidence helpers added.
- Altana-only server request gate added.

### Not yet implemented

- real session grant UI and transaction;
- independent KeyStore/session validity verification;
- session revocation UI;
- execution-capital request UI in the mission console;
- real Grid Agent execution adapter;
- PancakeSwap execution;
- independent mid-session spend tracking.

## Security rules

1. ERC-8183 job budget and execution capital are always separate.
2. Only Altana scoped-session agents may create execution-capital requests.
3. The user's execution wallet and the agent's session key are different fields.
4. No generated private key is used as a substitute for the connected user signer.
5. Authorization becomes verified only after an independent onchain/session-registry read.
6. Unknown capital/P&L values remain `NULL` and render as `Not yet observed`.
7. Mainnet trading is not enabled by this change; the feature remains BSC Testnet-only.
