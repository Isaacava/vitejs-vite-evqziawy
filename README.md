# BNB Agent Studio Marketplace

An AI-powered DeFi agent marketplace built for the BNB Chain Agent Studio Marketplace hackathon.

The goal is simple: a user describes an on-chain objective in natural language, the marketplace finds a compatible and reliable agent, and the user can hire that agent to execute a mission with transparent status, execution, and settlement.

## Current stack

- React + TypeScript + Vite
- Vercel for web/API deployment
- Supabase PostgreSQL for the agent index and marketplace data
- viem for BNB Smart Chain interactions
- WalletConnect for browser wallet connection
- ERC-8004 agent identity/indexing
- ERC-8183 agentic commerce/job execution
- GitHub Actions for scheduled ERC-8004 indexing

## Architecture

```text
User goal
   ↓
Intent + matching engine
   ↓
Agent registry (ERC-8004)
   ↓
Reliability score + "Why this agent?"
   ↓
Mission
   ↓
ERC-8183 job / funding
   ↓
Agent execution
   ↓
Evaluation + settlement
   ↓
Reputation + mission history
```

## Repository structure

- `src/App.tsx` — marketplace UI and wallet/job flow
- `src/AgentRegistry.tsx` — agent registry UI
- `src/lib/erc8183.ts` — BNB Chain/ERC-8183 contract configuration and clients
- `src/lib/supabase.ts` — centralized Supabase browser client
- `src/lib/matching.ts` — deterministic, explainable agent matching/scoring
- `index-agents.mjs` — ERC-8004 indexing worker
- `.github/workflows/index-agents.yml` — scheduled/manual indexer workflow

## Supabase

The connected project currently contains the ERC-8004 `agents` index plus marketplace tables for first-party agents, missions, mission tasks, and agent messages.

Browser configuration can be supplied with:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_WALLETCONNECT_PROJECT_ID
```

See `.env.example` for the expected names.

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

## Hackathon direction

The next implementation slices are:

1. Natural-language mission composer
2. Agent matching UI with transparent score breakdown
3. Agent profile/reputation pages
4. Mission creation and history backed by Supabase
5. ERC-8183 job lifecycle UI
6. First-party Grid, Rebalancing, Yield, and Risk Guardian agents
7. Evaluation, settlement, and reputation updates

The application should remain deployable on Vercel throughout development.
