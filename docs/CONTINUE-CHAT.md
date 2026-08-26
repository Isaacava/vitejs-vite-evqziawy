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

AgentMarket discovers this descriptor from either provider metadata or the registered ERC-8183 endpoint base, validates it, and stores it under:

`execution_capital_requests.evidence.execution_capability`

Validation includes public-key → address identity, non-empty target allowlist, non-empty selector allowlist, chain 97, Altana/scoped-session identifiers, and explicit private-key absence.

### Altana grant + independent verification — completed

`src/AltanaSessionGrantGate.tsx` performs the real `grantSession()` call using the user's wallet signer.

After the grant, the server:

1. checks the authenticated wallet owns the request;
2. binds the supplied session key ID to `keccak256(session public key)`;
3. checks the granted expiry;
4. reads Altana KeyStore `isValidKey(wallet, sessionKeyId)` on BSC Testnet;
5. only then changes `requested → authorized`;
6. records the grant transaction hash and authorization evidence.

### Authorized session → private Grid executor — completed

The consolidated Testnet dispatcher exposes:

`POST /api/testnet?route=execution-capital-execute`

Implemented in:

`server/_testnet/grid-execute.ts`

The bridge requires an independently authorized request and then reconstructs the verified public session descriptor from stored evidence. It re-checks:

- BSC Testnet / chain 97;
- Altana scoped-session identity;
- session expiry;
- user execution wallet ownership;
- session key identity;
- target allowlist;
- function selector allowlist;
- maximum batch size.

It then sends the descriptor and encoded call batch to the private Grid `/execute` endpoint with `GRID_EXECUTION_SHARED_SECRET`.

The agent private key is never sent through this endpoint.

After execution, AgentMarket independently queries BSC Testnet for the transaction receipt and stores hash/receipt evidence under the execution-capital request. `capital_deployed` and P&L remain nullable until an independent accounting path exists.

Dedicated documentation:

`docs/AGENT-EXECUTION-CAPITAL-GRID-EXECUTOR-README.md`

## Grid execution adapter

The first-party Grid Agent remains a separate strategy/provider service for ERC-8183. Its isolated execution package is:

`agents/grid/execution/`

Important files:

- `src/altanaExecutor.ts` — reconstructs the session from the agent's private key, validates public key/address identity, runs Risk Guardian, then calls the Altana SDK `execute()` on BSC Testnet.
- `src/riskGuardian.ts` — validates target/selector/expiry/value/batch rules.
- `src/server.ts` — private execution endpoint with bearer protection plus read-only PancakeSwap preflight.
- `src/types.ts` — execution/session types.
- `src/pancakeSwap.ts` — deterministic ERC-20 approval and PancakeSwap `exactInputSingle` calldata builder.
- `src/preflight.ts` — read-only Testnet router/token bytecode and calldata preflight.

The execution service exposes public capability metadata through:

`GET /execution-capabilities`

and the same public metadata through `GET /health`.

Read-only PancakeSwap preflight is available through:

`POST /preflight/pancake`

It never calls `Altana execute()` and always reports `broadcast: false`.

It checks that the configured router and both token addresses have deployed bytecode on BSC Testnet and returns deterministic call data.

Environment examples:

```text
PORT=8788
GRID_EXECUTION_SHARED_SECRET=<private>
ALTANA_SESSION_PRIVATE_KEY=<agent session private key>
GRID_ALLOWED_TARGETS=<comma-separated BSC testnet contract addresses>
GRID_ALLOWED_SELECTORS=<comma-separated 4-byte selectors>
PANCAKE_TESTNET_ROUTER=<verified BSC testnet router>
PANCAKE_TESTNET_POOL_FEE=<pool fee>
```

The selector allowlist must remain explicit. Empty selectors reject execution.

## Free-plan deployment architecture — completed

The dedicated executor service is **not** provisioned as another Railway service.

The existing `grid-agent-testnet-v4` service remains the single Railway resource and now has a deployment-ready architecture in `agents/grid/Dockerfile`:

