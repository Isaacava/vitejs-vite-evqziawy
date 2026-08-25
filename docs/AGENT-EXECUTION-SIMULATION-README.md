# Agent Execution Simulation

## Purpose

AgentMarket needs to model the lifecycle of an agent that may eventually operate execution capital without prematurely introducing a custom custody or wallet-delegation system.

This feature provides a **non-custodial Testnet simulation only**.

It does not:

- sign blockchain transactions;
- request ERC-20 approvals;
- transfer tokens;
- call PancakeSwap or another DEX;
- accept a user's personal wallet private key;
- represent a real Altana session;
- represent real trading performance.

## Why this exists

The current first-party Grid Agent is intentionally strategy-only. Its ERC-8183 provider wallet is used for marketplace/job operations, while the strategy deliverable explicitly does not trade or move user funds.

The simulator lets AgentMarket exercise the future execution-capital state model safely:

```text
requested capital
      ↓
prepared
      ↓
running
      ↓
P&L updates
      ↓
finished
      ↓
starting value / ending value / P&L evidence
```

## State model

Simulation output includes:

- requested capital
- deployed capital
- ending value
- realized P&L
- lifecycle events
- custody = `none`
- asset transfer = `false`
- transactions = `[]`

No simulated value is represented as an onchain balance.

## Guardrails

Default simulator limits are intentionally small:

- maximum simulated capital: `1000`
- maximum duration: `86400` seconds

These are application guardrails for the simulator, not wallet permissions and not trading limits.

## Relationship to ERC-8183

The simulator is separate from the ERC-8183 job budget.

```text
ERC-8183 budget
= payment for the hired service/job

Execution-capital simulation
= future execution-capital state model only
```

The simulator must never be treated as an ERC-8183 escrow balance or as proof that a real execution-capital transfer occurred.

## Relationship to wallet/session systems

A future real execution adapter must use an existing supported wallet/authorization model rather than a custom AgentMarket delegation protocol.

Possible official BNB Agent SDK wallet models include EVM wallet providers, TWAK, and Altana sessions. Their capabilities must be verified before a real adapter is enabled.

## Current status

**Implemented:** in-memory Testnet execution simulation model.

**Not implemented:** real execution-capital transfer, real DEX trading, user-wallet delegation, or real trading P&L.
