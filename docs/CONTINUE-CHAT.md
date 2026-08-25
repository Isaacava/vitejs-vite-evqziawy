# AgentMarket — Continue Chat Handoff

## Branch

`marketplace-testnet`

## Repository

`Isaacava/vitejs-vite-evqziawy`

## Current project focus

The hackathon implementation is **ERC-8183-first**. AgentMarket is a general agent marketplace; it does not become a PancakeSwap-specific marketplace. The execution-capital feature beside ERC-8183 is currently restricted to the Altana scoped-session model because this is the wallet model where the marketplace can independently verify user-controlled authorization.

## Proven / working systems

- ERC-8004 agent discovery/indexing on BSC Testnet.
- Supabase agent registry and endpoint/capability indexing.
- ERC-8183 quote → accept → create/register → set budget → approve → fund → provider submit → evidence capture → evaluation → settlement.
- Supabase/cron job synchronization and deliverable evidence capture.
- Provider wallet / agent matching.
- ERC-8183 lifecycle console reads authoritative chain state.
- Vercel Hobby deployment works after consolidating Testnet API handlers behind `api/testnet.ts` to stay under the 12-function limit.

## Important architecture rule

```text
ERC-8183 job budget
    ≠
execution capital
```

The ERC-8183 job budget is the payment for hiring the agent. Execution capital is separate capital the user authorizes an agent to operate with.

## Altana execution-capital model

For this feature:

```text
User
  └─ connected wallet / Altana authority
       └─ grants scoped session

Agent
  └─ ordinary session key/address
       └─ executes only inside session scope
```

The agent private key stays on the agent execution service. AgentMarket must never receive it.

The session scope must be explicit:

- contract-call allowlist;
- spend cap;
- expiry;
- session-key identity;
- user-owned execution wallet.

Authorization is not considered verified until AgentMarket independently reads Altana's onchain KeyStore/session registry.

## Current execution-capital implementation

### Database

`supabase/migrations/20260825021000_add_execution_capital_requests.sql`

`execution_capital_requests` is Altana-only:

- `wallet_provider = 'altana'`
- `authorization_model = 'scoped_session'`
- one row per `job_id` is already enforced by a `unique` constraint in the original migration.
- RLS is enabled intentionally with no direct client policies; server APIs enforce authentication and job ownership.

The data separates:

- `user_execution_wallet`
- `agent_session_key`
- `session_key_id`

Capital/P&L values remain nullable and render as `Not yet observed` until independently verifiable evidence exists.

### Public execution-capability handoff — completed

The Grid execution service exposes a public descriptor at:

`GET /execution-capabilities`

with:

- BSC Testnet / chain 97;
- Altana scoped-session model;
- session key address;
- session public key;
- allowed target contracts;
- required 4-byte function selectors;
- `private_key_exposed: false`.

AgentMarket now discovers this descriptor from either:

1. generic execution-capability URL fields declared by the agent metadata; or
2. the agent's registered endpoint base plus `/execution-capabilities`.

The descriptor is validated before it is stored in:

`execution_capital_requests.evidence.execution_capability`

Validation includes public-key → address identity, non-empty target allowlist, non-empty selector allowlist, chain 97, Altana/scoped-session identifiers, and explicit private-key absence.

The stored descriptor includes source URL, endpoint identity/status, retrieval time, and `independently_authorized: false`.

### Marketplace APIs

The Testnet dispatcher is `api/testnet.ts` and routes multiple `/api/testnet/*` URLs to `server/_testnet/*` handlers so Vercel does not create a separate function for every nested handler.

`server/_testnet/execution-capital.ts` supports:

- `GET` a request for an owned job;
- `POST` create a request only for a funded ERC-8183 job with a valid live public execution capability;
- `POST` verification path (`action=verify`) that binds the granted `session_key_id` to the stored provider public key, reads Altana KeyStore `isValidKey(...)`, and only then changes `requested → authorized`;
- grant transaction hash capture.

The request route still rejects TWAK/EVM for execution capital and requires the provider to explicitly declare Altana scoped-session support.

### UI

`src/ExecutionCapitalCard.tsx` displays execution-capital state separately from ERC-8183 payment.

`src/ExecutionCapitalPanel.tsx` now consumes the stored public capability descriptor and only renders the grant UI when the descriptor is valid.

