# BNB Agent Studio Marketplace

An AI-powered DeFi agent marketplace built for the BNB Chain Agent Studio Marketplace hackathon.

The product is not a directory of our own agents. A user states a goal in natural language, the marketplace matches that goal against ERC-8004-registered agents, explains why the selected agent is reliable, and then turns the hire into a verifiable ERC-8183 mission.

## Current project state — 18 Aug 2026

The marketplace application and the first-party **Grid Agent Testnet runtime are now connected and operational**.

The current verified Testnet provider runs as a persistent FastAPI service on Railway and is protected by a fail-closed Testnet configuration guard. Railway currently reports the `grid-agent-testnet-v4` service as **SUCCESS**, with `/health` returning HTTP 200. The public Testnet provider URL is:

```text
https://grid-agent-testnet-v4-production.up.railway.app
```

The provider is intentionally isolated from Mainnet. Its runtime requires `NETWORK=bsc-testnet`, rejects Mainnet-looking endpoints, requires a public HTTPS ERC-8183 endpoint ending in `/erc8183`, requires a positive service price, and validates the funded-job polling interval before startup.

**Important:** the service is live and healthy, but the first complete real funded marketplace mission has **not yet been completed**. That is the immediate next milestone.

## What the project is about

AgentMarket is a protocol-aware marketplace for hiring AI agents on BNB Chain. The core idea is:

1. A user describes the desired outcome.
2. AgentMarket matches the request to discoverable ERC-8004 agents using capability, availability, identity, evidence and endpoint-health signals.
3. The user creates a mission and receives a provider quote.
4. The user accepts the quote and signs the ERC-8183 job lifecycle with their wallet.
5. The selected provider watches the chain for a funded job, performs its task, submits a verifiable deliverable, and becomes eligible for settlement.
6. On-chain state remains the source of truth for identity, jobs, escrow, submission and settlement; Supabase stores marketplace/workflow state and indexed evidence.

For the hackathon Testnet phase, the first-party Grid Agent is a **strategy-only** provider. It does not custody user funds and does not execute trades. Its job is to receive a funded ERC-8183 task, validate the task, produce the deterministic Grid strategy deliverable, and submit that evidence back through the ERC-8183 flow.

## Architecture

```text
                         ┌──────────────────────────┐
                         │      AgentMarket UI       │
                         │ React + Vite + TypeScript │
                         └────────────┬─────────────┘
                                      │
                           WalletConnect auth
                                      │
                                      ▼
                         ┌──────────────────────────┐
                         │  Vercel / AgentMarket    │
                         │  Marketplace + API       │
                         └────────────┬─────────────┘
                                      │
                 ┌────────────────────┼────────────────────┐
                 │                    │                    │
                 ▼                    ▼                    ▼
          ERC-8004 registry       Supabase            BSC Testnet
          identity/evidence      workflow state       ERC-8183 jobs
                                                          │
                                                          │ FUNDED
                                                          ▼
                             ┌──────────────────────────────┐
                             │ Railway: Grid Agent Testnet  │
                             │ Persistent FastAPI service   │
                             │ + funded_job_watcher()       │
                             └──────────────┬───────────────┘
                                            │
                                     fulfill_grid_job()
                                            │
                                            ▼
                                  strategy deliverable
                                            │
                                            ▼
                                  ERC-8183 submit_result
                                            │
                                            ▼
                                      settlement flow
```

### Runtime separation

The intended deployment boundary is:

- **Vercel:** AgentMarket frontend and marketplace/serverless API layer.
- **Railway:** persistent first-party Grid Agent service.
- **BSC Testnet:** all current Grid Agent jobs, funds and provider operations.
- **Mainnet:** separate production configuration and contract path; it must not be linked to the Testnet provider runtime.

The Testnet Grid Agent's runtime guard is the final safety boundary. It fails closed when `NETWORK` is not exactly `bsc-testnet` and also rejects Mainnet-looking endpoints.

## How the marketplace works

```text
User goal
   ↓
Intent parser
   ↓
ERC-8004 agent registry + capability data
   ↓
Explainable matcher
   ├─ capability fit
   ├─ availability
   ├─ identity verification
   ├─ verified outcome history
   └─ endpoint liveness
   ↓
Top agent + alternatives + “why this agent”
   ↓
Mission created
   ↓
Provider quote
   ↓
Quote accepted
   ↓
ERC-8183 preparation
   ↓
Wallet signs createJob → registerJob → setBudget → approve (if needed) → fund
   ↓
Receipt verification
   ↓
Real JobCreated event → chain jobId
   ↓
FUNDED job
   ↓
Grid Agent funded-job watcher
   ↓
Grid strategy execution
   ↓
Agent wallet signs submit_result(jobId, deliverableHash)
   ↓
ERC-8183 policy / dispute window
   ↓
settle(jobId) OR dispute / rejection / refund path
   ↓
Terminal chain state
   ↓
Supabase workflow sync + user activity + provider notification
```

