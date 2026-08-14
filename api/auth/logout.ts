import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serverClient } from "../_auth.js";

function sessionId(req: VercelRequest) {
  const header = typeof req.headers.cookie === "string" ? req.headers.cookie : "";
  const match = header.match(/(?:^|;\s*)agentmarket_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const id = sessionId(req);
  if (id) {
    const supabase = serverClient();
    await supabase.from("user_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  }

  res.setHeader("Set-Cookie", "agentmarket_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return res.status(200).json({ ok: true });
}
