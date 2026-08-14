import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "./_auth";

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

  const action = typeof req.body?.action === "string" ? req.body.action.trim() : "create";

  if (action === "revoke") {
    const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
    if (!id) return res.status(400).json({ error: "permission id is required" });

    const { data, error } = await supabase
      .from("session_permissions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .select("id,status,revoked_at,updated_at")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Permission not found" });

    await supabase.from("user_activity").insert({
      user_id: auth.user.id,
      type: "session_permission_revoked",
      title: "Execution permission revoked",
      description: `Permission ${id} was revoked by the wallet owner.`,
    });

    return res.status(200).json({ permission: data });
  }

  if (action !== "create") return res.status(400).json({ error: "Unsupported permission action" });

  const walletAddress = typeof req.body?.wallet_address === "string" ? req.body.wallet_address.trim() : auth.user.wallet_address;
  const allowedTokens = parseStringArray(req.body?.allowed_tokens);
  const allowedProtocols = parseStringArray(req.body?.allowed_protocols);
  const maxTotalValue = Number(req.body?.max_total_value ?? 0);
  const maxSingleActionValue = Number(req.body?.max_single_action_value ?? 0);
  const expiresAt = typeof req.body?.expires_at === "string" ? new Date(req.body.expires_at) : new Date(Date.now() + 60 * 60 * 1000);

  if (!addressPattern.test(walletAddress)) return res.status(400).json({ error: "wallet_address must be a valid EVM address" });
  if (walletAddress.toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
    return res.status(403).json({ error: "Permission wallet must match the authenticated wallet" });
  }
  if (!Number.isFinite(maxTotalValue) || maxTotalValue < 0) return res.status(400).json({ error: "max_total_value must be non-negative" });
  if (!Number.isFinite(maxSingleActionValue) || maxSingleActionValue < 0) return res.status(400).json({ error: "max_single_action_value must be non-negative" });
  if (expiresAt.getTime() <= Date.now()) return res.status(400).json({ error: "expires_at must be in the future" });

  const { data, error } = await supabase
    .from("session_permissions")
    .insert({
      user_id: auth.user.id,
      wallet_address: auth.user.wallet_address,
      allowed_tokens: allowedTokens,
      allowed_protocols: allowedProtocols,
      max_total_value: maxTotalValue,
      max_single_action_value: maxSingleActionValue,
      expires_at: expiresAt.toISOString(),
      status: "active",
    })
    .select("id,wallet_address,allowed_tokens,allowed_protocols,max_total_value,max_single_action_value,starts_at,expires_at,status,created_at")
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from("user_activity").insert({
    user_id: auth.user.id,
    type: "session_permission_created",
    title: "Execution permission created",
    description: `Scoped permission created with ${allowedTokens.length} token allowlist entries and ${allowedProtocols.length} protocol allowlist entries.`,
  });

  return res.status(201).json({
    permission: data,
    safety: {
      privateKeysStored: false,
      walletAuthorityTransferred: false,
      executionNotEnabled: true,
    },
  });
}
