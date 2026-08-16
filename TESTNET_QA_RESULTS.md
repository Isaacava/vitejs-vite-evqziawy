# AgentMarket Testnet QA Results

## Purpose

This file is the evidence log for the first real AgentMarket marketplace run on BSC Testnet (chain 97). It deliberately records Testnet identifiers only. Mainnet contracts, balances, jobs, and transaction hashes must never be entered here.

## Environment

- Network: BSC Testnet
- Chain ID: 97
- Marketplace branch: `marketplace-testnet`
- Grid Agent: Testnet configuration only
- Payment asset: Testnet asset configured by the environment

## Verification gates

| Gate | Status | Evidence |
|---|---|---|
| GitHub TypeScript/Vite build | PASS | CI #108 |
| Grid Agent Testnet tests | PASS | CI #108 |
| Testnet/Mainnet isolation | PASS | CI #108 |
| ERC-8183 lifecycle surface audit | PASS | CI #108 |
| Transaction preflight API | PASS | CI #106 |
| Live Testnet wallet execution | PENDING | Record first real run below |
| Live provider execution | PENDING | Record first real run below |
| Live provider submission | PENDING | Record first real run below |
| Live settlement | PENDING | Record first real run below |
| Live dispute/refund path | PENDING | Record a separate unhappy-path run |

## Run 1 — Happy path

### Identity

- Testnet wallet: `PENDING`
- Mission ID: `PENDING`
- Marketplace job ID: `PENDING`
- Grid Agent ID: `PENDING`
- ERC-8004 identity/registration evidence: `PENDING`

### Quote

- Quote ID: `PENDING`
- Quote hash: `PENDING`
- Provider: `PENDING`
- Quoted price: `PENDING`
- Quote accepted timestamp: `PENDING`

### ERC-8183 transaction sequence

| Phase | Status | Transaction hash | Block | Notes |
|---|---|---|---|---|
| createJob | PENDING | — | — | — |
| registerJob | PENDING | — | — | — |
| setBudget | PENDING | — | — | — |
| approve | PENDING / NOT REQUIRED | — | — | — |
| fund | PENDING | — | — | — |

### Provider execution

- Funded observed by provider: `PENDING`
- Provider execution started: `PENDING`
- Provider execution completed: `PENDING`
- Deliverable submitted: `PENDING`
- Deliverable hash: `PENDING`

### Settlement

- Submitted observed by marketplace: `PENDING`
- Settlement simulation: `PENDING`
- Settlement transaction: `PENDING`
- Final on-chain status: `PENDING`
- Marketplace payment state: `PENDING`

## Run 2 — Unhappy path

Use a separate Testnet job. Never reuse the happy-path job.

- Scenario: `DISPUTE` / `EXPIRY_REFUND`
- Mission ID: `PENDING`
- Marketplace job ID: `PENDING`
- Chain job ID: `PENDING`
- Trigger transaction: `PENDING`
- Final on-chain status: `PENDING`
- Refund/decision transaction: `PENDING`

## Recovery test

The recovery test must verify that closing/reloading the browser does not reset the lifecycle.

- Job ID: `PENDING`
- Reload point: `PENDING`
- Recovered on-chain status: `PENDING`
- Correct next action displayed: `PENDING`
- No duplicate transaction submitted: `PENDING`

## Mainnet promotion gate

Mainnet migration must remain blocked until:

1. Happy-path Testnet run is complete.
2. At least one unhappy-path Testnet run is complete.
3. Recovery test is complete.
4. All transaction hashes resolve on BSC Testnet.
5. Grid Agent provider execution is confirmed independently of UI state.
6. Quote hash is identical between accepted quote and ERC-8183 job description.
7. Marketplace database state matches on-chain state for the final job.
8. No Testnet/Mainnet isolation audit regression exists.

## Vercel deployment note

As of the current development session, Vercel deployment inspection can return a 403 when the connector is not authorized for the project's team scope. Treat that as an observability/access limitation, not as evidence that the application build passes or fails. GitHub CI remains the verified code-build gate until Vercel access is restored.
