# Execution Capital Reconciliation

## Current test state

Grid job #734 proved that the agent-owned execution path is active: Grid received the funded ERC-8183 job, ran its own execution path, detected that the authorized Altana execution wallet had zero CAKE2, and submitted a failure deliverable instead of claiming a trade occurred.

## Correct trust boundaries

- ERC-8183 remains the job, payment, and submission lifecycle.
- Agent capability metadata is a declaration and is not an authorization grant.
- The user's Altana session is the execution authorization boundary.
- The exact authorized execution wallet must be the wallet used by Grid for the trade.
- AgentMarket must never silently substitute another wallet.
- Grid performs its own execution preparation and transaction submission.
- AgentMarket independently observes and verifies execution evidence.

## Reconciled #734 metadata

The stored authorization record was missing some non-secret scope fields even though the stored evidence contained them. The request record was reconciled with:

- CAKE2 execution token decimals: 18
- observed 24-hour session expiry from the stored authorization evidence
- declared execution target: the configured Pancake Testnet router

These fields are treated as evidence/metadata, not as a replacement for on-chain authorization verification.

## Funding readiness

Authorization and token funding are separate states. An authorized session does not imply that the execution wallet already owns the requested token.

AgentMarket now checks the authorized wallet's live ERC-20 balance and router allowance for authorized/active execution-capital requests. When the wallet is underfunded, the Mission Console can offer a compact repair action that transfers only the missing amount from the user's connected wallet and restores the required allowance. The transfer requires the user's normal wallet signature; AgentMarket does not silently sign a transfer.

When restoring allowance, the app recovers the existing Altana wallet signer only when needed. It does not create a new session or broaden permissions.

## Grid runtime

Grid's `main` deployment is the first-party BNB Agent Studio test agent. Its funded-job watcher invokes the Grid-owned execution bridge, which performs its own Testnet preparation, uses its existing Altana scoped session, observes its own transaction receipt, and embeds evidence in the ERC-8183 deliverable.

Grid's execution-capability declaration now matches that real runtime: BSC Testnet, Altana scoped-session execution, CAKE2 support, and agent-owned trading. The declaration itself grants no user permission; the Altana session remains authoritative.

The AgentMarket Mission Console remains observation/evidence only and does not execute Grid trades.
