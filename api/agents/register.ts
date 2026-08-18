import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function requiredString(value: unknown, field: string, max = 500) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${field} is too long`);
  return result;
}

function evmAddress(value: unknown, field: string) {
  const result = requiredString(value, field, 42);
  if (!/^0x[a-fA-F0-9]{40}$/.test(result)) throw new Error(`${field} must be a valid EVM address`);
  return result;
}

function list(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))].slice(0, 20);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const agentId = requiredString(req.body?.agent_id, "agent_id", 80);
    const owner = evmAddress(req.body?.owner, "owner");
    const requestedName = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : "";
    const requestedDescription = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 2000) : "";
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint.trim() : "";
    const requestedCategory = typeof req.body?.category === "string" ? req.body.category.trim().slice(0, 80) : "";
    const capabilities = list(req.body?.capabilities);

    if (endpoint && !/^https:\/\//i.test(endpoint)) throw new Error("endpoint must use HTTPS");

    const supabase = serverClient();
    const { data: existing, error: existingError } = await supabase
      .from("agents")
      .select("id,agent_id,source,verification_status,owner,name,description,category,uri,last_indexed_at")
      .eq("agent_id", agentId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    if (!existing) {
      return res.status(404).json({
        error: "Agent has not been discovered yet. AgentMarket inventory comes from ERC-8004 indexing; wait for discovery before claiming it.",
        next_step: "discovery",
      });
    }

    if (existing.owner?.toLowerCase() !== owner.toLowerCase()) {
      return res.status(409).json({ error: "Agent ID is owned by a different wallet. Connect the wallet that currently owns the ERC-8004 identity." });
    }

    const now = new Date().toISOString();
    const nextName = requestedName || existing.name || `Agent #${agentId}`;
    const nextDescription = requestedDescription || existing.description || null;
    const nextCategory = requestedCategory || existing.category || "other";
    const agentPayload: Record<string, unknown> = {
      name: nextName,
      description: nextDescription,
      category: nextCategory,
      last_indexed_at: existing.source === "indexed" ? existing.last_indexed_at || now : now,
      metadata: {
        claim: "self_service",
        claimed_at: now,
        verification: existing.verification_status,
      },
    };

    const { data: agentRow, error: updateError } = await supabase
      .from("agents")
      .update(agentPayload as never)
      .eq("id", existing.id)
      .select("id,agent_id,name,source,verification_status,status,owner,uri,category")
      .single();
    if (updateError) throw new Error(updateError.message);

    for (const capability of [...new Set([nextCategory, ...capabilities])]) {
      const { error } = await supabase.from("agent_capabilities").upsert({
        agent_id: existing.id,
        capability,
        source: "self_registered",
        confidence: capability === nextCategory ? 1 : 0.7,
        metadata: { claimed_at: now, agentId },
        updated_at: now,
      }, { onConflict: "agent_id,capability,source" });
      if (error) throw new Error(error.message);
    }

    if (endpoint) {
      const { error } = await supabase.from("agent_endpoints").upsert({
        agent_id: existing.id,
        endpoint_url: endpoint,
        protocol: "erc8183",
        status: "unknown",
        metadata: { source: "self_claimed", claimed_at: now },
        updated_at: now,
      }, { onConflict: "agent_id,endpoint_url,protocol" });
      if (error) throw new Error(error.message);
    }

    return res.status(200).json({
      ok: true,
      agent: agentRow,
      next_step: "wallet_signature_verification",
      message: "Discovered agent claimed. Wallet control, endpoint liveness, and job evidence remain separate verification gates.",
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to claim agent" });
  }
}
