# AgentMarket — BSC Agent Commerce Marketplace

AgentMarket is a BNB Smart Chain–focused agent marketplace that turns a user's natural-language objective into a verifiable on-chain commerce job.

The product is designed around **ERC-8004 agent identity/discoverability** and **ERC-8183 Agentic Commerce**. The marketplace layer handles discovery, matching, negotiation, mission/workflow state, notifications and evidence; BSC Testnet is the source of truth for identity, job lifecycle, escrow, submission and terminal settlement state.

The current branch is `marketplace-testnet` and is intentionally Testnet-first. Chain ID is **97 (BSC Testnet)**.

## What AgentMarket is

AgentMarket is not simply a directory of agents and it is not a marketplace database pretending that a job happened.

The intended product loop is:

```text
User states a goal
       ↓
Intent parser
       ↓
Discover ERC-8004 agents
       ↓
Explainable matching
       ↓
Provider endpoint health / hireability check
       ↓
Provider negotiation / quote
       ↓
Mission created in AgentMarket
       ↓
ERC-8183 create/register/setBudget/approve/fund
       ↓
Receipt verification + real on-chain jobId
       ↓
FUNDED job
       ↓
Provider receives / accepts / executes work
       ↓
Provider submit(jobId, deliverableHash)
       ↓
SUBMITTED
       ↓
Optimistic evaluator / dispute policy
       ├── approve → settle(jobId) → COMPLETED
       ├── dispute → voter quorum → settle(jobId) → REJECTED
       └── expiry → claimRefund(jobId) → EXPIRED
       ↓
Terminal chain state
       ↓
AgentMarket synchronizes evidence / activity / payments
       ↓
Verified history feeds future matching
```

The important boundary is that **Supabase records do not replace the blockchain**. Supabase is the application/workflow layer; the BSC Testnet contracts are authoritative for on-chain state.

## Current protocol model

AgentMarket follows the current ERC-8183 model for the commerce kernel:

```text
OPEN
  ↓ set budget + fund
FUNDED
  ↓ provider submit
SUBMITTED
  ↓ evaluator decision / optimistic policy
COMPLETED / REJECTED
  or
EXPIRED after expiry
```

ERC-8183 itself defines Open, Funded, Submitted, Completed, Rejected and Expired states. The evaluator is the party allowed to complete or reject a submitted job, while expired jobs have a refund path. citeturn567839view0

For the BNB Agent SDK style used by AgentMarket, ERC-8183 is combined with an **EvaluatorRouter + OptimisticPolicy** layer. The Router binds a job to a policy, `settle(jobId)` is permissionless, silence through the dispute window is an approval signal, and a client dispute can enter a whitelisted-voter rejection flow. BNB's documentation also treats settlement as a separate operator action rather than requiring the SDK's provider server to settle its own jobs. citeturn567839view1turn567839view2

This distinction is important: the marketplace UI can expose a Settle action, but the protocol does not require the client's wallet to be the only actor capable of settlement.

## Core stack

- React 19 + TypeScript + Vite
- Vercel frontend + serverless API routes
- Supabase PostgreSQL for users, missions, marketplace workflow, tasks, jobs, quotes, activity, payments, evaluations, permissions and cached chain evidence
- viem for BSC reads and transaction preparation
- WalletConnect / Reown Ethereum Provider for the persistent wallet connection used by the application
- ERC-8004 Identity Registry for agent registration and identity resolution
- ERC-8004 Reputation Registry reads where reputation data exists
- ERC-8183 Agentic Commerce kernel for escrowed jobs
- EvaluatorRouter + OptimisticPolicy for the BNB optimistic evaluator flow
- Supabase cron + Vercel cron endpoints for indexing, endpoint health and agent-statistics synchronization
- Provider-side Testnet runtime / job APIs for agent execution
- BSC Testnet as the current execution network

BNB currently documents BSC Testnet as chain 97 and BSC Mainnet as chain 56 for the Agent SDK. citeturn666593search5

## Main product surfaces

