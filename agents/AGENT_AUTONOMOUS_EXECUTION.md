# Grid Agent Autonomous Execution

## Purpose

Grid is the first-party BNB Agent Studio test agent used to prove that AgentMarket can hire a real agent without taking over the agent's execution path.

## Runtime flow

1. BNB Agent SDK watches the ERC-8183 commerce contract for FUNDED jobs assigned to Grid.
2. Grid receives the funded job through its own service callback.
3. Grid builds its grid strategy from the anchored job description.
4. Grid determines its Testnet execution parameters from the job plus its own configured execution market.
5. Grid calls its own localhost execution service and runs PancakeSwap Testnet preflight there.
6. The execution service constructs the Altana session from Grid's own deployment configuration and calls the official Altana `execute()` API with the configured scoped session.
7. Grid independently observes the BSC Testnet transaction receipt through its execution service.
8. Grid embeds the transaction hash and receipt evidence in its ERC-8183 deliverable.
9. The BNB Agent SDK submits the deliverable on-chain.

## Separation from AgentMarket

Grid does not call AgentMarket APIs to execute a trade. AgentMarket is not the execution button and is not the source of the Grid session descriptor.

Grid's execution bridge uses:

- `ALTANA_SESSION_PRIVATE_KEY` — secret session signer owned by the Grid runtime.
- `ALTANA_WALLET_ADDRESS` — the user's Altana wallet that granted the session.
- `ALTANA_SESSION_EXPIRY` — exact expiry from the already-granted session.
- `ALTANA_SESSION_SPEND_TOKEN` / `ALTANA_SESSION_SPEND_LIMIT` — the granted token scope.
- `GRID_ALLOWED_TARGETS` / `GRID_ALLOWED_SELECTORS` — Grid-side guardrails.

The on-chain Altana authorization remains authoritative. The execution code does not create a new user permission during the funded-job callback.

## Current Testnet proof

The controlled execution market is CAKE2 -> WBNB on BSC Testnet through the configured PancakeSwap V3 router. The default autonomous execution amount is exactly `1 CAKE2` (`1000000000000000000` raw units), matching the current controlled Testnet cap.

## UI rule

The AgentMarket Mission Console is observation/evidence only. Users do not manually run Grid preflight or press Grid's execute button. The agent performs those operational steps itself, while AgentMarket independently observes and verifies the result.
