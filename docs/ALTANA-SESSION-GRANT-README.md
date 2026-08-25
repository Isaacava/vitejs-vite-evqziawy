# Altana Session Grant & Independent Verification

## Purpose

This feature is the authorization step for AgentMarket execution capital.

The user does **not** give an external agent a private key. The user signs an Altana session grant that authorizes a specific agent session key against the user's execution wallet.

## Flow

```text
Funded ERC-8183 job
        ↓
execution capital request
        ↓
resolve user's Altana wallet
        ↓
show agent session key + contract allowlist + spend cap + expiry
        ↓
user signs Altana grantSession
        ↓
onchain KeyStore registration
        ↓
AgentMarket reads KeyStore.isValidKey(user, keyId)
        ↓
requested → authorized
```

## Important wallet distinction

- User/admin signer: existing AgentMarket WalletConnect signer.
- User execution wallet: the Altana/EIP-7702 wallet controlled by that signer.
- Agent session key: ordinary agent signing key already held by the Grid execution process.
- AgentMarket never receives the agent private key.

The current BNB Agent SDK describes Altana wallets as EIP-7702 accounts where the wallet address is the admin EOA, upgraded in place on first execute. The session key is the scoped authority.

## Allowlist rule

A session with omitted `calls` is too broad for this feature. AgentMarket requires at least one explicit contract target before granting execution authority.

PancakeSwap contract addresses are **not hard-coded here**. They must come from the agent's verified execution profile/declared strategy requirements and be shown to the user before signing.

## Spend cap

The current Altana SDK uses time-based spend periods (`minute`, `hour`, `day`, `week`, `month`, `year`). The current execution-capital implementation uses a daily cap together with the session expiry. It does not invent a `once` period that the SDK does not expose.

## Independent verification

The verification endpoint performs a plain read against the BSC Testnet Altana KeyStore:

```text
isValidKey(userExecutionWallet, keccak256(agentSessionPublicKey))
```

`authorized` is never inferred from the browser transaction receipt or the agent's own report. The request only transitions to `authorized` after the public KeyStore read returns true.

## Private-key boundary

The agent's private session key remains on the agent side. AgentMarket receives only:

- session public key
- session address
- session key id
- public permissions/allowlist
- expiry

The agent can later reconstruct an executable Altana session locally from its own private key plus the granted session descriptor.

## Current implementation

Implemented:

- `src/lib/altanaWallet.ts` — user Altana wallet resolution.
- `src/AltanaWalletGate.tsx` — wallet gate UI.
- `src/lib/altanaSession.ts` — real `grantSession` adapter with explicit allowlist enforcement.
- `src/AltanaSessionGrantGate.tsx` — grant + independent verification UI.
- `server/_testnet/execution-capital.ts` — Altana-only capital request gate.
- `server/_testnet/execution-capital-verify.ts` — independent KeyStore verification.
- execution-capital Supabase migrations.

Not yet complete:

- the Grid Agent execution process must expose its session public key/requirements;
- the session grant UI must be wired into the post-funded mission console;
- the agent execution process must reconstruct the granted session locally and call `session_execute`/Altana execution through the official SDK;
- Risk Guardian must approve proposed calls before execution;
- PancakeSwap contract targets must be verified for the BSC Testnet execution scenario;
- real capital/PnL evidence must only be populated from independently verifiable execution evidence.

## Security rules

1. Never grant with an empty call allowlist.
2. Never put the agent private key in AgentMarket, Supabase, or browser state.
3. Never mark `authorized` before the public KeyStore says the session key is valid.
4. Keep ERC-8183 job budget separate from execution capital.
5. Keep unknown capital/PnL fields null until verified evidence exists.
6. Keep this integration BSC Testnet-only until the entire execution lifecycle is proven.