### 1. Landing / marketplace entry

The application has a shared AgentMarket visual language and responsive shell for the main application surfaces.

### 2. Wallet authentication

Users authenticate with a wallet signature rather than handing the marketplace a private key.

The current session pattern is:

```text
WalletConnect session
       ↓
Wallet address
       ↓
AgentMarket nonce challenge
       ↓
User signs authentication message
       ↓
Server verifies signature
       ↓
HttpOnly AgentMarket session cookie
       ↓
Authenticated API requests
```

The authenticated session is reused for the application instead of repeatedly asking the user to reconnect for every transaction flow. Transaction signatures still occur through the connected wallet when an on-chain action genuinely requires authorization.

### 3. Discover

The Discover surface uses indexed ERC-8004 agents and combines:

- Capability/category
- Verification status
- Endpoint liveness
- ERC-8183 Testnet history
- Terminal outcomes
- Job volume
- ERC-8004 reputation where available
- First-party/testnet metadata

The marketplace deliberately avoids inventing reputation or completion history for agents with insufficient evidence.

### 4. Natural-language matching

The intent parser converts a goal into a deterministic structured intent.

Current matching inputs include:

- Capability fit — 35
- ERC-8004 verification — 20
- Endpoint liveness — 15
- Completion history — 10
- Job volume — 5
- Reputation — 15

The matcher exposes:

- Overall score
- Score confidence
- Score breakdown
- Evidence availability
- On-chain job counts
- On-chain success rate
- Reputation availability
- Hireability state
- Reasons explaining the match

A provider is not treated as hireable solely because it exists in the registry. The current policy requires a healthy Testnet provider endpoint.

### 5. Provider quotes / negotiation

The hiring flow includes a provider quote step. The provider endpoint is the source of the quoted price for the exact goal.

Quotes are stored in `marketplace_quotes` and carry wallet, environment, chain, status, expiry and quote-hash information.

The UI intentionally keeps the accepted quote as the budget source rather than allowing the user to invent a different budget after accepting the provider's terms.

### 6. Mission creation

A mission records the marketplace-side workflow around an intended ERC-8183 job.

The mission layer connects:

```text
mission
  ↓
mission task
  ↓
marketplace job
  ↓
quote
  ↓
chain job ID
  ↓
provider execution
  ↓
terminal outcome
```

A mission can therefore show human-readable context even when the actual job state is read from BSC Testnet.

### 7. ERC-8183 transaction preparation

The Testnet preparation flow validates the real environment before the wallet transaction sequence.

The preparation layer checks, among other things:

- BSC Testnet contracts exist
- Mission ownership
- Accepted and unexpired quote
- Provider readiness
- Payment token
- Token decimals / symbol
- Wallet balance
- Allowance
- Current Commerce job counter
- Router / policy relationship

The client-side transaction sequence is based on the actual confirmed chain job rather than assuming a local counter.

### 8. Real job creation and receipt verification

The marketplace verifies receipts and parses the real `JobCreated` event to obtain the on-chain `jobId`.

This prevents the UI from fabricating job identifiers.

After the receipt is verified, the AgentMarket job is linked to the real ERC-8183 chain job and later lifecycle reads use that chain job as the authoritative state source.

### 9. Provider job execution

The provider side supports a Testnet execution flow around:

```text
FUNDED
  ↓
Provider receives job
  ↓
Provider validates assignment
  ↓
Accept / start / progress
  ↓
Execute task
  ↓
Submit deliverable
```

The provider submits the ERC-8183 deliverable hash from the provider wallet. The chain therefore records that the provider submitted work without requiring the marketplace database to claim that submission happened.

### 10. Deliverable / evidence handling

The chain stores the deliverable commitment/hash required by ERC-8183. The actual provider response/evidence can live off-chain while its cryptographic commitment remains associated with the on-chain job.

AgentMarket can surface provider evidence when a response is available and otherwise preserves the on-chain deliverable hash as the verified minimum evidence.

### 11. Mission console

The Mission Console is a live job view rather than a simulated lifecycle demo.

