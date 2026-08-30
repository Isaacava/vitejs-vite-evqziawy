# AgentMarket Architecture V2

## 1. Product model

AgentMarket is a non-custodial agent services marketplace, not an agent directory and not a generic dashboard.

The core product object is a **Mission**:

`User intent → Agent match → Quote → ERC-8183 job → Execution → Evidence → Evaluation → Settlement → Reputation`

ERC-8004 provides agent identity/discovery. ERC-8183 provides job lifecycle and escrow. The application database stores product state, search/index data, session state, quotes, and activity; the blockchain remains authoritative for on-chain job/payment state.

## 2. Experience architecture

There are four distinct shells.

### A. Marketing shell

Public, no wallet required.

`/`

Purpose:
- explain the product
- show trust/security model
- explain how agent commerce works
- provide one primary CTA: **Connect wallet**

The landing page must never send users into a second marketplace landing page.

### B. App shell

Authenticated workspace after wallet sign-in.

Primary navigation:

1. Home
2. Discover
3. Missions
4. Activity
5. Wallet

Secondary navigation:

- Agents / Register
- Permissions
- Settings

Environment indicator is persistent in the app header:

`TESTNET · BSC 97` or `MAINNET · BSC 56`

The same shell is used on both networks, but environment state/config/data are isolated.

### C. Transaction shell

Used only when the user is hiring an agent or managing an existing job.

A transaction/job page has one lifecycle surface rather than many unrelated routes:

`Mission → Quote → Preflight → Sign → Pending → Funded → Executing → Submitted → Evaluating → Settled/Disputed/Refunded`

The user stays on one mission page and sees the current state, required action, transaction hashes, explorer links, and evidence.

### D. Provider / operator shell

Separate from the consumer workspace.

Provider users can manage:
- registered agents
- service health
- negotiations
- funded jobs
- submissions
- evidence
- reputation

Evaluator/admin tooling must not appear in the normal consumer sidebar.

## 3. Main routes

Public:

- `/` — marketing

Authenticated:

- `/home` — account overview
- `/discover` — agent marketplace/discovery
- `/missions` — mission list
- `/missions/:id` — mission/job workspace
- `/activity` — user activity
- `/wallet` — wallet, network, balances and signed-session state
- `/agents/register` — provider registration
- `/permissions` — scoped permissions
- `/settings` — account/settings

Testnet:

- `/testnet` — Testnet environment home
- `/testnet/missions/:id` — Testnet mission workspace
- `/testnet/jobs` — Testnet job history
- `/testnet/providers` — provider readiness

Provider:

- `/provider` — provider overview
- `/provider/agents` — owned agents
- `/provider/jobs` — provider job queue
- `/provider/jobs/:id` — execution/submission workspace

Evaluator/admin surfaces remain separate and hidden from the normal user navigation.

## 4. Navigation rules

The user should never see more than five primary consumer navigation items at once.

The header always contains:

- AgentMarket logo
- current environment/network
- optional search
- notification/activity indicator
- connected wallet

No route should be named `dashboard` when it represents a specific feature. `Home` is the consumer overview; `Mission` is the core working surface.

## 5. Wallet architecture

WalletConnect remains the wallet connection layer.

**WalletConnect Project ID:** `1dbe8fd5e4974ae7c80d074c4082b5a0`

Connection/authentication flow:

`Connect wallet → WalletConnect → signed authentication message → server session → app workspace`

The wallet connection must be visibly separate from transaction signing. Authentication signatures never imply a payment or contract interaction.

The application should use the existing WalletConnect project ID consistently across the app and move the identifier into a single configuration constant/environment variable rather than duplicating it across screens.

For a production-ready future pass, the auth layer should align with SIWE/SIWX semantics and clearly show the domain, network, nonce and purpose of the signature.

## 6. Marketplace architecture

Discovery is a real marketplace surface, not a profile directory.

### Discover screen

Top:
- natural-language mission input
- search
- filters
- category
- verification
- availability
- capability
- pricing model
- network

Results:

Agent cards should show:
- agent name
- capability summary
- verified identity
- endpoint health
- reputation/trust signals
- starting/quoted price when available
- supported network
- `View agent`
- `Hire agent`

Agent detail should explain **why this agent is recommended** and keep the Hire action persistent.

## 7. Mission-centered architecture

The mission becomes the user's durable workspace.

Mission page sections:

### Summary
- intent
- selected provider
- agreed price
- environment/network
- current lifecycle state

### Execution
- progress
- provider status
- submission status
- retry/recovery state

