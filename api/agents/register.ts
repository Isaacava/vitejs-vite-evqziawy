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
    const name = requiredString(req.body?.name, "name", 120);
    const description = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 2000) : null;
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint.trim() : "";
    const category = requiredString(req.body?.category, "category", 80);
    const capabilities = list(req.body?.capabilities);

    if (endpoint && !/^https:\/\//i.test(endpoint)) throw new Error("endpoint must use HTTPS");
    if (capabilities.length === 0) capabilities.push(category);

    const supabase = serverClient();
    const { data: existing, error: existingError } = await supabase
      .from("agents")
      .select("id,source,verification_status,owner")
      .eq("agent_id", agentId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    if (existing && existing.owner?.toLowerCase() !== owner.toLowerCase()) {
      return res.status(409).json({ error: "Agent ID already belongs to another wallet" });
    }

    const now = new Date().toISOString();
    const agentPayload: Record<string, unknown> = {
      agent_id: agentId,
      owner,
      name,
      description,
      chain: "bsc",
      category,
      source: existing?.source || "self_registered",
      verification_status: existing?.verification_status === "verified" ? "verified" : "pending",
      status: "unknown",
      is_first_party: false,
      indexed_at: existing ? undefined : now,
      last_indexed_at: now,
      metadata: { registration: "self_service", verification: "pending_wallet_control" },
    };

    let agentRow: { id: string; agent_id: string; name: string; source: string; verification_status: string; status: string };
    if (existing) {
      const { data, error } = await supabase.from("agents").update(agentPayload as never).eq("id", existing.id).select("id,agent_id,name,source,verification_status,status").single();
      if (error) throw new Error(error.message);
      agentRow = data as typeof agentRow;
    } else {
      const { data, error } = await supabase.from("agents").insert(agentPayload as never).select("id,agent_id,name,source,verification_status,status").single();
      if (error) throw new Error(error.message);
      agentRow = data as typeof agentRow;
    }

    for (const capability of capabilities) {
      const { error } = await supabase.from("agent_capabilities").upsert({
        agent_id: agentRow.id,
        capability,
        source: "self_registered",
        confidence: 0.7,
        metadata: { submitted_at: now },
        updated_at: now,
      }, { onConflict: "agent_id,capability,source" });
      if (error) throw new Error(error.message);
    }

    if (endpoint) {
      const { error } = await supabase.from("agent_endpoints").upsert({
        agent_id: agentRow.id,
        endpoint_url: endpoint,
        protocol: "erc8183",
        status: "unknown",
        metadata: { source: "self_registered" },
        updated_at: now,
      }, { onConflict: "agent_id,endpoint_url,protocol" });
      if (error) throw new Error(error.message);
    }

    return res.status(existing ? 200 : 201).json({
      ok: true,
      agent: agentRow,
      next_step: "wallet_signature_verification",
      message: "Agent registered in the marketplace inventory. Wallet control is pending verification; endpoint liveness is checked separately.",
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to register agent" });
  }
}