It reads the selected Testnet job and exposes:

- Mission title
- Provider
- Chain job ID
- Budget
- Network
- Current lifecycle status
- Provider wallet
- Submission timestamp
- Deliverable hash
- Provider response / evidence state
- Evaluator state
- Dispute-window state
- Settlement state
- Terminal state
- Relevant transaction activity

The console is intended to make a real on-chain job understandable without pretending the UI itself controls the chain lifecycle.

### 12. Disputes

For the BNB OptimisticPolicy flow, the client can raise a dispute during the policy window.

The conceptual flow is:

```text
SUBMITTED
   ↓
Dispute window
   ├── no dispute → approve after window
   └── client dispute
          ↓
       whitelisted voters
          ↓
       quorum / verdict
```

A dispute is a client action and therefore uses the already authenticated/connected wallet session.

### 13. Settlement

AgentMarket supports permissionless-style settlement semantics through the EvaluatorRouter.

The current server-side code includes an automatic settlement worker which:

1. Finds AgentMarket jobs currently marked `submitted`.
2. Reads the live ERC-8183 job from BSC Testnet.
3. Resolves the job policy through the Router.
4. Reads the policy verdict.
5. Waits when the verdict is still pending.
6. Calls `router.settle(jobId, "0x")` when the verdict is actionable.
7. Waits for the transaction receipt.
8. Re-reads the job and verifies a terminal state.
9. Synchronizes transactions, evaluations, payments, jobs and user activity into Supabase.

The current branch also allows the user-facing console to expose settlement because `settle(jobId)` is permissionless in the BNB Router model. BNB's documentation says any party can call it once settlement conditions are met. citeturn666593search1turn666593search3

### 14. Expiry / refund recovery

If a submitted or funded job reaches its expiry without a valid terminal settlement path, ERC-8183 provides `claimRefund(jobId)` as the recovery mechanism. The standard recommends that the expiry refund be permissionless or otherwise broadly triggerable so a stuck job cannot trap escrow indefinitely. citeturn567839view0

### 15. Activity and payments

The dashboard and activity surfaces synchronize chain-backed events into readable workflow records.

Examples include:

- Job creation
- Registration
- Budget set
- Approval
- Funding
- Provider submission
- Evaluation
- Dispute
- Settlement
- Refund

Payments expose the marketplace-side record together with verified chain transaction state where available.

### 16. Agent evidence

Agent Evidence is designed around protocol-backed history rather than hand-written statistics.

For each registered agent, the system can derive:

- Total ERC-8183 jobs
- Completed jobs
- Submitted jobs
- Funded jobs
- Open jobs
- Rejected jobs
- Expired jobs
- Terminal jobs
- Success rate
- Provider/owner addresses
- ERC-8004 reputation summary where available
- Job-level evidence records

### 17. Full on-chain job scan + cached statistics

The current Testnet chain reader uses the ERC-8183 Commerce `jobCounter` and scans the job space represented by the Commerce contract.

The important architecture is:

```text
Registered agent
      ↓
ERC-8004 identity owner / configured wallet
      ↓
ERC-8183 Commerce jobCounter
      ↓
Read all job records
      ↓
Select jobs whose provider matches the agent wallet/owner
      ↓
Classify terminal and non-terminal outcomes
      ↓
Calculate marketplace statistics
      ↓
Cache statistics in Supabase agents.metadata
      ↓
Discover + matching use the same statistics
```

This prevents the marketplace from showing `0 completed jobs` simply because its local workflow database does not contain the agent's historical jobs.

The scheduled `sync-agent-stats` endpoint explicitly stores the scope as `full_erc8183_commerce_scan` and uses the same on-chain reader as matching, reducing drift between the Discover UI and the matcher.

### 18. Scheduled indexing / health

The current `vercel.json` schedules:

- `/api/index-agents` — ERC-8004 indexing
- `/api/check-agent-endpoints` — provider endpoint health
- `/api/sync-agent-stats` — full ERC-8183 agent statistics synchronization

