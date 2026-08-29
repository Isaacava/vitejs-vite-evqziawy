# AgentMarket — Generic Execution Runtime

## Goal

AgentMarket must execute proposals from agents whose internal implementation is unknown to the marketplace.

The generic runtime therefore consumes a normalized `ExecutionProposal` and does not interpret agent-specific strategy parameters.

## Layers

```text
Agent identity / agent card
        -> declared capability
        -> normalized execution proposal
        -> Risk Guardian evaluation
        -> user authorization / Altana session
        -> wallet preflight
        -> execution
        -> independent receipt/effect verification
```

### ExecutionProposal

`src/server/executionProposal.ts` defines the shared proposal shape. It contains common fields such as job, agent identity, chain, wallet, action, token/protocol/target/selector, notional, spend cap, slippage, risk and expiry.

`parameters` is intentionally `Record<string, unknown>`. Agent-specific details are opaque to the generic runtime.

### MissionExecutionRuntime

`src/server/missionExecutionRuntime.ts` owns the shared state machine:

`planned -> risk_review -> blocked | awaiting_user | approved -> ready_for_wallet -> executing -> submitted -> verified`

The runtime only enforces generic state transitions. It does not contain grid mechanics, swap logic or any other agent-specific strategy.

### Grid adapter

Grid remains a first-party BNB Agent Studio / BNB Agent SDK / ERC-8183 test agent.

`src/server/gridProposal.ts` specializes `ExecutionProposal` for the Grid strategy while keeping its `lower_price`, `upper_price` and `grid_levels` parameters opaque to the shared runtime.

`src/server/gridAgentRuntime.ts` is now a compatibility adapter over `MissionExecutionRuntime`. Existing Grid callers can retain the Grid-named API while the underlying state machine is generic.

## Interoperability rule

AgentMarket must not inspect or depend on another agent's source code to determine how it works.

Compatibility is established from:

1. published identity/capability information;
2. normalized execution proposal data when supplied by the supported protocol/adapter;
3. user authorization such as an Altana scoped session;
4. actual transaction and receipt evidence.

No `if agent == grid` logic belongs in the generic runtime.

## ERC-8183 relationship

ERC-8183 remains the commerce/job/escrow protocol used by the marketplace and Grid test agent. Generic execution authorization is a separate layer and must not replace ERC-8183.

## Validation rule

Authorization is not execution proof. The runtime may move to `submitted` when a transaction hash is recorded, but `verified` requires independent chain observation in the surrounding execution/evidence layer.
