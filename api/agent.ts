import type { VercelRequest, VercelResponse } from "@vercel/node";
import { actions, riskRuntime, watch } from "../src/server/agentHandlers.js";
import { history } from "../src/server/agentEvidence.js";
import { riskPolicyHandler } from "../src/server/riskGuardianPolicy.js";
import { proposalHandler } from "../src/server/proposalGuard.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = typeof req.query.route === "string" ? req.query.route : "";
  if (route === "watch") return watch(req, res);
  if (route === "history") return history(req, res);
  if (route === "actions") return actions(req, res);
  if (route === "risk-policy") return riskPolicyHandler(req, res);
  if (route === "proposal") return proposalHandler(req, res);
  if (route === "risk-runtime") return riskRuntime(req, res);
  return res.status(404).json({ error: "Unknown agent route" });
}
