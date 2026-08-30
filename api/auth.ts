import type { VercelRequest, VercelResponse } from "@vercel/node";
import { logout, me, nonce, verify } from "../src/server/authHandlers.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === "string" ? req.query.action : "";
  if (action === "nonce") return nonce(req, res);
  if (action === "verify") return verify(req, res);
  if (action === "me") return me(req, res);
  if (action === "logout") return logout(req, res);
  return res.status(404).json({ error: "Unknown auth action" });
}
