import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAddress } from "viem";
import { serverClient } from "../_auth.js";
import { randomUUID } from "node:crypto";

function isEvmAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rawWallet = req.body?.wallet;
    if (!isEvmAddress(rawWallet)) return res.status(400).json({ error: "A valid EVM wallet address is required" });

    const wallet = getAddress(rawWallet);
    const supabase = serverClient();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    const { data: user, error: userError } = await supabase
      .from("users")
      .upsert({ wallet_address: wallet, updated_at: now.toISOString() }, { onConflict: "wallet_address" })
      .select("id,wallet_address,display_name,avatar_url")
      .single();
    if (userError) throw new Error(userError.message);

    const sessionId = randomUUID();
    const nonce = randomUUID().replace(/-/g, "");
    const { error: sessionError } = await supabase.from("user_sessions").insert({
      id: sessionId,
      user_id: user.id,
      wallet_address: wallet,
      nonce,
      expires_at: expiresAt.toISOString(),
    });
    if (sessionError) throw new Error(sessionError.message);

    const message = [
      "AgentMarket wallet sign-in",
      "",
      `Wallet: ${wallet}`,
      "Network: BNB Smart Chain",
      `Nonce: ${nonce}`,
      `Issued: ${now.toISOString()}`,
      `Expires: ${expiresAt.toISOString()}`,
      "",
      "This signature authenticates your AgentMarket session. It does not authorize a transaction or transfer funds.",
    ].join("\n");

    return res.status(200).json({ session_id: sessionId, message, expires_at: expiresAt.toISOString() });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create sign-in challenge" });
  }
}
