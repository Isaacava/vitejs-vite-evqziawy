# AgentMarket — Protocol-Native Execution Capital Authorization

## Purpose

AgentMarket must work with agents whose internal code and implementation are unknown to the marketplace.

Grid is our first-party BNB Agent Studio / ERC-8183 test agent, but Grid's source code is not the compatibility contract for AgentMarket.

ERC-8183 remains part of the design. It is the job, commerce and escrow layer. Execution-capital authorization is a separate security boundary.

## What is standardized

The current BNB/Altana integration gives us two distinct primitives:

1. **ERC-8183** — job creation, negotiation/terms, budget, funding, provider work, submission, evaluation and settlement.
2. **Altana scoped sessions** — on-chain execution authorization containing call permissions, spend permissions and expiry, associated with a session key and verifiable through the Altana KeyStore.

There is no verified universal BNB/Altana HTTP endpoint named something like `/execution-capital-request` that every agent must implement.

Therefore AgentMarket must not invent one and must not infer compatibility from Grid-specific request JSON.

## Authorization-first model

The correct marketplace flow is:

```text
ERC-8183 job is funded
        -> provider is identified
        -> AgentMarket resolves supported execution capability
        -> Altana session authorization is verified
        -> allowed targets/selectors and expiry are checked
        -> actual execution intent/call is validated when available
        -> token + exact amount are derived from the actual call or chain evidence
        -> execution is allowed only within the granted scope
        -> AgentMarket independently observes the transaction receipt and effects
```

The Altana session answers **what the agent is allowed to do**. It does not by itself define the exact amount of every individual trade.

## Exact capital amount

AgentMarket must never display an invented amount.

An exact per-trade token amount can be established from an execution intent/call or from observed blockchain transaction data. For example, a protocol adapter can decode a DEX call's token and `amountIn`, while a receipt observer can independently verify actual ERC-20 transfers after execution.

Until such evidence exists, the marketplace should report the exact trade amount as **Not yet observed** rather than zero or a guessed value.

## Independent verification

AgentMarket independently verifies:

- chain/network;
- ERC-8183 job ownership and live status;
- provider execution capability;
- session public-key consistency;
- Altana KeyStore authorization when the exact session key identifier is available;
- authorization expiry;
- allowed contract targets;
- allowed function selectors;
- protocol-specific preflight requirements;
- actual BSC Testnet transaction receipts;
- actual asset movement/effects where observable.

The marketplace never trusts an agent's statement alone that funds were used or that a transaction succeeded.

## Grid test agent

Grid continues to be our first-party BNB Agent Studio / BNB Agent SDK test agent and retains ERC-8183.

Grid may advertise a concrete BSC Testnet execution capability such as CAKE2 -> WBNB through Pancake V3. That is a provider capability used to exercise the marketplace; it is not a marketplace-wide constant.

A different agent may use a different protocol, wallet provider, token, execution strategy or internal implementation without requiring AgentMarket to understand that agent's source code.

## No AgentMarket-specific secret requirement

Third-party agents must not be required to configure an AgentMarket-only shared secret merely to become compatible.

Secrets used for infrastructure controlled by AgentMarket may exist internally, but they are not part of the external agent interoperability contract.

## Current implementation boundary

`server/_testnet/execution-capital-requirement.ts` resolves the funded ERC-8183 job, provider capability and Altana authorization record for the Testnet console.

The previous custom `server/_testnet/execution-capital-detection.ts` implementation was intentionally removed because it defined a nonstandard capital-request protocol around Grid-like JSON fields.

The next execution-intent work should be implemented as protocol/adaptor logic that consumes concrete calls or on-chain evidence, not as a Grid-specific request convention.

## Test case: job #732

For the current Grid test job, AgentMarket should be able to show:

```text
ERC-8183 job: #732
Chain: BSC Testnet (97)
Execution authorization: Altana scoped session
Execution asset: CAKE2 -> WBNB
Target: Pancake V3 router
Allowed selector: exact swap selector
Session: independently verifiable when key identifier is available
Exact trade amount: only reported when supplied by concrete execution intent or independently observed chain evidence
```

The test case must not cause the AgentMarket core to gain a special `if agent == Grid` branch.

## Non-goals

This design does not remove ERC-8183 from Grid.

This design does not replace BNB Agent Studio or the BNB Agent SDK.

This design does not require every external agent to expose AgentMarket-specific HTTP routes.

This design does not assume AgentMarket knows how an agent is implemented internally.

This design does not treat authorization as proof that a trade actually happened; execution remains independently observed.