Blockchain state is the source of truth for identity, job state, escrow, submission, dispute and settlement. Supabase is the marketplace/workflow source of truth for missions, tasks, inbox messages, activity, notifications and indexed evidence.

## Current stack

- React 19 + TypeScript + Vite
- Vercel web/API deployment
- Supabase PostgreSQL for marketplace/workflow state
- viem for BNB Smart Chain reads and wallet transaction preparation
- WalletConnect/browser wallet connection
- ERC-8004 identity/indexing
- ERC-8183 Agentic Commerce / escrow lifecycle
- GitHub Actions for ERC-8004 indexing
- Railway persistent runtime for the first-party Grid Agent Testnet service
- FastAPI + Uvicorn for the Grid Agent HTTP/health surface
- BNB Agent SDK for ERC-8183 provider operations and funded-job watching

## What changed to make the Grid Agent Testnet runtime work

The working Railway v4 runtime is the result of several concrete fixes that are now documented so future agents/developers do not repeat the earlier deployment failures.

### 1. The provider became a real HTTP service

The original service relied on the SDK's server helper. The working implementation uses FastAPI directly and runs the BNB Agent SDK's `funded_job_watcher()` as a background task. This matters because Railway's HTTP healthcheck needs a real HTTP server while the funded-job watcher continues running in the background.

The implementation now initializes `EVMWalletProvider`, `ERC8183JobOps`, `LocalStorageProvider`, and the funded-job watcher explicitly, while keeping the Testnet configuration guard at process startup.

### 2. Health became a first-class endpoint

The provider exposes:

```text
GET /health
```

Railway now reaches the service and receives HTTP 200. This was a key difference between a build that merely succeeded and a service that could actually become healthy.

### 3. Python/FastAPI/Uvicorn runtime dependencies were made explicit

The Grid Agent runtime now declares FastAPI and Uvicorn explicitly rather than assuming a transitive dependency or optional SDK extra will provide them.

### 4. Railway port handling was corrected

Railway injects the runtime `PORT`. The provider must bind Uvicorn to the injected port rather than assume a fixed development port. The working runtime listens on Railway's assigned port and is therefore reachable by the healthcheck.

### 5. The Docker/runtime path was simplified

Earlier versions mixed Railway's Railpack virtual-environment assumptions with a repository-level Dockerfile. That produced repeated `python` and `.venv` startup errors. The working v4 service now uses the deployment configuration that actually matches the selected runtime/container path instead of assuming `/app/.venv` exists.

### 6. The provider stayed Testnet-only

The runtime configuration validator requires:

```text
NETWORK=bsc-testnet
ERC8183_AGENT_URL=https://.../erc8183
ERC8183_SERVICE_PRICE > 0
5 <= ERC8183_FUNDED_POLL_INTERVAL <= 300
```

It rejects missing/invalid configuration and blocks Mainnet-looking endpoints.

### 7. Deliverables are now publicly re-readable

The latest provider code serves the exact JSON manifest written by `submit_result()` at:

```text
GET /erc8183/job/{job_id}/response
```

The storage directory used by the endpoint is the same directory passed to `LocalStorageProvider`, so the response bytes can be fetched again and re-hashed against the on-chain manifest hash during verification.

A bare `GET /erc8183` may return 404; that is not the deliverable endpoint. The important job-specific route is `/erc8183/job/{job_id}/response`.

## Roadmap / build status

### Phase 1 — Foundation

**Done**

- Supabase marketplace schema and workflow tables
- Wallet authentication and owner-scoped reads
- ERC-8004 agent registration UI
- ERC-8004 registry indexer foundation
- Agent registry and agent profiles
- Agent inbox
- User dashboard with missions, activity, payments and notifications
- Scoped session-permission records with caps, token/protocol allowlists, expiry and revocation
- Supabase RLS hardening and trigger privilege hardening
- Responsive landing page and shared visual language

**Remaining**

- Expand passive indexing to continuously resolve more registration-file capabilities and endpoints
- Add richer endpoint health history instead of a single current signal

### Phase 2 — Matching + Hiring

**Done**

- Natural-language intent parser foundation
- Deterministic transparent matching engine
- Capability/availability/verification/liveness evidence
- No fabricated reputation or completion history for new agents
- Mission creation and mission history
- Provider quote flow
- ERC-8183 preparation UI
- BSC Testnet payment-token, balance and allowance preflight

**Remaining**

- Surface the complete score breakdown directly in the recommendation card
- Add alternative-agent comparison with the same evidence model
- Improve category/capability normalization for third-party registration metadata

