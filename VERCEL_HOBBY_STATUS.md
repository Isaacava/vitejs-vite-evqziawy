# Vercel Hobby Deployment Status

Last verified: 2026-08-16

## AgentMarket project

- Vercel project: `agentmarket`
- Framework: Vite
- Hobby Serverless Function limit: 12 deployable API entrypoints per deployment.

## Current Testnet branch architecture

The `marketplace-testnet` branch has been consolidated to exactly 12 deployable `api/*.ts` entrypoints. Supporting implementation files are underscore-prefixed and are not deployed as independent Functions.

The consolidated entrypoints are:

- `api/agent.ts`
- `api/auth.ts`
- `api/check-agent-endpoints.ts`
- `api/dashboard.ts`
- `api/erc8183.ts`
- `api/index-agents.ts`
- `api/jobs.ts`
- `api/agents/register.ts`
- `api/erc8183/prepare.ts`
- `api/marketplace.ts`
- `api/testnet.ts`
- `api/erc8183-settlement.ts`

The existing Testnet API URLs remain available through `vercel.json` rewrites and are routed through the Testnet gateway.

## Previous deployment findings

The most recent Testnet deployment for commit `478ef70885cd...` failed during TypeScript compilation because `marketplaceJobId` in `src/TestnetQuoteGate.tsx` was unused. That issue was fixed in commit `efbecf304e1302ecb3ec1c85e5e4fe13edb19db1`, and GitHub CI #122 passed for the fix.

The current consolidation must now be validated by a fresh GitHub -> Vercel deployment.

## Deployment gate

1. GitHub CI must pass TypeScript/Vite, Grid Agent tests, Testnet isolation, ERC-8183 lifecycle audit, and the 12-Function budget audit.
2. Vercel preview must complete without a TypeScript/build error.
3. Vercel must no longer report the Hobby 12-Function limit for the Testnet branch.
4. Only after these pass should new marketplace feature work continue.
