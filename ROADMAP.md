# AgentMarket — Testnet-First Development Roadmap

Last updated: 2026-08-15

## 1. What the project is

AgentMarket is an agent-to-agent marketplace where a user can describe a task, discover an on-chain AI provider, negotiate terms, approve the quoted price, create and fund an ERC-8183 job, let the provider execute the work, verify the submitted deliverable, and settle the job on-chain.

The marketplace is designed around:

- **ERC-8004** for agent identity/discovery.
- **ERC-8183** for agentic commerce, escrow, job lifecycle, evaluator routing, disputes, and settlement.
- **Grid Agent** as the first real provider being integrated into the marketplace.
- **Supabase** for application state, marketplace metadata, quotes, missions, activity, and mirrored chain state.
- **Vercel** for the web/API deployment.
- **Wallet signing** in the browser for client-controlled on-chain transactions.

The immediate goal is NOT Mainnet. The complete platform is being built and tested on BSC Testnet first.

## 2. Environment strategy

### Development / Testnet

`marketplace-testnet` is the complete development environment.

- BSC Testnet / chain 97.
- Testnet ERC-8004 registry.
- Testnet ERC-8183 Commerce.
- Testnet EvaluatorRouter.
- Testnet OptimisticPolicy.
- Testnet payment asset.
- Testnet Grid Agent.
- Testnet-only API routes under `/api/testnet/*`.
- Testnet-only marketplace matcher/evaluator paths.
- Dedicated Testnet UI/sandbox and wallet execution.

### Production / Mainnet

`main` remains the future production target.

- BSC Mainnet / chain 56.
- Mainnet contract configuration is kept separate.
- Mainnet handlers are not used by the Testnet UI.
- Testnet and Mainnet job IDs, payment records, agent health state, and execution routes must never be interlinked.

Promotion to Mainnet happens only after the Testnet lifecycle passes end-to-end.

## 3. What is already built

### Marketplace foundation — DONE

- User authentication and wallet binding.
- Mission/task model.
- Agent registry/discovery model.
- Provider matching and health awareness.
- Marketplace job/mission persistence.
- Activity/state synchronization.

### ERC-8004 — DONE / INTEGRATED

- Agent identity/discovery support.
- Testnet agent indexing/synchronization path.
- Testnet Grid Agent registration/discovery integration.
- Testnet-only provider matching.

### Grid Agent — DONE / INTEGRATED

- Dedicated Grid Agent Testnet runtime.
- ERC-8183 service integration.
- SDK-shaped job parsing using `jobId` and `description`.
- Grid parameter validation.
- Test coverage for funded-job payload parsing.
- Testnet dependency declaration.
- Provider negotiation endpoint integration.
- Provider quote generation/acceptance path.
- Provider health checks.

### Quote negotiation — DONE

The marketplace now follows the intended negotiation pattern:

`request quote → provider returns quote → user reviews → accept quote → quote hash is locked → quote becomes the source of the ERC-8183 budget/terms`

Implemented protections include:

- quote ownership by wallet.
- quote expiration.
- Testnet chain binding.
- quote integrity hash.
- accepted-quote requirement before ERC-8183 preparation.
- provider health verification before preparation.
- accepted quote parameters anchored into the ERC-8183 job description.

### ERC-8183 job preparation — DONE

The Testnet marketplace can prepare the complete client transaction sequence:

`createJob → registerJob → setBudget → approve (when needed) → fund`

The preparation path is quote-gated and chain-specific.

### Wallet execution — DONE / INTEGRATED

The Testnet UI now has a sequential wallet transaction runner.

Rules enforced:

- wallet must be on chain 97.
- connected wallet must match the authenticated marketplace user.
- dependent transactions remain locked until the previous receipt is verified.
- token approval only happens when required.
- `fund` cannot unlock until required approval is confirmed.
- receipts are checked and mirrored to the marketplace.
- create-job receipt is parsed to obtain the real on-chain `jobId`.

### Provider execution tracking — DONE / INTEGRATED

After funding, the marketplace reads the real ERC-8183 Commerce job and tracks:

`FUNDED → SUBMITTED → COMPLETED / REJECTED / EXPIRED`

The client cannot simply change this state in Supabase; the chain is treated as the source of truth.

### Settlement — DONE / INTEGRATED

- Testnet settlement-plan endpoint.
- Settlement simulation before exposing the wallet action.
- `Router.settle(jobId, ...)` wallet execution.
- Settlement receipt verification.
- Marketplace settlement synchronization.

### Dispute / reject / refund paths — DONE / INTEGRATED

Testnet has a dedicated lifecycle controller covering:

- client dispute during the dispute window.
- eligible voter rejection through OptimisticPolicy.
- expiry refund through `claimRefund(jobId)`.

These actions are guarded by the live on-chain job state, wallet identity, expiry, and protocol rules.