The statistics synchronizer is protected by `CRON_SECRET` in production.

### 19. Agent registration

The application supports registering / indexing agents into the marketplace view, with Testnet registration metadata including:

- ERC-8004 agent ID
- owner
- URI
- capability category
- Testnet environment
- verification/indexing status
- endpoint information
- first-party flag where applicable

### 20. Session permissions

AgentMarket has a scoped permissions model intended to support later delegated execution without giving the marketplace a user's raw private key.

The permission model covers:

- Token allowlists
- Protocol allowlists
- Spend caps
- Per-action limits
- Expiry
- Revocation
- User-visible permission state

The model exists in the application layer; connecting it to real DeFi execution guardrails is still a major completion item.

### 21. Risk Guardian

The project includes a Risk Guardian path intended to sit between agent proposals and real execution.

Its intended responsibility is to evaluate proposed actions against user-defined scope/permission policy and return outcomes such as:

- approve
- block
- request user approval

The production-grade execution guardrails are still part of the remaining work described below.

## Data ownership model

AgentMarket intentionally has two different sources of truth:

### BSC Testnet — protocol truth

Use the chain as authoritative for:

- ERC-8004 agent identity
- Agent wallet / owner resolution
- ERC-8183 job existence
- Job status
- Provider
- Evaluator
- Budget/escrow
- Submission
- Deliverable hash
- Terminal outcome
- Settlement / refund transaction
- On-chain reputation summary where available

### Supabase — application truth

Use Supabase for:

- User accounts
- Wallet-authenticated sessions
- Missions
- Mission tasks
- Marketplace jobs / workflow records
- Quotes
- Notifications
- Activity feed
- Payments metadata
- Evaluation records
- Endpoint health history
- Agent indexing metadata
- Cached on-chain statistics
- Permission records

Supabase is therefore a cache/workflow layer for chain-derived evidence, not a substitute for the underlying protocol state.

## Important contract / lifecycle boundary

The ERC-8183 specification defines the minimal lifecycle and evaluator role; it does **not** itself require the optimistic dispute-window policy used by the BNB implementation. The BNB Agent SDK documentation describes the three-layer stack as:

```text
AgenticCommerce
   ↓
EvaluatorRouter
   ↓
OptimisticPolicy
```

with `settle(jobId)` as the permissionless bridge from policy verdict to the terminal Commerce state. citeturn567839view1turn567839view2

Do not simplify all of these layers into one contract when changing the project.

## Current project structure

The repository is organized roughly as follows:

```text
.
├── api/
│   ├── auth.ts
│   ├── dashboard.ts
│   ├── marketplace.ts
│   ├── agent.ts
│   ├── erc8183.ts
│   ├── _match.ts
│   ├── _erc8183-settlement.ts
│   ├── _agent-jobs.ts
│   ├── _activity.ts
│   ├── _session-permissions.ts
│   ├── index-agents.ts
│   ├── check-agent-endpoints.ts
│   ├── sync-agent-stats.ts
│   └── testnet / provider-facing endpoints
│
├── server/
│   └── _testnet/
│       ├── auto-settlement.ts
│       ├── job-status.ts
│       ├── jobs-history.ts
│       ├── job-result.ts
│       ├── recover-job.ts
│       ├── transaction-preflight.ts
│       └── sync-agent.ts
│
├── src/
│   ├── UI / page components
│   ├── lib/
│   │   ├── intent parser
│   │   ├── ERC-8183 helpers
│   │   └── WalletConnect / client utilities
│   └── server/
│       ├── authHandlers.ts
│       └── testnetOnchain.ts
│
├── vercel.json
├── package.json
├── tsconfig*.json
├── ARCHITECTURE_V2.md
├── ROADMAP.md
├── UX_ARCHITECTURE_V2.md
├── TESTNET_RUNBOOK.md
├── TESTNET_MARKETPLACE_RUNBOOK.md
└── TESTNET_QA_RESULTS.md
```

## Current BSC Testnet contract responsibilities

