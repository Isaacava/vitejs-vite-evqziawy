import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "./auth.js";

const txHashPattern = /^0x[a-fA-F0-9]{64}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  const supabase = serverClient();
  const wallet = auth.user.wallet_address.toLowerCase();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("execution_capital_requests")
      .select("id,job_id,agent_id,requester_wallet,user_execution_wallet,session_key_id,capital_requested,capital_token,capital_authorized,spend_cap,call_allowlist,session_expires_at,status,authorization_verified_at,session_grant_tx_hash,session_revoke_tx_hash,requested_at,authorized_at,activated_at,revoked_at,expired_at,created_at,updated_at,evidence")
      .eq("requester_wallet", wallet)
      .in("status", ["authorized", "active", "revoked", "expired"])
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const requests = data || [];
    const agentIds = Array.from(new Set(requests.map((request) => request.agent_id).filter(Boolean)));
    const { data: agents, error: agentError } = agentIds.length
      ? await supabase.from("agents").select("id,agent_id,name").in("id", agentIds)
      : { data: [], error: null };
    if (agentError) return res.status(500).json({ error: agentError.message });
    const agentById = new Map((agents || []).map((agent) => [agent.id, agent]));

    return res.status(200).json({
      sessions: requests.map((request) => ({
        ...request,
        agent: request.agent_id ? agentById.get(request.agent_id) || null : null,
      })),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const action = typeof req.body?.action === "string" ? req.body.action.trim().toLowerCase() : "";
    if (action !== "revoke") return res.status(400).json({ error: "Only active Altana session revocation is supported here" });

    const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
    const txHash = typeof req.body?.tx_hash === "string" ? req.body.tx_hash.trim() : "";
    if (!id) return res.status(400).json({ error: "Session id is required" });
    if (!txHashPattern.test(txHash)) return res.status(400).json({ error: "A confirmed on-chain revoke transaction is required" });

    const { data: request, error: requestError } = await supabase
      .from("execution_capital_requests")
      .select("id,status,requester_wallet")
      .eq("id", id)
      .eq("requester_wallet", wallet)
      .maybeSingle();
    if (requestError) return res.status(500).json({ error: requestError.message });
    if (!request) return res.status(404).json({ error: "Execution session not found" });
    if (!["authorized", "active"].includes(String(request.status))) {
      return res.status(409).json({ error: `Only an active authorized session can be revoked; current status is ${request.status}` });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("execution_capital_requests")
      .update({ status: "revoked", revoked_at: now, session_revoke_tx_hash: txHash, updated_at: now })
      .eq("id", id)
      .eq("requester_wallet", wallet)
      .in("status", ["authorized", "active"])
      .select("id,status,revoked_at,session_revoke_tx_hash,updated_at")
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(409).json({ error: "The execution session changed before revocation was recorded" });
    return res.status(200).json({ ok: true, session: data });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to revoke execution session" });
  }
}
