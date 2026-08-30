import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

function address(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function optionalAddress(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return address(value) ? value : null;
}

function optionalString(value: unknown, max = 255): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });

    const supabase = serverClient();
    const userId = auth.user.id;

    if (req.method === "GET") {
      const { data: wallet, error: walletError } = await supabase
        .from("altana_execution_wallets")
        .select("user_id,wallet_address,signer_address,chain_id,wallet_provider,authorization_model,rp_id,status,created_at,updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (walletError) return res.status(500).json({ error: walletError.message });

      if (!wallet) {
        return res.status(200).json({ ok: true, wallet: null, sessions: [] });
      }

      const { data: sessions, error: sessionsError } = await supabase
        .from("execution_capital_requests")
        .select("id,job_id,agent_id,purpose,capital_requested,capital_authorized,capital_token,status,agent_session_key,session_key_id,session_expires_at,session_grant_tx_hash,session_revoke_tx_hash,authorized_at,activated_at,revoked_at,expired_at,updated_at")
        .eq("user_execution_wallet", wallet.wallet_address)
        .order("created_at", { ascending: false })
        .limit(50);
      if (sessionsError) return res.status(500).json({ error: sessionsError.message });

      return res.status(200).json({ ok: true, wallet, sessions: sessions || [] });
    }

    const walletAddress = req.body?.wallet_address;
    const signerAddress = optionalAddress(req.body?.signer_address);
    const rpId = optionalString(req.body?.rp_id, 255);
    const replaceExisting = req.body?.replace_existing === true;

    if (!address(walletAddress)) {
      return res.status(400).json({ error: "wallet_address must be a valid EVM address" });
    }

    const { data: existing, error: existingError } = await supabase
      .from("altana_execution_wallets")
      .select("user_id,wallet_address,signer_address,chain_id,wallet_provider,authorization_model,rp_id,status,created_at,updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (existingError) return res.status(500).json({ error: existingError.message });

    if (existing && String(existing.wallet_address).toLowerCase() !== walletAddress.toLowerCase()) {
      if (!replaceExisting || existing.status !== "recovery_required") {
        return res.status(409).json({
          error: "This AgentMarket user already has a different persistent Altana execution wallet. Recover that wallet first. A new wallet can only replace a wallet explicitly marked recovery-required after a failed recovery attempt.",
          wallet: existing,
        });
      }
    }

    const payload = {
      user_id: userId,
      wallet_address: walletAddress,
      signer_address: signerAddress,
      chain_id: 97,
      wallet_provider: "altana",
      authorization_model: "passkey",
      rp_id: rpId,
      status: "active",
    };

    const { data: wallet, error: upsertError } = await supabase
      .from("altana_execution_wallets")
      .upsert(payload, { onConflict: "user_id" })
      .select("user_id,wallet_address,signer_address,chain_id,wallet_provider,authorization_model,rp_id,status,created_at,updated_at")
      .single();
    if (upsertError) return res.status(500).json({ error: upsertError.message });

    return res.status(200).json({ ok: true, wallet });
  } catch (error) {
    console.error("Execution wallet API failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Execution wallet API failed" });
  }
}
