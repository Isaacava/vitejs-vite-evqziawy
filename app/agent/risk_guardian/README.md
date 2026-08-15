# Risk Guardian

Risk Guardian is the policy gate for first-party DeFi agents. It evaluates an action proposal against a user-scoped policy and returns one of three outcomes:

- `approve` — the proposal is inside the configured guardrails.
- `block` — a hard constraint was violated and the action must not proceed.
- `user_approval` — the proposal is outside the automatic approval envelope and needs explicit user confirmation.

## Non-custodial boundary

Risk Guardian never receives a user's private key and never signs on behalf of the user. A decision is only a policy result. A later execution layer must enforce the decision and obtain whatever wallet/session authorization is required.

## Proposal inputs

`token`, `protocol`, `notional`, `risk_level`, `slippage_bps`, and `expires_at`.

## Policy inputs

`max_spend`, `max_slippage_bps`, `allowed_tokens`, `allowed_protocols`, and whether expiry is required.

## BNB Agent Studio integration

The policy module is runtime-agnostic so it can be used from the BNB Agent SDK/Studio ERC-8183 server callback. The production agent should run on BSC Testnet during the hackathon and expose a health endpoint before it is indexed by AgentMarket.

See `policy.py` for the deterministic evaluator.