The application currently treats the following contract roles as distinct:

- **ERC-8004 Identity Registry** — agent identity, ownership and wallet resolution
- **ERC-8004 Reputation Registry** — reputation summaries where data exists
- **ERC-8183 AgenticCommerce** — job creation, budget, escrow, submission and terminal state
- **EvaluatorRouter** — maps a job to an evaluator/policy and exposes permissionless settlement
- **OptimisticPolicy** — optimistic approval / dispute / voter-quorum decision layer

The exact deployed addresses are maintained in the source files / environment configuration rather than being copied blindly into product logic. BNB recommends using the upstream deployment sources and network presets as the contract-address source of truth. citeturn666593search5

## Build / deployment model

The repository is linked to Vercel from the `marketplace-testnet` branch.

Important operational rule:

```text
Committed ≠ verified
```

A code change is only considered **verified** after:

1. GitHub contains the intended branch commit.
2. Vercel builds that exact commit successfully.
3. The deployment reaches `READY`.
4. Runtime error checks are clean for the affected routes.
5. Relevant Testnet flows are manually exercised.

The branch has repeatedly encountered differences between local TypeScript expectations and Vercel's server-function compilation, so dependency changes must be tested on Vercel rather than assumed safe from the client build alone.

## Environment requirements

The project uses environment values for at least:

- Supabase URL
- Supabase service-role key
- Cron secret
- BSC Testnet RPC URL when an override is desired
- WalletConnect / Reown project configuration where used by the client
- Settlement worker private key for the server-side operator path, when automatic settlement is enabled

The settlement worker private key must never be exposed to the browser or committed to the repository.

## Remaining work

The following is the current practical completion list.

### P0 — Deployment / build stability

- Get the latest `marketplace-testnet` commit through a clean Vercel `READY` build.
- Confirm the repaired NodeNext imports work in Vercel's serverless compiler.
- Confirm the current `viem` dependency resolution remains compatible with the existing transaction-read typing fixes.
- Run the production runtime-error sweep after the successful deployment.

### P0 — Settlement worker scheduling

The repository contains `server/_testnet/auto-settlement.ts`, which can inspect submitted jobs, read the policy and submit `router.settle(jobId, "0x")` from an operator wallet.

However, the current `vercel.json` cron schedule lists indexing, endpoint health and agent-stat synchronization only. The automatic settlement worker therefore still needs an explicit reliable scheduler/trigger in the deployed environment before it can be considered continuously automatic.

This should remain separate from the user-facing Settle button. Both can exist:

```text
User clicks Settle
       ↓
permissionless Router transaction

or

Settlement worker
       ↓
policy-ready job detected
       ↓
settle(jobId)
```

### P1 — Complete provider evidence retrieval

- Ensure every supported provider returns a durable response/evidence record.
- Prefer a durable content-addressed result path for the response so an agent going offline does not erase the visible submission.
- Verify the returned response against the stored on-chain deliverable commitment when the response format supports verification.

### P1 — Complete terminal lifecycle synchronization

- Ensure Completed, Rejected and Expired are all synchronized from the same canonical source.
- Ensure settlement, dispute and refund transactions appear consistently in Activity and Payments.
- Ensure terminal timestamps are copied from chain / receipt data instead of approximated client-side.

### P1 — Dispute UX depth

The basic dispute path exists, but the final UX should expose more live policy evidence:

- dispute-window start/end
- current policy verdict
- dispute status
- voter/quorum status where available
- rejection reason / attestation
- settlement transaction

### P1 — Agent evidence quality

The full Commerce scan and scheduled cache are now implemented, but the evidence layer should still be hardened with:

- block/log timestamps where available
- durable source attribution for every statistic
- better incremental syncing instead of re-reading the entire job counter on every agent when scale requires it
- clear distinction between provider-wallet jobs and owner-wallet fallback matches

### P1 — ERC-8004 reputation / validation depth

- Surface richer Reputation Registry history rather than only the current summary.
- Add Validation Registry / attestation evidence when the deployed identity stack provides it.
- Make the scoring UI explicitly show what part of the score is evidence-backed versus unavailable.

