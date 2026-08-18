import type { VercelRequest, VercelResponse } from "@vercel/node";
import { dashboard, createMission } from "../../server/userHandlers.js";
import { evidence } from "../../server/evidenceHandlers.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = typeof req.query.route === "string" ? req.query.route : "dashboard";
  if (route === "dashboard") return dashboard(req, res);
  if (route === "missions") return createMission(req, res);
  if (route === "evidence") return evidence(req, res);
  return res.status(404).json({ error: "Unknown user workflow route" });
}
