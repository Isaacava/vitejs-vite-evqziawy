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

AgentMarket fails closed when the installed SDK does not expose the required injected signer adapter. It does not generate or receive an agent private key in the browser.

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

## Public capability handoff

The Grid execution service exposes:

`GET /execution-capabilities`

with only public execution metadata:

```json
{
  "network": "bsc-testnet",
  "chainId": 97,
  "execution": "altana-scoped-session",
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

The endpoint is capability metadata, not proof of authorization. AgentMarket validates the response before storing it on an execution-capital request:

1. endpoint is a registered ERC-8183 provider endpoint;
2. response is for BSC Testnet / chain 97;
3. wallet provider is Altana and authorization model is `scoped_session`;
4. private key is explicitly absent;
5. session public key derives to the advertised session address;
6. target allowlist is non-empty and contains valid addresses;
7. selector allowlist is non-empty and contains valid 4-byte selectors;
8. the descriptor is stored in `execution_capital_requests.evidence.execution_capability`.

The stored descriptor includes the source URL and retrieval time so the mission console can display exactly which public scope was presented for the grant.

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
  "duration_seconds": 86400,
  "wallet_provider": "altana",
  "authorization_model": "scoped_session"
}
```

The route requires:

1. authenticated AgentMarket user;
2. valid BSC Testnet wallet;
3. job belongs to that wallet;
4. the job is confirmed `FUNDED` on chain;
5. provider explicitly advertises Altana scoped-session support;
6. a live registered ERC-8183 endpoint returns a valid `/execution-capabilities` descriptor.

The endpoint creates a `requested` row only after the public capability has been captured. It does **not** grant a session and does **not** move capital.

`POST /api/testnet/execution-capital-verify`

The browser sends the resulting public session key ID, signer, user execution wallet, expiry, and optional grant transaction hash. The server then:

1. checks ownership and request state;
2. verifies the session key ID matches the stored provider public key (`keccak256(publicKey)`);
3. reads the configured Altana KeyStore `isValidKey(wallet, sessionKeyId)` on BSC Testnet;
4. only after that changes `requested → authorized` and records the grant hash/verification evidence.

## Mission console

`ExecutionCapitalPanel` now consumes the stored public capability descriptor and renders `AltanaSessionGrantGate` only when a valid descriptor exists.

The grant UI displays:

- execution-capital spend cap;
- session duration;
- session key address;
- contract target allowlist;
- function selector allowlist;
- public capability source;
- BSC Testnet network boundary.

The browser passes only the public session key/address and allowed contract targets into `grantSession()`. Function selectors remain an execution-service Risk Guardian constraint because the installed Altana grant permission surface currently represents call targets, not an invented selector field.

## Wallet gate

`src/lib/altanaWallet.ts` and `src/AltanaWalletGate.tsx` implement the wallet boundary:

- reuse the existing WalletConnect provider;
- use the user's signer;
- configure Altana for BSC Testnet;
- resolve/create the Altana wallet handle;
- stop before signing the session grant.

`AltanaSessionGrantGate` performs the real `grantSession()` call and immediately requests independent server verification.

## Evidence boundary

AgentMarket must not claim live `capital_deployed` or live P&L merely because an agent reports them.

Until an independent execution receipt/evidence path exists, those values remain `NULL` and are populated only from hash-verified evidence captured through the existing ERC-8183 deliverable archive pipeline.

## Current status

### Implemented

- Altana SDK dependency added (`@altananetwork/sdk`).
- User-wallet Altana adapter and wallet gate.
- Altana-only execution-capital database migration.
- Altana-only server request gate.
- Grid public `/execution-capabilities` endpoint.
- AgentMarket live capability discovery and validation.
- Stored public session descriptor under `execution_capital_requests.evidence.execution_capability`.
- Real `grantSession()` UI using the provider-declared target scope.
- Independent Altana KeyStore verification before `requested → authorized`.
- Grant transaction hash capture.
- Endpoint health cron now probes `/execution-capabilities` before the legacy `/execution-capital` profile.

### Not yet implemented

- session revocation UI;
- real Grid execution-capital request delivery from marketplace backend to the private executor;
- Risk Guardian approval of an actual Testnet PancakeSwap call;
- PancakeSwap call builder and strategy-to-call translation;
- execution receipt/evidence capture into the ERC-8183 archive;
- independent mid-session spend tracking;
- expiry/revocation worker that transitions authorization state automatically.

## Security rules

1. ERC-8183 job budget and execution capital are always separate.
2. Only Altana scoped-session agents may create execution-capital requests.
3. The user's execution wallet and the agent's session key are different fields.
4. The agent private key never enters AgentMarket or the browser.
5. Agent-reported capability is not authorization proof.
6. Authorization becomes verified only after the server reads the Altana KeyStore.
7. Unknown capital/P&L values remain `NULL` and render as `Not yet observed`.
8. Mainnet trading is not enabled by this change; the feature remains BSC Testnet-only.
9. Function selectors remain an explicit Risk Guardian allowlist; an empty selector allowlist is rejected.
