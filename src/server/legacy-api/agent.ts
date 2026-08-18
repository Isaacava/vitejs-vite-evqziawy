import type { VercelRequest, VercelResponse } from "@vercel/node";
import { actions, heartbeat, riskRuntime, watch } from "../../server/agentHandlers.js";
import { history } from "../../server/agentEvidence.js";
import { riskPolicyHandler } from "../../server/riskGuardianPolicy.js";
import { proposalHandler } from "../../server/proposalGuard.js";
import { quoteHandler } from "../../server/quoteHandler.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = typeof req.query.route === "string" ? req.query.route : "";
  if (route === "watch") return watch(req, res);
  if (route === "history") return history(req, res);
  if (route === "actions") return actions(req, res);
  if (route === "risk-policy") return riskPolicyHandler(req, res);
  if (route === "proposal") return proposalHandler(req, res);
  if (route === "risk-runtime") return riskRuntime(req, res);
  if (route === "heartbeat") return heartbeat(req, res);
  if (route === "quote") return quoteHandler(req, res);
  return res.status(404).json({ error: "Unknown agent route" });
}