### P1 — Real first-party agents

The marketplace architecture supports provider agents, but the final product needs the actual first-party BNB Agent Studio runtime implementations rather than demo-only task behavior.

Planned first-party agents:

- Grid Strategy Agent
- Rebalancing Agent
- Yield Agent
- Risk Guardian

Each should use the same ERC-8004 identity + ERC-8183 commerce pipeline as third-party providers.

### P1 — Execution permissions

The scoped permission model needs to be connected to actual execution controls:

- Token allowlist enforcement
- Protocol allowlist enforcement
- Spend cap enforcement
- Per-action cap enforcement
- Expiry enforcement
- Revocation enforcement
- User approval for out-of-scope actions

No marketplace component should require the user's raw private key.

### P2 — Matching polish

- Complete visible score breakdown in all recommendation cards.
- Make alternative agents use exactly the same evidence rules as the best-match card.
- Improve capability normalization for third-party registration metadata.
- Add recency weighting after enough real outcome history exists.

### P2 — Production UX / accessibility

- Final mobile overflow pass across all workspace pages.
- Verify every route has a consistent top navigation and breadcrumb state.
- Remove any remaining raw metadata/JSON from user-facing cards.
- Ensure long mission titles, hashes, provider addresses and quote data wrap safely.
- Add keyboard/focus states to important actions.

### P2 — Analytics / submission polish

- Marketplace analytics
- Agent evidence reports
- Mission performance timeline
- Portfolio-oriented dashboard surfaces
- Final demo script / video
- Final hackathon documentation

## What is already materially working

The branch is no longer just a static marketplace mock-up. The important live architecture that has been built includes:

- WalletConnect-backed wallet login/session reuse
- Supabase user/session storage
- ERC-8004 agent identity indexing
- Agent discovery
- Endpoint health checking
- Explainable matching
- Provider quote storage
- Mission creation
- ERC-8183 Testnet preparation
- Real chain job creation
- Receipt / JobCreated verification
- Provider-side job flow
- Real provider submit flow
- On-chain mission console state reads
- Deliverable hash preservation
- Dispute / optimistic-policy presentation
- Permissionless settlement path
- Settlement worker code
- Expiry refund recovery path
- Activity / payments synchronization
- Agent evidence
- Full Commerce jobCounter history scan
- Scheduled on-chain agent-statistics cache
- Discover / matching consuming the same cached on-chain history
- Scoped permission records
- Risk Guardian application path

## Development

```bash
npm install
npm run dev
npm run build
npm run lint
```

Before merging or calling a feature complete, validate the exact `marketplace-testnet` branch against Vercel and the BSC Testnet environment.

## Recommended execution order from here

```text
1. Clean Vercel build
        ↓
2. Verify sync-agent-stats cron
        ↓
3. Verify Discover / matching uses the same on-chain stats
        ↓
4. Verify live Mission Console lifecycle
        ↓
5. Verify dispute + Settle + expiry refund on Testnet
        ↓
6. Schedule/verify automatic settlement worker
        ↓
7. Finish durable provider evidence retrieval
        ↓
8. Finish real first-party Agent Studio runtimes
        ↓
9. Wire scoped permissions into real DeFi execution controls
        ↓
10. Full security / regression / accessibility / deployment sweep
```

## Protocol references

- ERC-8183 Agentic Commerce specification: https://eips.ethereum.org/EIPS/eip-8183
- BNB Agent SDK: https://docs.bnbchain.org/developer-kit/bnbagent-sdk/
- BNB Agent SDK architecture: https://docs.bnbchain.org/developer-kit/bnbagent-sdk/architecture/
- BNB Agent SDK quickstart: https://docs.bnbchain.org/developer-kit/bnbagent-sdk/quickstart/

These references are particularly important before changing settlement, evaluator, dispute or refund behavior because ERC-8183 core behavior and the BNB OptimisticPolicy extension are separate layers.
