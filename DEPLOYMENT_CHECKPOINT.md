# AgentMarket Deployment Checkpoint

This file intentionally records the Testnet deployment checkpoint for the current `marketplace-testnet` branch.

Current release line: WalletConnect authentication + dashboard UX + Supabase server diagnostics + Vercel Testnet deployment verification.

Import-path stabilization: helper handlers were moved out of Vercel's function directory and their relative imports were corrected so the full TypeScript project can compile without restoring extra Vercel functions.

Quote normalization checkpoint: provider quote responses are normalized from supported envelope shapes before settlement-token price parsing.