`src/AltanaWalletGate.tsx` handles the user wallet / Altana wallet setup boundary.

`src/AltanaSessionGrantGate.tsx` performs the user-side real `grantSession` call, displays the provider-declared target and selector scope, and then calls the server verification endpoint.

The mission console already receives `execution_capital` from `/api/jobs`.

### Altana SDK

`@altananetwork/sdk` is installed in the marketplace project.

The implementation uses BSC Testnet / chain ID 97 and the official SDK concepts:

- `createClient`
- `BNB_TESTNET`
- `createWallet`
- `grantSession`
- `revokeSession`
- `execute`

Do not rely on unverified browser APIs such as `signerFromInjected` if the installed package does not export them. Fail closed rather than using a fake signer API.

### Grid execution adapter

The first-party Grid Agent remains a separate strategy/provider service for ERC-8183. Its isolated execution package is:

`agents/grid/execution/`

Important files:

- `src/altanaExecutor.ts` — reconstructs the session from the agent's private key, validates public key/address identity, runs Risk Guardian, then calls the Altana SDK `execute()` on BSC Testnet.
- `src/riskGuardian.ts` — validates target/selector/expiry/value/batch rules.
- `src/server.ts` — private execution endpoint with bearer protection.
- `src/types.ts` — execution/session types.

The execution service exposes public capability metadata through:

`GET /execution-capabilities`

and the same public metadata through `GET /health`.

It exposes only:

- chain 97;
- Altana/scoped-session model;
- agent session key address;
- agent session public key;
- configured allowed targets;
- configured allowed selectors.

It explicitly does **not** expose the session private key.

Environment examples:

```text
PORT=8788
GRID_EXECUTION_SHARED_SECRET=<private>
ALTANA_SESSION_PRIVATE_KEY=<agent session private key>
GRID_ALLOWED_TARGETS=<comma-separated BSC testnet contract addresses>
GRID_ALLOWED_SELECTORS=<comma-separated 4-byte selectors>
```

The selector allowlist must remain explicit. Empty selectors reject execution.

## Last confirmed CI state

The current branch head after the capability handoff is:

`60aa07a4a10afbd2f57d4883b335ce524c4dc7bd`

A fresh `AgentMarket Testnet Build` run is executing against that exact commit. Node setup has completed successfully and dependency installation is in progress. The earlier run for an older docs-only commit failed at Node setup before compilation, so it was not a code-build result.

The Grid Agent Testnet tests and Testnet network-isolation audit completed successfully on the preceding run.

## Next exact implementation step

The public capability → AgentMarket → Altana grant handoff is now wired.

The next task is to complete the **authorized session → private Grid executor** handoff without exposing the agent private key:

```text
execution_capital_requests.status = authorized
    ↓
verified session descriptor
    ↓
private AgentMarket/server-to-service request
    ↓
Grid /execute
    ↓
Risk Guardian
    ↓
Altana execute() on chain 97
```

The backend must pass the verified public session descriptor and proposed call batch to the execution service. The agent private key remains only in the Grid execution service.

Do **not** hard-code PancakeSwap contract addresses in the generic marketplace. The Grid agent must continue to declare its own target/selector requirements.

Do **not** mark the Grid agent as a real trading executor until its execution service is actually reachable/configured and a real BSC Testnet PancakeSwap call has been demonstrated with a receipt.

## After authorized executor handoff

1. Connect the verified session descriptor to the Grid executor.
2. Have Risk Guardian approve a real Testnet PancakeSwap call.
3. Execute through Altana session mode.
4. Capture the transaction receipt.
5. Integrate execution evidence into the existing ERC-8183 deliverable archive.
6. Record final assets/P&L only from hash-verified evidence.
7. Add session revocation and expiry handling.

## Documentation rule

Every new feature gets its own README. Existing phase READMEs include:

- `docs/EXECUTION-PROFILES-README.md`
- `docs/PROTOCOL-AWARE-HIRING-README.md`
- `docs/ERC8183-HIRING-LIFECYCLE-README.md`
- `docs/AGENT-EXECUTION-CAPITAL-README.md`
- `docs/AGENT-EXECUTION-CAPITAL-ALTANA-INTEGRATION-README.md`

When starting another feature, create a dedicated README before or with the implementation.
