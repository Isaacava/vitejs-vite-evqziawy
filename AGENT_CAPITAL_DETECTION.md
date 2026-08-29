# AgentMarket — Agent-Agnostic Execution Capital Detection

## Purpose

AgentMarket must independently detect and validate execution capital requested by an agent when the agent needs funds to perform a user-authorized on-chain task.

Grid remains the first-party BNB Agent Studio / ERC-8183 test agent. ERC-8183 is not removed or replaced. Grid is used to prove the generic marketplace flow; the marketplace must not hardcode Grid-specific token or amount assumptions.

## Detection sources

AgentMarket resolves a capital request from these sources:

1. An existing execution-capital request stored for the job.
2. A public agent-declared execution-capital request endpoint.
3. An execution-capital request embedded in the agent's published capability document.

The detector also recognizes common metadata declarations such as `execution_capital_request_url`, `execution_capital_requirements_url`, and nested equivalents.

The detector probes conventional public paths when an agent exposes an endpoint but does not explicitly name a capital-request URL:

- `/execution-capital-request`
- `/execution-capital`
- `/capital-request`

No AgentMarket-private secret is required for this discovery step.

## What AgentMarket extracts

For a detected request, AgentMarket resolves and normalizes:

- network and chain ID;
- capital token address;
- requested amount in human units and raw units;
- on-chain token decimals and symbol;
- token out, when supplied;
- protocol and preflight path, when supplied;
- target/router address, when supplied;
- function selector, when supplied;
- execution recipient/wallet, when supplied;
- pool fee, when supplied;
- original request payload for evidence.

## Independent verification

The marketplace does not blindly trust the agent's token symbol or decimals. Token metadata is read directly from BSC Testnet.

The marketplace rejects a request that is not for BSC Testnet, has a non-positive amount, or exceeds the Testnet safety cap of one whole unit of the requested token.

When the agent capability declares a concrete `execution_market.token_in`, the detected capital token must match it. This prevents an agent from advertising one execution asset and requesting a different capital token.

## Grid test case

Grid continues to use the BNB Agent SDK and ERC-8183 funded-job flow. Its Pancake V3 / CAKE2 execution capability is a concrete provider implementation, not a marketplace-wide constant.

For a Grid request, AgentMarket should be able to independently display facts such as:

```text
Token requested: CAKE2
Amount requested: 1 CAKE2
Token out: WBNB
Protocol: Pancake V3
Target: declared router
Selector: declared swap selector
Chain: BSC Testnet (97)
```

The same detection layer must work for a future agent requesting another token, protocol, amount, or execution target without adding a Grid-specific branch to the marketplace core.

## Authorization boundary

Detection is separate from authorization.

The flow is:

```text
Agent requests capital
        -> AgentMarket detects request
        -> AgentMarket independently normalizes token/amount/chain/target/call
        -> AgentMarket validates against agent capability
        -> AgentMarket validates user/job authorization
        -> AgentMarket performs protocol-specific preflight
        -> scoped execution authorization is checked
        -> agent executes
        -> AgentMarket observes the chain independently
        -> receipt and execution evidence are persisted
```

AgentMarket should never treat detection alone as permission to move funds.

## Current implementation

- `server/_testnet/execution-capital-detection.ts` — generic detection and normalization engine.
- `server/_testnet/execution-capital-requirement.ts` — job ownership, live Testnet checks, capability resolution, and safety enforcement around the detector.
- `server/_testnet/execution-capital-preflight.ts` — downstream execution validation; protocol-specific checks remain scoped to the declared protocol.

## Non-goals

This feature does not remove ERC-8183 from Grid.

This feature does not make AgentMarket depend on Grid.

This feature does not trust an agent's statement that a transaction succeeded; chain observation remains independent.

This feature does not expose agent private keys or require third-party agents to know an AgentMarket-only secret.
