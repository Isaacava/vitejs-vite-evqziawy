import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAddress, verifyMessage, type Hex } from "viem";
import { serverClient } from "../_auth.js";

function cookie(value: string, maxAge = 60 * 60 * 24 * 7) {
  return `agentmarket_session=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const sessionId = typeof req.body?.session_id === "string" ? req.body.session_id.trim() : "";
    const rawWallet = typeof req.body?.wallet === "string" ? req.body.wallet.trim() : "";
    const signature = typeof req.body?.signature === "string" ? req.body.signature.trim() : "";
    if (!sessionId || !rawWallet || !signature) return res.status(400).json({ error: "session_id, wallet and signature are required" });

    const wallet = getAddress(rawWallet);
    const supabase = serverClient();
    const { data: session, error } = await supabase
      .from("user_sessions")
      .select("id,user_id,wallet_address,nonce,expires_at,verified_at,revoked_at")
      .eq("id", sessionId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
      return res.status(401).json({ error: "Sign-in challenge is invalid or expired" });
    }
    if (session.wallet_address.toLowerCase() !== wallet.toLowerCase()) return res.status(401).json({ error: "Wallet does not match the sign-in challenge" });

    const message = [
      "AgentMarket wallet sign-in",
      "",
      `Wallet: ${wallet}`,
      "Network: BNB Smart Chain",
      `Nonce: ${session.nonce}`,
      "",
      "This signature authenticates your AgentMarket session. It does not authorize a transaction or transfer funds.",
    ].join("\n");

    const verified = await verifyMessage({ address: wallet, message, signature: signature as Hex });
    if (!verified) return res.status(401).json({ error: "Wallet signature verification failed" });

    const now = new Date().toISOString();
    await supabase.from("user_sessions").update({ verified_at: now, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() }).eq("id", session.id);

    const { data: user } = await supabase
      .from("users")
      .select("id,wallet_address,display_name,avatar_url,created_at,updated_at")
      .eq("id", session.user_id)
      .single();

    res.setHeader("Set-Cookie", cookie(session.id));
    return res.status(200).json({ ok: true, user });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to verify wallet signature" });
  }
}
