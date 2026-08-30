# AgentMarket Testnet End-to-End Runbook

This runbook is the execution checklist for the first real BSC Testnet marketplace run. It is intentionally scoped to `marketplace-testnet` and must not be used as a Mainnet configuration guide.

## Environment lock

- Network: BSC Testnet
- Chain ID: 97
- Provider: Grid Agent Testnet deployment
- Payment: Testnet settlement asset resolved by ERC-8183 Commerce
- Contracts: Testnet ERC-8183 Commerce / Router / OptimisticPolicy / ERC-8004 registry
- Mainnet state, balances, jobs and provider records are not shared with this run.

## Preflight

1. Open `/testnet`.
2. Connect a wallet and verify chain 97.
3. Confirm the Grid Agent appears in provider readiness and is not revoked.
4. Confirm the provider health state is online/recent.
5. Create a Testnet mission.
6. Match the Grid Agent.
7. Request the provider quote.
8. Confirm the quote is Testnet-only, signed/identifiable, unexpired and linked to the selected provider.
9. Accept the quote.
10. Open `/testnet/preflight` with the mission, quote and marketplace job IDs.
11. Do not start wallet execution until all required checks are green.

## Wallet lifecycle

The execution sequence must remain receipt-gated:

1. `createJob`
2. `registerJob`
3. `setBudget`
4. `approve` only if the allowance is insufficient
5. `fund`

After every transaction, AgentMarket must persist the receipt and verified chain job ID before enabling the next dependent step.

## Provider lifecycle

After `fund`:

1. The Grid Agent Testnet service watcher detects the funded job.
2. The service verifies the job is assigned to the provider and the budget meets its configured service price.
3. The agent executes the requested Grid strategy.
4. The provider stores the deliverable and submits its hash on-chain.
5. AgentMarket reads the real ERC-8183 job state and displays `SUBMITTED`.

The BNB Agent SDK documents the funded-job watcher and provider callback model, with settlement handled separately. See the official SDK quickstart for the current implementation model.

## Settlement lifecycle

After submission and the dispute window:

1. AgentMarket requests a Testnet settlement plan.
2. The server simulates `Router.settle(jobId, "0x")` for the authenticated wallet.
3. The user signs the exact simulated transaction.
4. AgentMarket verifies the successful receipt and re-reads the on-chain job.
5. The marketplace records the terminal result and payment state.

## Dispute / refund validation

Run these as separate Testnet QA cases:

### Dispute path

- Fund the job.
- Allow the provider to submit.
- Client raises a dispute within the configured window.
- Eligible voters resolve the dispute.
- Settlement applies the resulting verdict.

### Expiry/refund path

- Fund a job that does not settle before expiry.
- Verify the job becomes eligible for `claimRefund`.
- Submit the refund transaction.
- Verify the client refund and terminal job state.

## Recovery tests

For at least one live job, deliberately reload/close the browser after:

- `createJob`
- `registerJob`
- `setBudget`
- `approve`
- `fund`
- provider submission

Open `/testnet/jobs` or `/testnet/recover` and verify the current on-chain state determines the next action instead of restarting the lifecycle.

## Evidence to record

For each live run, record:

- Testnet wallet address
- mission ID
- quote ID
- marketplace job ID
- ERC-8183 chain job ID
- transaction hashes for every wallet step
- provider submission/deliverable hash
- settlement/dispute/refund transaction hash
- final on-chain status
- any recovery event

Do not store private keys or wallet passwords in the repository or logs.

## Exit criteria for Testnet completion

Testnet is considered ready for Mainnet promotion only when:

- happy-path lifecycle succeeds end-to-end;
- at least one recovery/reload scenario succeeds;
- dispute path is verified;
- expiry/refund path is verified;
- provider health/readiness works;
- CI remains green;
- Testnet isolation audit remains green; and
- no unresolved Vercel application build/runtime errors remain.

Only after these criteria are satisfied should the Mainnet promotion plan be started. Mainnet receives separate production contracts, provider configuration, balances, jobs and state.
