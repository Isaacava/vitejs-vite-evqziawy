# Protocol-Aware Hiring

## Purpose

AgentMarket is a general BNB Chain agent marketplace. This feature makes the hiring flow protocol-aware without turning AgentMarket into a marketplace for a specific agent strategy.

The marketplace can discover agents with different communication, commerce and execution models, but it must only start a protocol-specific flow when the selected agent actually exposes the required protocol.

## Current hiring model

The current BSC Testnet hiring path uses ERC-8183 Agentic Commerce.

```text
User goal
  ↓
AgentMarket matching
  ↓
Protocol / execution profile
  ↓
Provider quote
  ↓
User accepts quote
  ↓
ERC-8183 preparation
  ↓
User wallet signs create/register/budget/approval/fund
  ↓
Real on-chain job ID
  ↓
Provider execution
  ↓
Submission/evidence capture
  ↓
Evaluator / settlement
```

## Protocol boundary

AgentMarket does not invent replacements for BNB protocols.

- ERC-8004: identity/discovery/reputation.
- ERC-8183: defined jobs, budget/escrow, deliverables and settlement.
- A2A/HTTP/MCP: communication/serving surfaces.
- x402/B402: payment rails for services that use them.
- EVM/TWAK/Altana: agent-side wallet/execution models.

A future A2A or x402 hire flow should be added as another protocol adapter rather than changing the ERC-8183 path.

## ERC-8183 gate

The Testnet quote endpoint is specifically an ERC-8183 commerce endpoint. It therefore requires an indexed, healthy `agent_endpoints` row with:

```text
protocol = erc8183
status = online
```

The endpoint is then negotiated and the returned quote is stored in `marketplace_quotes`.

This prevents AgentMarket from accidentally sending an ERC-8183 negotiation request to an arbitrary HTTP, A2A, MCP or x402 endpoint.

## Quote vs budget

A provider quote is the negotiated price/terms for the requested job.

The ERC-8183 budget is the accepted quote amount that is actually set and funded into the commerce escrow.

AgentMarket does not let the user replace the accepted provider quote with an unrelated budget during the Testnet execution flow.

## Wallet and execution boundary

The user wallet signs the marketplace's ERC-8183 client-side transactions.

That payment flow is separate from any autonomous DeFi execution authority an agent may have through its own supported wallet/session model.

AgentMarket must not claim that its application-level `session_permissions` table is an onchain agent session. Real Altana sessions or other wallet authorization mechanisms must be separately verified before being presented as active execution authority.

## General agent support

An agent may advertise different capabilities, for example:

```text
Agent A
  ERC-8183 + HTTP + EVM wallet

Agent B
  ERC-8183 + A2A + Altana

Agent C
  A2A + x402
```

AgentMarket should continue to list all of them. The marketplace chooses a compatible hiring/communication adapter based on verified capability data.

## Evidence

Once an ERC-8183 provider submits work, AgentMarket's existing submission-time capture and onchain hash verification remain responsible for evidence synchronization.

The marketplace does not rely on the provider staying online after submission.

## Security rules

1. Never call ERC-8183 negotiation unless the agent has an indexed ERC-8183 endpoint.
2. Never claim a wallet/session capability that is not declared or otherwise verified.
3. Never treat application-level permission rows as proof of onchain authority.
4. Never merge job payment budget with autonomous execution capital.
5. Never force every agent to use Altana, ERC-8004, ERC-8183, A2A or x402 when the agent does not support that protocol.

## Current implementation

- `server/_testnet/quotes.ts` requires an indexed `erc8183` endpoint for Testnet quote requests.
- `server/_testnet/match.ts` exposes protocol-aware execution/commerce/communication profile data.
- `src/ExecutionProfileSummary.tsx` renders the verified profile before hiring.
- `src/MarketplaceWorkspace.tsx` is the canonical Testnet hiring workspace and preserves the existing quote-gated ERC-8183 transaction flow.

## Remaining work

- Add protocol adapters for agents that use A2A/x402 rather than ERC-8183.
- Replace any application-only execution permission UX with real wallet/session integrations when an agent supports them.
- Mainnet support must use the BNB mainnet contract configuration and the same verification boundaries.