```text
Railway Grid service
   ├─ FastAPI / Uvicorn :8000 (public)
   │    ├─ /erc8183/*
   │    ├─ /execution-capabilities
   │    ├─ /health
   │    ├─ /preflight/pancake
   │    └─ /execute
   │
   └─ Node Altana executor :8788 (localhost only)
        ├─ /health
        ├─ /execution-capabilities
        ├─ /preflight/pancake
        └─ /execute
```

FastAPI proxies the execution endpoints to the internal Node process. The executor is allowed to start unconfigured so the existing ERC-8183 service does not break; it reports `execution_ready: false` until the required execution variables exist and rejects execution with `503` until configured.

This uses one existing Railway service and does not request any additional Free-plan resource.

The GitHub Testnet workflow now also runs a Docker build of `agents/grid/Dockerfile` so the embedded executor container is validated on every `marketplace-testnet` push.

### Railway branch note

The existing Railway `grid-agent-testnet-v4` service is currently configured to track the repository's `main` branch. The available Railway connector actions do not provide a source-branch update operation. Do **not** merge `marketplace-testnet` into `main` solely to force deployment; the code is ready for the existing service once its Railway source branch is updated in the Railway UI/API.

## Current CI / deployment checkpoint

Latest implementation commits:

- `9ad6977118f7d634f2c3a30d1aaafb17dcbb273c` — embedded Altana executor fail-closed behavior;
- `cae68e29be6e55a7dae6387de8a872f85df3f54a` — FastAPI proxy for embedded executor;
- `efce6562a8a1c989174b72d8cc9f5994055d0ed6` — free-plan Docker container CI validation.

The Vercel deployment for the previous receipt-evidence commit is READY. The latest branch commit is pending its fresh CI/Vercel run and must be rechecked before claiming the full latest build is green.

## Next exact implementation step

The remaining environment step is:

```text
existing Railway Grid service
    ↓
point service source to marketplace-testnet
    ↓
set execution variables on that same service
    ↓
GET /execution-capabilities
    ↓
read-only PancakeSwap preflight
    ↓
controlled Testnet execution
    ↓
BSC Testnet receipt
    ↓
execution evidence
```

Required runtime variables for the embedded executor are:

```text
GRID_EXECUTION_SHARED_SECRET=<private>
ALTANA_SESSION_PRIVATE_KEY=<agent session private key>
GRID_ALLOWED_TARGETS=<comma-separated BSC testnet contract addresses>
GRID_ALLOWED_SELECTORS=<comma-separated 4-byte selectors>
PANCAKE_TESTNET_ROUTER=<verified BSC testnet router>
PANCAKE_TESTNET_POOL_FEE=<pool fee>
```

Do **not** hard-code PancakeSwap addresses in the generic AgentMarket marketplace. The Grid service must declare its Testnet capability through `/execution-capabilities`.

Do **not** mark the Grid agent as a real execution agent until the same existing Railway service is actually running the embedded executor and a real BSC Testnet transaction receipt has been independently observed.

## After the real execution proof

1. Verify the same Grid service returns `execution_ready: true`.
2. Verify router/token configuration and selector allowlist through the live executor configuration.
3. Run the authenticated read-only PancakeSwap preflight.
4. Execute one controlled Testnet call through the already-authorized Altana session.
5. Independently capture the receipt.
6. Store execution evidence.
7. Add execution evidence to the ERC-8183 evidence presentation where appropriate.
8. Add session revocation and expiry handling.
9. Add independent mid-session spend/asset tracking.

## Documentation rule

Every new feature gets its own README. Existing phase READMEs include:

- `docs/EXECUTION-PROFILES-README.md`
- `docs/PROTOCOL-AWARE-HIRING-README.md`
- `docs/ERC8183-HIRING-LIFECYCLE-README.md`
- `docs/AGENT-EXECUTION-CAPITAL-README.md`
- `docs/AGENT-EXECUTION-CAPITAL-ALTANA-INTEGRATION-README.md`
- `docs/AGENT-EXECUTION-CAPITAL-GRID-EXECUTOR-README.md`
