# BNB Agent Studio Marketplace

An AI-powered DeFi agent marketplace built for the BNB Chain Agent Studio Marketplace hackathon.

The product is not a directory of our own agents. A user states a goal in natural language, the marketplace matches that goal against ERC-8004-registered agents, explains why the selected agent is reliable, and then turns the hire into a verifiable ERC-8183 mission.

## Current stack

- React 19 + TypeScript + Vite
- Vercel web/API deployment
- Supabase PostgreSQL for marketplace/workflow state
- viem for BNB Smart Chain reads and wallet transaction preparation
- WalletConnect/browser wallet connection
- ERC-8004 identity/indexing
- ERC-8183 Agentic Commerce / escrow lifecycle
- GitHub Actions for ERC-8004 indexing

## How the product works

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
Top agent + alternatives + "why this agent"
   ↓
Mission created
   ↓
ERC-8183 preparation
   ↓
User wallet signs createJob/registerJob/setBudget/approve/fund
   ↓
Receipt verification
   ↓
Real JobCreated event → chain jobId
   ↓
FUNDED job
   ↓
Provider inbox
   ↓
Agent accepts / works / submits
   ↓
Agent wallet signs submit(jobId, deliverableHash)
   ↓
ERC-8183 policy / dispute window
   ↓
settle(jobId) OR dispute/voteReject/claimRefund
   ↓
Terminal chain state
   ↓
Supabase workflow sync + user activity + provider notification
   ↓
Verified evidence for future matching
```

Blockchain state is the source of truth for identity, job state, escrow, submission, dispute and settlement. Supabase is the marketplace/workflow source of truth for missions, tasks, inbox messages, activity, notifications and indexed evidence.

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
- ERC-8183 preparation UI
- BSC Testnet payment-token, balance and allowance preflight

**Remaining**

- Surface the complete score breakdown directly in the recommendation card
- Add alternative-agent comparison with the same evidence model
- Improve category/capability normalization for third-party registration metadata

### Phase 3 — Agent execution

**Done**

- Funded-job provider inbox
- Provider-owner authorization
- Provider workflow states: accept → start → progress/message → submit
- BSC Testnet provider-side validation before actions
- Real wallet-signed ERC-8183 submit flow
- Deliverable hashing and receipt validation
- Automatic JobCreated event parsing

**Remaining**

- Replace demo/provider-console actions with live BNB Agent Studio agent runtimes
- Add runtime health/heartbeat history
- Implement the four first-party agents through the BNB Agent Studio SDK/CLI pipeline

### Phase 4 — Settlement / recovery

**Done**

- Evaluator console
- Optimistic-policy/dispute-window presentation
- Settlement preparation
- Client dispute path
- Whitelisted-voter rejection path
- Expiry refund path
- Chain-receipt verification and workflow synchronization
- Funded/submitted notifications and user activity fan-out

**Remaining**

- End-to-end live `settle(jobId)` receipt synchronization
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

These agents should use the same ERC-8004/Agent Studio/ ERC-8183 pipeline as third-party agents. They are bootstrap inventory, not the marketplace itself.

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

### Phase 8 — Final hackathon polish

- Mission Mode timeline
- Stronger agent comparison UX
- Analytics
- Portfolio dashboard
- Evidence/Agent Advantage report
- Demo data seeded only where clearly labeled as demo/testnet
- Final responsive/accessibility pass
- Full Vercel verification sweep
- Demo video and submission materials

## Important protocol boundary

The current BNB Agent SDK documentation describes ERC-8183 as a three-layer commerce stack: AgenticCommerce for job lifecycle/escrow, EvaluatorRouter for evaluator/policy routing, and OptimisticPolicy for optimistic settlement/disputes. The supported job flow is create → register → set budget → fund → provider submit → settle, with dispute and refund recovery paths. See the current BNB Agent SDK documentation before changing contract behavior.

## Verification policy

A GitHub commit is considered **committed** when the change is present on `feature/marketplace-matching-api`.

A change is considered **verified** only after Vercel reports a successful build and we check runtime error clusters on that deployment.

This distinction is intentionally kept strict while the project is on Vercel Hobby, where repeated builds can be blocked by the platform's build-rate limit.

## Development

```bash
npm install
npm run dev
npm run build
npm run lint
```

## Current priority order

1. Get the latest unverified matcher/evidence commits through a clean Vercel build.
2. Put the transparent matcher breakdown into the recommendation UI.
3. Complete terminal-state settlement synchronization.
4. Build the four first-party BNB Agent Studio agents through the real runtime pipeline.
5. Connect scoped permissions to actual DeFi execution guardrails.
6. Run the full regression/security/deployment sweep before submission.