### Phase 3 — First-party Grid Agent Testnet execution

**Done**

- Grid Agent provider application
- Testnet-only runtime validation
- Persistent Railway deployment
- FastAPI health surface
- BNB Agent SDK ERC-8183 job operations
- Background funded-job watcher
- Grid strategy fulfillment logic
- Provider-side wallet configuration hooks
- Public deliverable response route

**Current milestone**

- **Run the first complete real Testnet mission end-to-end.**

Required path:

```text
AgentMarket mission
→ real Grid Agent quote
→ accept quote
→ create/register/setBudget/fund
→ watcher detects FUNDED
→ fulfill_grid_job()
→ submit_result()
→ verifier refetches deliverable
→ settlement
```

### Phase 4 — Settlement / recovery

**Done**

- Evaluator console foundation
- Optimistic-policy/dispute-window presentation
- Settlement preparation
- Client dispute path
- Whitelisted-voter rejection path
- Expiry refund path
- Chain-receipt verification and workflow synchronization
- Funded/submitted notifications and user activity fan-out

**Remaining**

- Complete the first live `settle(jobId)` receipt synchronization in Testnet
- Explicit terminal-state mapping for every ERC-8183 outcome
- Richer dispute evidence and voter/evaluator status display

### Phase 5 — Evidence / reputation

**Done**

- Owner-scoped Agent Evidence workspace
- Live BSC Testnet evidence
- Verified marketplace outcome history
- Transparent terminal outcome counts/rate
- Explicit separation between protocol identity/reputation and AgentMarket-derived evidence
- No fake score for thin-history agents

**Remaining**

- Pull populated ERC-8004 Reputation Registry data when present
- Pull Validation Registry/attestation data when present
- Add recency weighting once enough real outcomes exist
- Feed evidence into the marketplace recommendation UI

### Phase 6 — First-party DeFi agents

**Status: remaining major product work**

- Grid Agent — market analysis → parameters → risk check → execution → monitoring
- Rebalancing Agent — portfolio → target allocation → drift → proposals → risk check → execution → verification
- Yield Agent — opportunity discovery → compare yield/risk/cost → strategy → execution → monitoring
- Risk Guardian — approve/block/request-user-approval for proposed actions from the other agents

These agents should use the same ERC-8004 / Agent Studio / ERC-8183 pipeline as third-party agents. They are bootstrap inventory, not the marketplace itself.

### Phase 7 — Custody / permissions

**Partially built**

The platform already models scoped session permissions. The remaining work is to connect those permissions to real execution authorization.

Required controls:

- Token allowlist
- Protocol allowlist
- Spend cap
- Per-action cap
- Expiry
- Revocation
- User-visible transaction/permission review
- No private-key custody by the marketplace

For real portfolio actions, the user must sign or delegate narrowly scoped permissions; the marketplace must never receive the user's raw private key.

### Phase 8 — Mainnet migration and final hackathon polish

Mainnet migration happens **only after Testnet is proven end-to-end**.

Planned order:

1. Finish real Testnet Grid Agent mission.
2. Verify ERC-8183 submission and settlement receipts.
3. Complete security/regression sweep.
4. Freeze Testnet configuration.
5. Create separate Mainnet runtime/configuration.
6. Verify Mainnet isolation from Testnet.
7. Migrate approved marketplace/provider configuration to Mainnet.
8. Final responsive/accessibility pass and submission materials.

## Verification / deployment policy

A GitHub commit is **committed** when the change is present on the target branch.

A deployment is **verified** only when the target platform reports a successful deployment and its runtime/health behavior has been checked.

For the Grid Agent Testnet runtime, the verified infrastructure state currently is:

```text
Railway service: grid-agent-testnet-v4
Deployment: 8cb44cb7-688c-4c66-94a9-659895e83be4
Status: SUCCESS
Health: GET /health → 200 OK
Network guard: bsc-testnet only
```

The existence of a healthy provider deployment does **not** mean the first complete funded mission has already succeeded. That mission is still the next verification milestone.

## Development

```bash
npm install
npm run dev
npm run build
npm run lint
```

For the Grid Agent service, use the Python environment/dependency manifest under `agents/grid` and run the service with Uvicorn on the runtime-provided port.

## Current priority order

1. Register/confirm the live Grid Agent Testnet endpoint in AgentMarket's provider readiness data.
2. Run the first real end-to-end Testnet mission.
3. Verify provider deliverable refetch, hash consistency and ERC-8183 settlement.
4. Record the real outcome in Supabase and AgentMarket evidence.
5. Only then continue with secondary marketplace polish and additional first-party agents.
6. After Testnet is proven, prepare a strictly isolated Mainnet migration.
