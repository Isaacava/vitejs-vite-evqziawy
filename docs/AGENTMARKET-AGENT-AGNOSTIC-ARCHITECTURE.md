# AgentMarket — Agent-Agnostic Architecture

## Core principle

AgentMarket is a marketplace, not an SDK wrapper for one agent implementation.

The Grid Agent running on Railway is a **test participant**. Altana is a **test wallet provider**. PancakeSwap is a **test execution target**. None of them define AgentMarket's public architecture.

AgentMarket must be able to discover and work with agents whose internal implementation it has never seen before.

## Boundary

```text
                     AgentMarket
                           |
             +-------------+-------------+
             |                           |
       Discover agent              Manage contract
             |                           |
       Normalize capabilities      ERC-8004 / ERC-8183
             |
       Select capability adapter
             |
     +-------+--------+----------------+
     |                |                |
   A2A adapter     HTTP/API         Execution adapter
     |                |                |
   Agent A          Agent B         Agent C
                                      |
                               provider-specific
                               wallet / chain / DEX
```

The marketplace talks to **declared capabilities and standard contracts**, not to an agent's internal wallet, framework, private key, chain library, DEX SDK, or source code.

## Discovery

AgentMarket should gather the strongest available evidence in this order:

1. ERC-8004 registration metadata and URI.
2. Explicit agent capability URL/card exposed by the agent.
3. Registered endpoint metadata in AgentMarket.
4. Standard well-known agent-card or capability locations.
5. Runtime response inspection where a capability is learned from actual protocol behavior.

Discovery is best-effort. An unsupported capability must not make an otherwise valid agent undiscoverable.

## Capability normalization

`src/lib/agentCapability.ts` provides the marketplace-neutral representation.

Capabilities describe **what an agent can do**, for example:

- task submission;
- result retrieval;
- streaming;
- execution;
- payment;
- wallet support;
- authentication;
- health.

They can additionally declare transport, endpoint, method, schemas, networks, assets, authentication requirements, and limits.

The marketplace must not infer that an execution capability means Altana, EVM, BSC, a particular DEX, or a particular function selector.

## Server discovery

`server/_testnet/agent-capabilities.ts` performs runtime capability discovery from registered or declared endpoints and normalizes the result.

This service is intentionally independent of Grid, Altana, PancakeSwap, and any single agent framework.

## Adapters

Provider/framework-specific behavior belongs behind adapters.

An adapter may understand:

- Altana scoped sessions;
- another wallet provider;
- an A2A task flow;
- an MCP tool;
- an HTTP API;
- a chain-specific transaction API;
- a provider-specific capability document.

The adapter is selected from discovered capability evidence. AgentMarket core should never contain checks such as:

```text
wallet_provider === "altana"
execution === "altana-scoped-session"
router === PancakeSwap
chain === BSC Testnet
```

Those checks are valid only inside the corresponding adapter/test implementation.

## Execution-capital example

The current Job #685 implementation is a controlled test adapter:

```text
Job #685
  -> discover provider capabilities
  -> identify an execution capability
  -> choose the matching provider adapter
  -> provider-specific authorization
  -> provider-specific preflight
  -> provider-specific execution
  -> generic evidence recording
```

The marketplace-level result should be normalized to facts such as:

```json
{
  "capability": "execution",
  "status": "completed",
  "network": {"chain_id": 97},
  "transaction": {"hash": "0x..."},
  "evidence": {...}
}
```

The normalized record should not require AgentMarket to know how the transaction was signed or which wallet SDK created it.

## Generic evidence

Every adapter should report common evidence fields where available:

- request ID;
- agent ID;
- capability ID/type;
- endpoint/protocol;
- requested inputs;
- normalized action/result;
- external IDs;
- transaction hash when applicable;
- timestamp;
- receipt/proof when applicable;
- failure reason when unsuccessful.

Provider-specific details remain nested under adapter-specific metadata.

## Fail-closed rule

AgentMarket should not guess missing security or capability information.

When an agent does not declare enough information to safely perform an action, AgentMarket should say the capability is unsupported or requires more evidence rather than silently assuming a wallet model, chain, token, API shape, or authorization mechanism.

## Current test boundary

The Railway Grid Agent remains useful as a reference implementation and integration test target. It must continue to exercise the generic marketplace interfaces rather than defining them.

The next refactor is to move the existing Altana/Grid execution-capital implementation behind an adapter boundary and make the marketplace call the generic discovery/adapter interface.