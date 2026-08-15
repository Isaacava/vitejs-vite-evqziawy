# AgentMarket Grid Agent

This is the single first-party agent used to prove the marketplace lifecycle end to end.

## Scope

The first test version is **strategy-only**:

- accepts a funded ERC-8183 job;
- validates the grid parameters;
- produces a deterministic grid strategy deliverable;
- submits the deliverable through the BNB Agent SDK service layer;
- does not custody user private keys;
- does not execute trades or move user funds.

This is intentional. It lets AgentMarket prove discovery → provider readiness → quote → ERC-8183 job → funded job → agent execution → deliverable → evaluation/settlement before adding a real DeFi execution adapter.

## Current files

- `app/agent/main.py` — Grid strategy logic and deliverable generation.
- `app/service/main.py` — public ERC-8183 service adapter using `bnbagent[server]`.

## BNB Agent Studio path

The official BNB Agent Studio quickstart uses a two-layer seller (agent + service) and the ERC-8183 service watches for funded jobs before invoking the agent logic. This repository mirrors that boundary for the first-party Grid test agent.

## Configuration

The agent should be created and run separately from the Vite marketplace. Use BSC testnet while developing the integration. Production AgentMarket defaults to BSC mainnet through the frontend network configuration.

Recommended runtime environment:

```text
NETWORK=bsc-testnet
WALLET_PASSWORD=<agent wallet password>
PRIVATE_KEY=<agent wallet key; first run only>
ERC8183_AGENT_URL=https://<public-service-host>/erc8183
ERC8183_SERVICE_PRICE=<quoted minimum in raw settlement-token units>
```

Before deployment, configure a real `max_price`/service price and a public service URL, then register/update the ERC-8004 endpoint for discovery.

The Grid Agent should only be marked **READY TO HIRE** in AgentMarket after its service endpoint is healthy and the provider can negotiate/accept the ERC-8183 job flow.