### Testnet Sandbox — DONE

A dedicated `/testnet` control center provides:

- wallet readiness.
- chain-97 readiness.
- authentication readiness.
- Testnet contract visibility.
- entry into the full Testnet marketplace.

The sandbox deliberately does not switch production Mainnet routes to Testnet.

### CI / verification — DONE / ACTIVE

GitHub CI for `marketplace-testnet` now checks:

1. TypeScript/Vite build.
2. Grid Agent tests.
3. Testnet/Mainnet address isolation.
4. Testnet identifiers / chain configuration.
5. ERC-8183 protocol surface coverage including creation, funding, settlement, dispute, rejection, and refund paths.

Recent verified fixes included TypeScript contract typing, wallet event typing, payment response typing, Grid Agent imports, and the Testnet network isolation checks.

## 4. Current development state

### Primary goal right now

**Make the complete Testnet marketplace lifecycle genuinely usable from the browser with the real Grid Agent.**

The architecture is substantially built. The remaining work is increasingly about live integration verification rather than inventing the core marketplace protocol.

### Current active work

1. **Live Testnet integration verification**
   - Run the marketplace against the real Testnet Grid Agent endpoint.
   - Confirm ERC-8004 identity resolves to the provider endpoint.
   - Confirm `/negotiate` returns the expected signed quote.
   - Confirm accepted quote reaches ERC-8183 preparation.
   - Confirm real wallet transactions succeed in sequence.

2. **End-to-end funded-job execution**
   - Fund a real Testnet ERC-8183 job.
   - Verify the Grid Agent's funded-job poller detects it.
   - Confirm the agent executes the Grid strategy.
   - Confirm provider submission is reflected on-chain.

3. **Settlement-window verification**
   - Verify the real dispute window behavior on a Testnet job.
   - Verify settlement is blocked during the window when appropriate.
   - Verify settlement becomes executable after the protocol says it is allowed.

4. **Unhappy-path integration testing**
   - Client dispute.
   - Whitelisted voter rejection.
   - No-quorum expiry.
   - `claimRefund` after expiry.
   - Marketplace state must mirror each resulting chain status correctly.

5. **Data consistency / recovery**
   - Retry-safe receipt synchronization.
   - Idempotent polling.
   - Recovery when the browser closes between transactions.
   - Recovery after a transaction succeeds but the UI loses connection.
   - Protection against stale quote/job state.

6. **UX hardening**
   - Better transaction progress messaging.
   - Clear Testnet-only labels.
   - Explorer links for every important transaction.
   - Clear error recovery for insufficient test funds, wrong network, expired quote, rejected signature, and expired job.

## 5. Vercel status

The connected Vercel project is `agentmarket`.

The latest Testnet deployments are currently marked `ERROR`, but the Vercel integration is not exposing a new application build/runtime error for the latest attempts. The project also currently reports no runtime-error clusters.

Earlier deployment attempts produced a known Hobby-plan deployment/build-rate limitation. That is treated separately from real application build failures.

Rule for ongoing development:

- **Hobby/deployment quota error:** continue building and use GitHub CI as the code gate.
- **Real TypeScript/build/runtime error:** stop feature work and fix it before continuing.

## 6. How the platform works

### User flow

`User opens marketplace`

→ connects wallet

→ authenticates wallet with AgentMarket

→ describes a mission

→ marketplace searches verified agents

→ Grid Agent is selected

→ marketplace requests provider quote

→ provider negotiates and signs quote

→ user reviews price, expiry, provider and terms

→ user accepts quote

→ marketplace hashes/locks the accepted quote

→ API prepares ERC-8183 transaction plan

→ user signs `createJob`

→ marketplace verifies receipt and extracts `jobId`

→ user signs `registerJob`

→ user signs `setBudget`

→ user approves Testnet payment token if required

→ user signs `fund`

→ Commerce job becomes `FUNDED`

→ Grid Agent funded-job poller detects job

→ Grid Agent executes the requested strategy

→ Grid Agent submits deliverable

→ job becomes `SUBMITTED`

→ evaluator policy controls the verdict

→ dispute window passes or dispute is resolved

→ anyone can settle when protocol permits

→ provider is paid or client is refunded

→ AgentMarket mirrors the final chain state

→ reputation/evidence/history are updated.

### Important principle

**The blockchain is the source of truth for protocol state.**

Supabase stores marketplace application state and mirrors verified chain state, but it does not decide whether a job is funded, submitted, disputed, rejected, settled, or refundable.

## 7. Architecture

