import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "./_auth.js";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  const supabase = serverClient();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("session_permissions")
      .select("id,wallet_address,allowed_tokens,allowed_protocols,max_total_value,max_single_action_value,starts_at,expires_at,revoked_at,status,created_at,updated_at")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ permissions: data || [] });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const action = typeof req.body?.action === "string" ? req.body.action.trim().toLowerCase() : "create";
    if (action === "revoke") {
      const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
      if (!id) return res.status(400).json({ error: "Permission id is required" });
      const { data, error } = await supabase
        .from("session_permissions")
        .update({ revoked_at: new Date().toISOString(), status: "revoked", updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", auth.user.id)
        .select("id,wallet_address,status,revoked_at,updated_at")
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: "Permission not found" });
      return res.status(200).json({ ok: true, permission: data });
    }

    const wallet = typeof req.body?.wallet_address === "string" ? req.body.wallet_address.trim() : auth.user.wallet_address;
    if (!addressPattern.test(wallet)) return res.status(400).json({ error: "A valid wallet address is required" });
    if (wallet.toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "Permission wallet must match the authenticated wallet" });

    const tokenList = parseStringArray(req.body?.allowed_tokens);
    const protocolList = parseStringArray(req.body?.allowed_protocols);
    const totalCap = Number(req.body?.max_total_value ?? 0);
    const singleCap = Number(req.body?.max_single_action_value ?? 0);
    if (!Number.isFinite(totalCap) || totalCap < 0 || !Number.isFinite(singleCap) || singleCap < 0) return res.status(400).json({ error: "Permission limits must be non-negative numbers" });

    const startsAt = typeof req.body?.starts_at === "string" ? req.body.starts_at : new Date().toISOString();
    const expiresAt = typeof req.body?.expires_at === "string" ? req.body.expires_at : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    if (new Date(expiresAt).getTime() <= Date.now()) return res.status(400).json({ error: "expires_at must be in the future" });

    const { data, error } = await supabase
      .from("session_permissions")
      .insert({
        user_id: auth.user.id,
        wallet_address: wallet,
        allowed_tokens: tokenList,
        allowed_protocols: protocolList,
        max_total_value: totalCap,
        max_single_action_value: singleCap,
        starts_at: startsAt,
        expires_at: expiresAt,
        status: "active",
      })
      .select("id,wallet_address,allowed_tokens,allowed_protocols,max_total_value,max_single_action_value,starts_at,expires_at,revoked_at,status,created_at,updated_at")
      .single();
    if (error) throw new Error(error.message);
    return res.status(201).json({ ok: true, permission: data });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to manage session permission" });
  }
}
