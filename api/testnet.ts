import type { VercelRequest, VercelResponse } from "@vercel/node";

import testnetErc8183Settlement from "./_testnet/erc8183-settlement.js";
import testnetErc8183 from "./_testnet/erc8183.js";
import testnetJobStatus from "./_testnet/job-status.js";
import testnetJobsHistory from "./_testnet/jobs-history.js";
import testnetMatch from "./_testnet/match.js";
import testnetPrepareQuote from "./_testnet/prepare-quote.js";
import testnetProviders from "./_testnet/providers.js";
import testnetQuotes from "./_testnet/quotes.js";
import testnetRecoverJob from "./_testnet/recover-job.js";
import testnetSettlePlan from "./_testnet/settle-plan.js";
import testnetSyncAgent from "./_testnet/sync-agent.js";
import testnetTransactionPreflight from "./_testnet/transaction-preflight.js";

const handlers: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  "erc8183-settlement": testnetErc8183Settlement,
  "erc8183": testnetErc8183,
  "job-status": testnetJobStatus,
  "jobs-history": testnetJobsHistory,
  match: testnetMatch,
  "prepare-quote": testnetPrepareQuote,
  providers: testnetProviders,
  quotes: testnetQuotes,
  "recover-job": testnetRecoverJob,
  "settle-plan": testnetSettlePlan,
  "sync-agent": testnetSyncAgent,
  "transaction-preflight": testnetTransactionPreflight,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = typeof req.query?.route === "string" ? req.query.route : "";
  const target = handlers[route];
  if (!target) return res.status(404).json({ error: "Unknown Testnet API route" });
  return await target(req, res);
}
