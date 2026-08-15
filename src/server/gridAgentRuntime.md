# Grid Agent Runtime

The Grid runtime is proposal-first and non-custodial.

State flow:

`planned → approved OR awaiting_user OR blocked → ready_for_wallet → executing → submitted → verified`

Rules:

- `blocked` can never reach wallet execution.
- `awaiting_user` can never reach wallet execution until an explicit approval is represented by a fresh Risk Guardian decision.
- `ready_for_wallet` requires an `approve` decision.
- `executing` requires wallet preflight to have passed.
- `submitted` requires a valid 32-byte transaction hash.
- `verified` requires a submitted transaction; the real implementation must additionally re-read the BSC Testnet receipt and relevant contract state before marking it verified.
- The runtime never stores or receives the user's private key.
- This module does not send transactions itself; the browser wallet/session executor remains the signing boundary.