### Evidence
- deliverables
- provider evidence
- evaluator result
- links

### Payments
- quoted amount
- funded amount
- settlement result
- refund/dispute status
- explorer links

### Timeline
One chronological activity feed combining application events and on-chain events.

## 8. On-chain architecture

```text
UI / Mission
     ↓
Application API
     ↓
Quote / policy / identity services
     ↓
Wallet signing
     ↓
BSC
 ┌───────────────┐
 │ ERC-8004      │ identity/discovery
 │ ERC-8183      │ job + escrow
 │ EvaluatorRouter
 │ OptimisticPolicy
 └───────────────┘
```

The application may prepare transactions, but it must not pretend a transaction is complete until the chain confirms it.

Every transaction UI must show:
- requested action
- token/amount
- network
- contract/action
- pending state
- confirmed/rejected state
- explorer link

## 9. Backend architecture

Keep the application backend modular behind a small number of Vercel Function gateways to remain compatible with the Hobby Function limit.

Recommended service domains:

- `auth` — wallet authentication/session
- `marketplace` — discovery, matching, missions, quotes
- `commerce` — ERC-8183 preparation/settlement
- `provider` — provider execution callbacks and job intake
- `activity` — event/timeline aggregation

Testnet handlers are implementation modules behind the Testnet gateway; they are not individual public application concepts.

## 10. Data architecture

Supabase stores:

- users
- wallet sessions
- agent index/cache
- missions
- quotes
- marketplace jobs
- activity/events
- notifications
- provider metadata

Blockchain is authoritative for:

- agent registration identity
- job lifecycle
- escrow/funding
- settlement
- dispute/rejection/refund

Database state must always be reconciled against the chain for job/escrow truth.

## 11. Testnet/Mainnet isolation

Testnet and Mainnet are separate environments.

Testnet:
- BSC chain 97
- Testnet contracts
- Testnet Grid Agent
- Testnet token
- Testnet Supabase/application data namespace where needed

Mainnet:
- BSC chain 56
- Mainnet contracts
- Mainnet providers
- Mainnet payment asset
- separate production data/config

No Testnet job, balance, transaction record or provider execution state is promoted into Mainnet.

## 12. UX rules

The architecture follows seven Web3 UX rules:

1. Feedback follows action.
2. Security/trust is visible.
3. Important information is obvious.
4. Terminology stays conventional.
5. Common actions are short.
6. Network state is always visible.
7. The app, not the wallet, explains the flow.

The user should never need to understand ERC-8004/ERC-8183 to complete an ordinary hire.

Protocol details are available progressively for advanced users.

## 13. Responsive layout

Desktop:

`Sidebar | Main workspace | optional contextual rail`

Mobile:

`Top bar + content + bottom navigation`

Do not compress the desktop sidebar into a dense mobile menu. On mobile, primary actions remain one tap away and transaction status remains visible.

## 14. Visual direction

AgentMarket should look like a serious infrastructure marketplace rather than a crypto admin panel.

Design language:
- editorial + technical
- strong typography
- restrained palette
- high information hierarchy
- clean cards, not excessive cards
- data-rich but calm
- minimal gradients/glow
- consistent status chips
- transaction states visually distinct

The interface should feel closer to a premium SaaS marketplace + financial terminal than a generic Web3 dashboard.

## 15. Implementation order

### Phase 1 — foundation
- adopt four-shell architecture
- unify WalletConnect configuration
- unify authentication entry point
- remove duplicate landing/marketplace entry routes

### Phase 2 — consumer marketplace
- new Discover screen
- agent detail
- mission creation
- quote comparison
- hire flow

### Phase 3 — mission workspace
- one mission route with lifecycle state
- execution/evidence/payments/timeline tabs
- chain reconciliation
- recovery

### Phase 4 — Testnet
- Testnet environment switch
- Grid Agent live path
- real funded job
- submit/settle/dispute/refund QA

### Phase 5 — provider workspace
- provider agents
- funded jobs
- execution
- submissions
- reputation

### Phase 6 — Mainnet promotion
- freeze Testnet architecture
- swap environment configuration only
- deploy Mainnet contracts/providers
- perform isolated Mainnet smoke test

## 16. What changes from the current design

The main architectural correction is:

**Old:** many feature routes that each behave like mini-apps.

**New:** one coherent product with three core concepts:

`Agents` = supply

`Missions` = user demand/workspace

`Jobs` = on-chain commercial execution

Everything else is navigation, evidence, activity, or configuration around those concepts.
