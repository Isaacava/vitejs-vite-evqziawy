# AgentMarket Grid Agent

This is the single first-party agent used to prove the marketplace lifecycle end to end.

## Environment boundary

The Grid Agent is **BSC Testnet only**. It must never share the production marketplace's BSC Mainnet contracts, payment token, provider endpoint, database records, or job IDs.

- Grid Agent test runtime: **BSC Testnet, chain ID 97**.
- Production AgentMarket: **BSC Mainnet, chain ID 56**.
- Testnet jobs are test jobs only and must not be reused or replayed against mainnet.
- Testnet provider URLs should live in a dedicated test environment/service deployment.
- Mainnet AgentMarket readiness must ignore testnet endpoint health records.

BNB Chain documents BSC Testnet as chain ID 97 and BSC Mainnet as chain ID 56. citeturn307661search0turn307661search1

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

The Grid Agent should be deployed separately from the Vite production marketplace. Use BSC Testnet while developing and validating the integration.

```text
NETWORK=bsc-testnet
WALLET_PASSWORD=<testnet-agent-wallet-password>
PRIVATE_KEY=<testnet-agent-wallet-key; first run only>
ERC8183_AGENT_URL=https://<testnet-service-host>/erc8183
ERC8183_SERVICE_PRICE=<quoted minimum in raw test settlement-token units>
```

Before the test deployment, configure a real `max_price`/service price and a public **testnet** service URL, then register/update the ERC-8004 endpoint for that testnet identity.

The Grid Agent should only be marked **READY TO HIRE in the test environment** after its testnet service endpoint is healthy and the provider can negotiate/accept the testnet ERC-8183 job flow.
