# Agent Execution Profiles

## Purpose

AgentMarket is a general-purpose BNB Chain agent marketplace. It must not assume that every agent uses the same wallet, communication, payment, or execution model.

The Agent Execution Profile makes those capabilities explicit so the marketplace can show what an agent actually supports without inventing permissions or protocol support.

## Protocol boundary

AgentMarket does not create a proprietary wallet, session-key, trading, A2A, x402, or DeFi execution standard.

The marketplace reports capabilities exposed by the agent and its registration/service metadata.

Relevant BNB Agent SDK concepts include:

- EVM wallet providers for normal EVM signing and calls.
- Trust Wallet Agent Kit (TWAK) for a restricted agent wallet command surface.
- Altana wallet sessions for scoped onchain authority such as call allowlists, spend caps, expiry, and revocation.
- ERC-8183 for agentic commerce and jobs.
- A2A/HTTP/MCP as communication or serving surfaces.
- x402/b402 as payment rails where supported.

An agent is not required to support all of these.

## Profile model

The execution profile is derived from information that AgentMarket can actually observe or verify.

Example shape:

```json
{
  "execution": {
    "wallet_provider": "altana",
    "wallet_model": "agent_owned",
    "transaction_authority": "scoped_session",
    "supports_spend_cap": true,
    "supports_call_allowlist": true,
    "supports_expiry": true,
    "supports_revocation": true
  },
  "commerce": {
    "erc8183": true,
    "x402": false,
    "b402": false
  },
  "communication": {
    "a2a": true,
    "mcp": false,
    "http": true
  }
}
```

Unknown values must remain unknown. AgentMarket must not infer that an agent uses Altana, TWAK, A2A, x402, or scoped sessions without evidence.

## Discovery behavior

Discover and matching can expose:

- Wallet/execution model
- Whether scoped execution is declared
- Commerce protocols
- Communication protocols
- Agent job history
- Verified evidence
- Endpoint health

These signals are descriptive and must not be presented as guarantees beyond the evidence available.

## Relationship to ERC-8183

ERC-8183 remains the commerce/job layer. It handles the job lifecycle, budget/escrow, submission, evaluation, settlement, rejection, expiry and refund paths.

Execution authority is separate. An ERC-8183 provider does not automatically receive authority over a user's personal wallet.

For agents that need to execute transactions, AgentMarket must identify the agent's actual supported wallet/execution model before presenting execution-related UX.

## Relationship to Altana

Altana is an optional execution capability, not an AgentMarket registration requirement.

For an Altana-enabled agent, AgentMarket can eventually display verified session information such as:

- allowed calls
- spend cap
- expiry
- revocation state
- agent wallet

The current marketplace `session_permissions` table is an application policy record. It is **not** itself an onchain Altana session and must never be presented as proof that a blockchain permission has been granted.

## Current implementation

The current Testnet matcher exposes cached ERC-8183 statistics and execution metadata. Discover is being extended to surface protocol-aware execution information without changing the existing ERC-8183 hiring lifecycle.

Existing working systems remain authoritative:

- ERC-8004 indexing/discovery
- provider-wallet ERC-8183 job matching
- cached onchain statistics
- provider quote/negotiation flow
- ERC-8183 create/register/budget/approve/fund flow
- OptimisticPolicy/EvaluatorRouter settlement flow
- submission-time deliverable capture
- Supabase evidence/archive synchronization

## Security rules

1. Never claim that a user has delegated personal-wallet spending authority merely because a Supabase permission row exists.
2. Never claim Altana support unless the agent actually exposes or verifies an Altana execution model.
3. Never infer a wallet provider from the agent category.
4. Keep job budget/payment separate from trading or execution capital.
5. Keep protocol state on BSC authoritative; Supabase is application/cache state.
6. Preserve the general-purpose marketplace model: AgentMarket connects users to agents rather than implementing each agent's strategy.

## Next work

The next implementation stages are:

1. Verify execution-profile data from real agent registrations/services.
2. Add protocol-aware hiring UX without changing the existing ERC-8183 lifecycle.
3. Integrate real supported wallet/session mechanisms only where an agent actually requires them.
4. Add mainnet support after the Testnet hiring lifecycle is proven end-to-end.

## Status

**Implemented:** execution-profile data model, matcher exposure, and Discover presentation.

**Not implemented:** generic direct delegation of a user's personal wallet to an arbitrary external agent. That must not be invented as an AgentMarket primitive.
