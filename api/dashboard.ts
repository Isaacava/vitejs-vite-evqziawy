import type { VercelRequest, VercelResponse } from "@vercel/node";
import { dashboard, createMission } from "../src/server/userHandlers.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = typeof req.query.route === "string" ? req.query.route : "dashboard";
  if (route === "dashboard") return dashboard(req, res);
  if (route === "missions") return createMission(req, res);
  return res.status(404).json({ error: "Unknown user workflow route" });
}
