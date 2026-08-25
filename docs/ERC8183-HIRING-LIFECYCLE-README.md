# ERC-8183 Hiring Lifecycle

## Purpose

AgentMarket's hackathon-critical commerce path is ERC-8183 hiring on BSC Testnet.

This document defines what happens after a user selects an agent and prevents the marketplace from treating Supabase workflow state as proof of onchain commerce state.

## Core flow

```text
User goal
  ↓
AgentMarket match
  ↓
ERC-8183 provider endpoint check
  ↓
Provider negotiation / quote
  ↓
User accepts quote
  ↓
AgentMarket prepares ERC-8183 transactions
  ↓
User signs createJob
  ↓
User signs registerJob / policy setup
  ↓
User signs setBudget
  ↓
User approves payment token only when required
  ↓
User funds job
  ↓
BSC Testnet ERC-8183 state becomes FUNDED
  ↓
Provider performs work
  ↓
Provider submits deliverable
  ↓
AgentMarket captures/archive evidence
  ↓
Onchain deliverable hash is independently verified
  ↓
ERC-8183 evaluation / dispute window
  ↓
Settlement, rejection, or expiry
```

## Quote vs budget

A provider quote is the negotiated price and terms for the requested work. The ERC-8183 budget is the amount the client actually sets and escrows for the job.

AgentMarket must carry the accepted quote forward as the job budget and must not silently replace it with a separate user-entered amount.

## Readiness rules

The ERC-8183 hiring path is enabled only when:

1. The agent is explicitly tagged for the isolated BSC Testnet environment.
2. The agent has a healthy indexed endpoint whose protocol is `erc8183`.
3. The provider can negotiate the requested task.
4. The provider quote is valid and not expired.
5. The authenticated client accepts the quote.
6. The preparation endpoint validates the accepted quote before transaction creation.

A discoverable agent without these conditions remains discoverable but is not presented as hireable through the hackathon ERC-8183 path.

## Onchain authority

BSC Testnet contract state is authoritative for:

- job ID
- client
- provider
- evaluator
- budget
- expiry
- job status
- submitted timestamp
- deliverable hash

Supabase is the marketplace workflow and evidence layer. It must not override an authoritative chain state.

## Evidence lifecycle

At submission time AgentMarket can capture the provider response and store it in `erc8183_deliverable_archives`.

The chain only anchors the deliverable hash. AgentMarket independently hashes the captured bytes and compares them with the onchain deliverable hash.

Therefore the marketplace can show:

```text
SUBMITTED / CHAIN VERIFIED
```

only when both the chain submission and independent archive verification exist.

Otherwise it should distinguish:

```text
SUBMITTED / ON-CHAIN, ARCHIVE NOT VERIFIED
```

or

```text
SUBMITTED / NOT ON-CHAIN
```

## Lifecycle status synchronization

The Testnet job-status endpoint reads the current ERC-8183 job directly from BSC Testnet and synchronizes the marketplace job record with:

- `chain_job_id`
- `chain_status`
- `submitted_at`
- `terminal_at`

It also returns separate evidence information describing whether AgentMarket has a captured and verified deliverable archive.

## Settlement boundary

AgentMarket does not invent its own settlement rules. Settlement follows the configured ERC-8183 policy/evaluator lifecycle already used by the Testnet deployment.

Job payment and any separate execution/trading capital are distinct concepts. ERC-8183 job funding does not automatically grant an external agent authority over the user's personal wallet.

## General marketplace boundary

AgentMarket connects users to agents. It does not implement the agent's strategy.

A grid strategy, yield strategy, rebalancing strategy, research task, or other capability remains inside the provider agent.

The marketplace's ERC-8183 responsibility is discovery, negotiation, hiring, funding, lifecycle visibility, evidence capture, and settlement coordination.

## Status

**Implemented:** ERC-8183 quote-gated hiring, transaction preparation, sequential wallet signing, onchain receipt synchronization, provider submission capture, evidence verification, and lifecycle status synchronization.

**Next:** prove the complete Testnet lifecycle with a fresh hired job from quote through provider submission and final settlement, then harden the same path for BSC Mainnet.