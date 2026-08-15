import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { getAddress, verifyMessage, type Hex } from "viem";
import { randomUUID } from "node:crypto";

export function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function parseCookies(req: VercelRequest) {
  const header = typeof req.headers.cookie === "string" ? req.headers.cookie : "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, ...value]) => [key, decodeURIComponent(value.join("="))]),
  );
}

function buildSignInMessage(wallet: string, nonce: string) {
  return [
    "AgentMarket wallet sign-in",
    "",
    `Wallet: ${wallet}`,
    "Network: BNB Smart Chain",
    `Nonce: ${nonce}`,
    "",
    "This signature authenticates your AgentMarket session. It does not authorize a transaction or transfer funds.",
  ].join("\n");
}

export async function getAuthenticatedUser(req: VercelRequest) {
  const sessionId = parseCookies(req).agentmarket_session;
  if (!sessionId) return null;
  const supabase = serverClient();
  const { data: session, error } = await supabase
    .from("user_sessions")
    .select("id,user_id,wallet_address,expires_at,verified_at,revoked_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (
    error ||
    !session ||
    session.revoked_at ||
    !session.verified_at ||
    new Date(session.expires_at).getTime() <= Date.now()
  ) {
    return null;
  }
  const { data: user } = await supabase
    .from("users")
    .select("id,wallet_address,display_name,avatar_url,created_at,updated_at")
    .eq("id", session.user_id)
    .maybeSingle();
  return user ? { user, session } : null;
}

export async function nonce(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const rawWallet = req.body?.wallet;
    if (typeof rawWallet !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(rawWallet)) {
      return res.status(400).json({ error: "A valid EVM wallet address is required" });
    }
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
    const nonceValue = randomUUID().replace(/-/g, "");
    const message = buildSignInMessage(wallet, nonceValue);

    const { error: sessionError } = await supabase.from("user_sessions").insert({
      id: sessionId,
      user_id: user.id,
      wallet_address: wallet,
      nonce: nonceValue,
      expires_at: expiresAt.toISOString(),
    });
    if (sessionError) throw new Error(sessionError.message);

    return res.status(200).json({
      session_id: sessionId,
      message,
      expires_at: expiresAt.toISOString(),
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create sign-in challenge" });
  }
}

export async function verify(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const sessionId = typeof req.body?.session_id === "string" ? req.body.session_id.trim() : "";
    const rawWallet = typeof req.body?.wallet === "string" ? req.body.wallet.trim() : "";
    const signature = typeof req.body?.signature === "string" ? req.body.signature.trim() : "";
    if (!sessionId || !rawWallet || !signature) {
      return res.status(400).json({ error: "session_id, wallet and signature are required" });
    }

    const wallet = getAddress(rawWallet);
    const supabase = serverClient();
    const { data: session, error } = await supabase
      .from("user_sessions")
      .select("id,user_id,wallet_address,nonce,expires_at,verified_at,revoked_at")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session || session.revoked_at || session.verified_at || new Date(session.expires_at).getTime() <= Date.now()) {
      return res.status(401).json({ error: "Sign-in challenge is invalid, already used, or expired" });
    }
    if (session.wallet_address.toLowerCase() !== wallet.toLowerCase()) {
      return res.status(401).json({ error: "Wallet does not match the sign-in challenge" });
    }

    const message = buildSignInMessage(wallet, session.nonce);
    const verified = await verifyMessage({
      address: wallet,
      message,
      signature: signature as Hex,
    });
    if (!verified) return res.status(401).json({ error: "Wallet signature verification failed" });

    const now = new Date().toISOString();
    await supabase
      .from("user_sessions")
      .update({
        verified_at: now,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", session.id);

    const { data: user } = await supabase
      .from("users")
      .select("id,wallet_address,display_name,avatar_url,created_at,updated_at")
      .eq("id", session.user_id)
      .single();

    res.setHeader(
      "Set-Cookie",
      `agentmarket_session=${encodeURIComponent(session.id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`,
    );
    return res.status(200).json({ ok: true, user });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to verify wallet signature" });
  }
}

export async function me(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ authenticated: false });
  return res.status(200).json({ authenticated: true, user: auth.user, expires_at: auth.session.expires_at });
}

export async function logout(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const id = parseCookies(req).agentmarket_session;
  if (id) await serverClient().from("user_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  res.setHeader("Set-Cookie", "agentmarket_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return res.status(200).json({ ok: true });
}