```text
                         ┌─────────────────────────┐
                         │       AgentMarket        │
                         │   React / Vite frontend  │
                         └────────────┬────────────┘
                                      │
                        wallet + HTTPS│
                                      ▼
                         ┌─────────────────────────┐
                         │      Vercel API         │
                         │ auth / match / quotes   │
                         │ Testnet ERC-8183 APIs   │
                         └───────┬─────────┬───────┘
                                 │         │
                         app state│         │chain reads/tx plans
                                 ▼         ▼
                    ┌────────────────┐   ┌─────────────────────┐
                    │    Supabase    │   │   BSC Testnet       │
                    │ missions       │   │ chain 97            │
                    │ agents         │   │                     │
                    │ quotes         │   │ ERC-8004             │
                    │ jobs/activity  │   │ ERC-8183 Commerce    │
                    └────────────────┘   │ EvaluatorRouter      │
                                         │ OptimisticPolicy     │
                                         └──────────┬──────────┘
                                                    │
                                                    │ funded job
                                                    ▼
                                         ┌─────────────────────┐
                                         │     Grid Agent      │
                                         │ BSC Testnet provider│
                                         │ negotiate / execute │
                                         │ submit deliverable  │
                                         └─────────────────────┘
```

### Protocol layers

**Layer 1 — Identity**

ERC-8004 identifies and exposes the provider agent and its service endpoint.

**Layer 2 — Negotiation**

HTTP negotiation establishes price and terms off-chain. The accepted quote is then anchored into the on-chain job description.

**Layer 3 — Commerce**

ERC-8183 Commerce owns the job state and escrow: creation, budget, funding, submission, completion/rejection, and expiry refund.

**Layer 4 — Evaluation**

EvaluatorRouter binds the job to the policy that produces the verdict used by settlement.

**Layer 5 — Policy**

OptimisticPolicy gives the client a dispute window and a voter-based rejection path.

**Layer 6 — Provider execution**

Grid Agent watches for funded jobs, executes the task, stores/returns the deliverable, and submits the result.

## 8. Why AgentMarket is valuable

AgentMarket is not simply an agent directory.

It turns agent discovery into an actual **agent commerce workflow**:

`discover → negotiate → contract → escrow → execute → evaluate → settle → reputation`

This lets a marketplace user interact with agents as service providers rather than merely browsing agent profiles.

The first provider, Grid Agent, gives us a concrete service with real on-chain execution instead of a demo-only provider.

## 9. What is still pending before Testnet is considered complete

The Testnet milestone should not be called complete until all of these pass with real transactions:

- [ ] Real Grid Agent is indexed through ERC-8004.
- [ ] Real quote is returned from the provider and accepted by the user.
- [ ] Real Testnet job is created from accepted quote.
- [ ] Real Testnet payment token approval/funding succeeds.
- [ ] Grid Agent detects the funded job.
- [ ] Grid Agent completes the requested Grid operation.
- [ ] Deliverable is submitted and visible on-chain.
- [ ] Settlement is successfully completed after the correct protocol window.
- [ ] Dispute path is successfully tested.
- [ ] Reject/refund path is successfully tested.
- [ ] Browser refresh/reconnect recovery works for an in-flight job.
- [ ] Final AgentMarket history/evidence state matches chain state.
- [ ] Testnet QA runbook is executed successfully from a clean wallet.

## 10. Mainnet promotion plan

Mainnet is a **promotion step**, not a second development project.

Once Testnet is green:

1. Freeze the Testnet implementation.
2. Capture exact contract/network configuration.
3. Create/verify Mainnet ERC-8004 identity configuration.
4. Configure Mainnet ERC-8183 Commerce/Router/Policy.
5. Configure production payment asset.
6. Configure production Grid Agent endpoint/wallet.
7. Point production API routes at Mainnet only.
8. Keep `/api/testnet/*` isolated or disabled in production.
9. Run static network-isolation audit.
10. Run production staging checklist.
11. Perform a small Mainnet smoke test.
12. Promote the verified marketplace to Mainnet.

### Non-negotiable migration rule

**Testnet and Mainnet data/transactions must never interlink.**

We migrate architecture and tested application code—not Testnet balances, jobs, agent activity, or transaction state.

## 11. Current overall status

**Architecture:** ~90% built

**Core marketplace logic:** ~90% built

**ERC-8004 integration:** ~90% built

**ERC-8183 integration:** ~90% built

**Grid Agent integration:** ~85% built

**Testnet UX:** ~90% built

**Automated verification:** ~85% built

**Live end-to-end Testnet validation:** PENDING

**Mainnet migration:** NOT STARTED — intentionally

The project is currently in the important transition from **building protocol plumbing** to **proving the complete live Testnet lifecycle**.

## 12. Immediate next milestone

### TESTNET GO-LIVE CHECK

Run the real flow with one clean Testnet wallet:

`/testnet`

→ wallet/auth checks

→ marketplace

→ Grid Agent discovery

→ quote

→ acceptance

→ ERC-8183 execution

→ Grid Agent fulfillment

→ submission

→ settlement/dispute/refund tests

→ final state/reputation verification.

Only after that checklist passes should the project move toward Mainnet promotion.
