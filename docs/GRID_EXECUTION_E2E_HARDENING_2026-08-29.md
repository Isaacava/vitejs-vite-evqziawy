# Grid Execution E2E Hardening — 2026-08-29

## Problem observed

ERC-8183 jobs such as #734, #747, #762 and #766 reached `Submitted` even when Grid's own Testnet execution reported:

`tokenIn balance 0 is below amountIn 1000000000000000000`

The root cause was not ERC-8183 itself. Grid's funded-job callback converted execution exceptions into a failed deliverable and then called `submit_result()` anyway.

A second issue was that execution readiness verified Altana session authorization but did not verify the same execution wallet's live CAKE2 balance and router allowance before attempting the trade.

A third issue was inconsistent Grid market metadata: some paths reported a 500 fee tier while another result path still reported 2500.

## Correct protocol model

BNB Agent SDK's `fundedJobWatcher` detects funded jobs and dispatches them to the provider callback. The callback decides what work to perform. `submitResult` is the provider's submission step; transient provider failures should be retried rather than converted into a submitted deliverable.

Altana's SDK defines a scoped session with explicit call and spend permissions and provides `execute()` for the agent to act through that session. KeyStore is the on-chain authorization registry.

Therefore:

`ERC-8183 Funded`
`→ verify Altana authorization`
`→ verify exact execution capital readiness`
`→ agent performs its own execution checks`
`→ agent executes through its Altana session`
`→ agent observes successful receipt`
`→ submit ERC-8183 deliverable`

There is no valid path from `Funded` to `Submitted` when execution has not succeeded.

## Grid testnet market invariant

- Chain: BSC Testnet, chain ID 97
- Token in: CAKE2 `0x8d008B313C1d6C7fE2982F62d32Da7507cF43551`
- Token out: WBNB `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd`
- PancakeSwap V3 fee tier: 500
- Controlled amount: 1 CAKE2 = `1000000000000000000` raw units

The following must always agree:

`capability.token_in == capital_request.capital_token == funding.token == allowance.token == Grid readiness token == preflight.tokenIn == swap.tokenIn`

A token mismatch is a hard failure. The Grid test path must never fall back to a generic settlement token or another token address.

## Authorization and readiness are different

Altana authorization proves that the session key is valid for the user's Altana wallet.

Execution readiness additionally proves:

- chain is BSC Testnet 97;
- Altana KeyStore reports the session key as valid;
- the configured token is the canonical CAKE2 address;
- the CAKE2 contract exists and reports the expected symbol/decimals;
- the authorized Altana wallet has at least 1 CAKE2;
- the same wallet has at least 1 CAKE2 allowance for the configured PancakeSwap router;
- the configured router and execution selectors are present.

Only when all checks pass does Grid report itself ready to execute.

## Failed execution rule

`fulfill_grid_job_with_execution()` now raises on execution/preflight/readiness/receipt failure instead of returning a failed deliverable.

The ERC-8183 service also checks the returned execution metadata and refuses to call `submit_result()` unless the execution status is `executed` and a transaction hash is present.

This creates defense in depth:

1. agent execution layer refuses to manufacture a failed deliverable;
2. ERC-8183 service refuses to submit without successful execution evidence;
3. funded-job watcher can retry while the job remains FUNDED.

## Altana gas permission

Grid reconstructs both session spend permissions:

- the ERC-20 execution-token spend permission;
- the native BNB gas-recovery spend permission.

Omitting the native permission can cause Altana `execute()` to fail with `NoSpendPermissions` even when the token spend cap is present.

## Marketplace funding rule

The AgentMarket browser grant flow requires an explicit `capitalToken` supplied by the agent capability/request. It must not default to the marketplace settlement token.

The connected user wallet funds only the missing amount of the exact execution token into the user's own Altana wallet. The allowance step also uses the same token address and exact amount.

## Test procedure after deployment

Do not use an already-submitted job as the success test. Create a fresh ERC-8183 job after the hardened agent deployment is live.

Expected behavior for an underfunded wallet:

`Funded → Grid logs EXECUTION_WAIT → job remains FUNDED`

Expected behavior after the exact CAKE2 amount and allowance are present and the Altana session is valid:

`Funded → EXECUTION_READY → agent execution → successful receipt → Submitted`

Expected behavior after a successful execution:

The deliverable must contain transaction evidence, and AgentMarket must independently verify that receipt rather than trusting the provider's status string alone.

## Current deployment verification

The Grid Railway service `grid-agent-testnet-v4` is configured from repository `Isaacava/vitejs-vite-evqziawy`, branch `main`, Dockerfile `agents/grid/Dockerfile`.

The latest deployment checked on 2026-08-29 built successfully, compiled the dedicated Node execution service with `tsc`, started the Altana execution service on port 8788, started the FastAPI ERC-8183 service, and passed the `/erc8183` health check.

The latest deployment contained the canonical-market and failed-submission hardening commits.

## Remaining verification

The source and deployment are hardened, but a fresh funded job still needs to be run with the authorized Altana wallet actually holding 1 CAKE2 and the required router allowance. Until that fresh happy-path job produces a real BSC Testnet receipt and an ERC-8183 submission, the end-to-end trade path should not be called proven.
