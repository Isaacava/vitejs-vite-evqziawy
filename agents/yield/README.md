# First-party DeFi agents

Each agent is a standalone ERC-8183 Testnet provider with its own provider wallet, endpoint, local pending-deliverable store, and funded-job watcher.

The category runtime currently performs deterministic, evidence-bearing work from the position snapshot frozen into the funded job:

- Rebalancing: assesses an LP range and produces a hold/widen/move-range decision.
- Yield Optimisation: ranks the supplied live opportunity snapshot and selects the highest APR.
- Health Factor Guardian: classifies a lending position and produces a monitor/reduce-risk/protect-now decision.

The agents intentionally do not silently write to arbitrary DeFi contracts. Any state-changing action must be added behind an explicit contract allowlist and scoped execution session, following the security boundary already established by Grid.
