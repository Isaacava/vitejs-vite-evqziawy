import type { VercelRequest, VercelResponse } from "@vercel/node";

import testnetErc8183Settlement from "../server/_testnet/erc8183-settlement.js";
import testnetErc8183 from "../server/_testnet/erc8183.js";
import testnetJobStatus from "../server/_testnet/job-status.js";
import testnetJobsHistory from "../server/_testnet/jobs-history.js";
import testnetMatch from "../server/_testnet/match.js";
import testnetPrepareQuote from "../server/_testnet/prepare-quote.js";
import testnetProviders from "../server/_testnet/providers.js";
import testnetQuotes from "../server/_testnet/quotes.js";
import testnetRecoverJob from "../server/_testnet/recover-job.js";
import testnetSettlePlan from "../server/_testnet/settle-plan.js";
import testnetSyncAgent from "../server/_testnet/sync-agent.js";
import testnetTransactionPreflight from "../server/_testnet/transaction-preflight.js";

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
