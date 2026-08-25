# AgentMarket — Continue Chat Handoff

## Branch

`marketplace-testnet`

## Repository

`Isaacava/vitejs-vite-evqziawy`

## Current project focus

The hackathon implementation is **ERC-8183-first**. AgentMarket is a general agent marketplace; it does not become a PancakeSwap-specific marketplace. The new feature being built beside ERC-8183 is **Agent Execution Capital**, currently restricted to the Altana scoped-session model because it is the wallet model where the marketplace can independently verify user-controlled authorization.

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

### Marketplace APIs

The Testnet dispatcher is `api/testnet.ts` and routes multiple `/api/testnet/*` URLs to `server/_testnet/*` handlers so Vercel does not create a separate function for every nested handler.

`server/_testnet/execution-capital.ts` currently supports:

- `GET` a request for an owned job;
- `POST` create a request only for a funded ERC-8183 job;
- `POST` verification path (`action=verify`) that reads Altana KeyStore `isValidKey(...)` and only then changes `requested → authorized`.

The request route rejects TWAK/EVM for execution capital and requires the provider to explicitly declare Altana scoped-session support.

### UI

`src/ExecutionCapitalCard.tsx` displays execution-capital state separately from ERC-8183 payment.

`src/ExecutionCapitalPanel.tsx` is embedded in the mission console and shows the execution-capital section.

`src/AltanaWalletGate.tsx` handles the user wallet / Altana wallet setup boundary.

`src/AltanaSessionGrantGate.tsx` performs the user-side real `grantSession` call and then calls the server verification endpoint.

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

## Grid execution adapter

The first-party Grid Agent remains a separate strategy/provider service for ERC-8183. Its new isolated execution package is:

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

## Last confirmed Vercel state

The execution-capital request-gate deployment reached READY.

The later execution-capability/documentation commits triggered fresh deployments. Check the newest Vercel deployment before making additional code changes.

Recent useful commits:

- `9e53a648b32533df34df9f1c6ac518d58e5da054` — fixed agent indexer metadata select; Vercel READY.
- `be0cb55c7995da7670098f7f76fb561e90fdb817` — execution-capital request gate; Vercel READY.
- `940fc4fc2cd0e8d39fa8dd395684a5769d341cd7` — Grid public Altana execution capabilities.
- `a81821f75a123027384cdee729566e85229ca4d6` — documented Grid execution capability handoff.

## Next exact implementation step

The next task is to complete the **public execution capability → AgentMarket → Altana grant** handoff without hard-coding agent-specific values into the marketplace.

Desired flow:

```text
Grid execution service
    ↓ GET /execution-capabilities
AgentMarket obtains:
    session key address
    public key
    allowed targets
    allowed selectors
    ↓
execution_capital_requests stores the verified public descriptor
    ↓
mission console loads request
    ↓
AltanaSessionGrantGate shows the actual scope
    ↓
user signs grantSession()
    ↓
server independently verifies KeyStore
    ↓
requested → authorized
```

Do **not** send the agent private key to the browser or AgentMarket.

Do **not** hard-code PancakeSwap contract addresses in the generic marketplace. The Grid agent should declare its required scope; AgentMarket should display and verify it.

Do **not** mark the Grid agent as a real trading executor until its executor service is actually reachable/configured and a Testnet PancakeSwap call has been demonstrated.

## After authorization

The next phase after the grant handoff is:

1. connect the verified session descriptor to the Grid executor;
2. have Risk Guardian approve a real Testnet PancakeSwap call;
3. execute through Altana session mode;
4. capture the transaction receipt;
5. integrate execution evidence into the existing ERC-8183 deliverable archive;
6. record final assets/P&L only from hash-verified evidence;
7. add session revocation and expiry handling.

## Documentation rule

Every new feature gets its own README. Existing phase READMEs include:

- `docs/EXECUTION-PROFILES-README.md`
- `docs/PROTOCOL-AWARE-HIRING-README.md`
- `docs/ERC8183-HIRING-LIFECYCLE-README.md`
- `docs/AGENT-EXECUTION-CAPITAL-README.md`
- `docs/AGENT-EXECUTION-CAPITAL-ALTANA-INTEGRATION-README.md`

When starting another feature, create a dedicated README before or with the implementation.
