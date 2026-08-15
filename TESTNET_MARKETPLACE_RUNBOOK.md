# AgentMarket — BSC Testnet Runbook

This branch is the complete development environment for AgentMarket. It is hard-locked to BSC Testnet (chain 97).

## Network

- BSC Testnet chain ID: 97
- ERC-8004 Identity Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ERC-8183 Commerce: `0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de`
- ERC-8183 EvaluatorRouter: `0xd7d36d66d2f1b608a0f943f722d27e3744f66f25`
- OptimisticPolicy: `0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6`

## Wallet setup

1. Switch the browser wallet to BSC Testnet (chain 97).
2. Get test BNB from the official BSC Testnet faucet.
3. Get the configured ERC-8183 Testnet payment token from its Testnet faucet/runtime.
4. Use a dedicated Testnet wallet. Never use a production wallet for this branch.

## Grid Agent setup

The Grid Agent must run with `NETWORK=bsc-testnet` and expose its ERC-8183 service endpoint publicly.

After the Grid Agent receives its Testnet ERC-8004 identity, sync it into the marketplace test inventory through the Testnet identity-sync endpoint. Its endpoint then has to pass the provider health check before it becomes hireable.

## End-to-end test

1. Open the AgentMarket Testnet preview.
2. Connect/sign in with the Testnet wallet.
3. Enter a mission such as `Run a controlled grid strategy`.
4. Confirm the result comes from the BSC Testnet matcher.
5. Confirm the Grid Agent shows Testnet identity and a healthy provider endpoint.
6. Create the mission/job.
7. Open the mission console and prepare the ERC-8183 job.
8. Execute `createJob` from the browser wallet.
9. Confirm the JobCreated event and chain job ID.
10. Execute register policy, set budget, approve the Testnet payment token if required, then fund.
11. Confirm the Commerce job reaches FUNDED on BSC Testnet.
12. Allow the Grid Agent service to observe and execute the funded job.
13. Confirm the provider deliverable/submission.
14. Open the evaluator and settle on BSC Testnet when the policy allows it.
15. Verify the marketplace only marks the job terminal after receipt verification and a fresh on-chain read.
16. Verify the Testnet transaction hash appears on the mission history and the Testnet reputation/evidence is recorded.

## Pass criteria before Mainnet promotion

- No Testnet screen calls the production ERC-8183 route.
- No Testnet transaction targets a Mainnet contract.
- The Grid Agent executes a real funded Testnet job.
- Settlement is verified from the Testnet chain, not from UI state.
- Provider readiness changes correctly between offline/degraded/online.
- Marketplace matching returns only Testnet agents in this environment.
- Wallet prompts always show BSC Testnet.
- A failed/reverted transaction never advances marketplace state.

Only after the full checklist passes should this architecture be promoted to the Mainnet production branch.
