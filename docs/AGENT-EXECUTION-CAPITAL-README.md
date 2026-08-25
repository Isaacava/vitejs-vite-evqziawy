# Agent Execution Capital

## Purpose

This feature adds a protocol-aware execution-capital disclosure layer for agents that may eventually perform autonomous DeFi actions.

The first-party Grid Agent remains **BSC Testnet-only and strategy-only**. The current implementation does not accept, custody, withdraw, or trade user execution capital.

The feature therefore starts with accurate capability discovery rather than a custom custody or wallet-delegation system.

## Why this is separate from ERC-8183

ERC-8183 handles the commerce/job payment lifecycle:

```text
quote → accepted quote → job → budget → fund → deliverable → evaluation → settlement
```

Execution capital is separate:

```text
execution-capital
≠
ERC-8183 job budget
```

A marketplace service fee is not automatically trading capital.

## Current Grid Agent model

The Grid Agent currently uses the BNB Agent SDK `EVMWalletProvider` for its provider wallet and ERC-8183 operations.

Its current runtime is explicitly strategy-only:

- no user trading funds;
- no direct personal-wallet delegation;
- no autonomous DeFi transactions;
- no deposit/withdrawal flow;
- no claim that execution capital is authorized.

## Live capability endpoint

The Grid service exposes:

```text
GET /erc8183/execution-capital
```

The endpoint reports:

- network and chain ID;
- wallet provider/model;
- transaction-authority model;
- whether execution capital is enabled;
- deposit/withdrawal support;
- trading support;
- supported assets;
- maximum capital, if any;
- authorization model.

The current response reports `enabled=false` and `strategy_only`.

## AgentMarket indexing

The existing endpoint-health Cron calls the execution-capital endpoint for healthy ERC-8183 providers and stores the returned profile in `agent_endpoints.metadata` under:

```text
reported_execution_capital
```

The stored value is explicitly marked:

```text
reported_execution_capital_source = live_agent_endpoint
reported_execution_capital_verified = false
```

This is intentional. A live HTTP response is evidence of what the provider reports, not proof of an onchain permission.

## Security boundary

AgentMarket must never:

1. treat a Supabase profile as an onchain wallet authorization;
2. imply that an agent can spend a user's personal wallet unless a real supported authorization mechanism exists;
3. combine an ERC-8183 service budget with execution capital;
4. expose a generic transfer/delegation mechanism that is not part of the supported BNB wallet architecture;
5. label a capability as verified merely because an HTTP endpoint reports it.

## Planned execution phase

A real execution-capital flow requires all of the following before it is enabled:

1. a supported wallet/execution architecture;
2. an explicit authorization model;
3. a real Testnet DeFi execution adapter;
4. capital accounting for deposits, deployed value, withdrawals, and ending assets;
5. an auditable strategy/session lifecycle;
6. clear handling of gains, losses, open positions, and session expiry.

Until those pieces exist, AgentMarket only displays the capability profile.

## Hackathon relationship

This is a supporting capability for the ERC-8183-first marketplace. The main hiring path remains:

```text
Discover → Quote → Accept → Prepare → Create → Register → Budget → Fund → Submit → Verify → Settle
```

Execution capital must not replace ERC-8183 job commerce.

## Status

**Implemented:** Grid capability model, live capability endpoint, Cron discovery, Supabase endpoint metadata capture.

**Next:** surface the reported profile in the hiring UI; then implement a real Testnet execution adapter only after the wallet/authorization model is verified.
