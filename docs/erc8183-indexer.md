# ERC-8183 Testnet Indexer

AgentMarket indexes the BSC Testnet ERC-8183 Commerce contract with a durable block cursor and replay-safe event ledger. The indexer is exposed at `/api/erc8183-indexer` and scheduled every five minutes through Vercel Cron. Chain state remains authoritative; Supabase stores the indexed events and application aggregates.
