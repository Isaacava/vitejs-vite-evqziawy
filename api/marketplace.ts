import type { VercelRequest, VercelResponse } from "@vercel/node";

import agentJobs from "./_agent-jobs.js";
import erc8183Settlement from "./_erc8183-settlement.js";
import erc8183Prepare from "./erc8183/_prepare.js";
import match from "./_match.js";
import sessionPermissions from "./_session-permissions.js";

const handlers: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  "agent-jobs": agentJobs,
  "erc8183-settlement": erc8183Settlement,
  "erc8183-prepare": erc8183Prepare,
  match,
  "session-permissions": sessionPermissions,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = typeof req.query?.route === "string" ? req.query.route : "";
  const target = handlers[route];
  if (!target) return res.status(404).json({ error: "Unknown marketplace API route" });
  return await target(req, res);
}
