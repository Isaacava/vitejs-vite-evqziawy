import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const agentId = typeof req.query.agent_id === "string" ? req.query.agent_id.trim() : "";
    if (!agentId) return res.status(400).json({ error: "agent_id is required" });

    const supabase = serverClient();
    let query = supabase
      .from("agents")
      .select("id,agent_id,name,category,chain,status,verification_status,owner,metadata")
      .eq("chain", "bsc-testnet");
    query = isUuid(agentId) ? query.eq("id", agentId) : query.eq("agent_id", agentId);
    const { data: agent, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (!agent) return res.status(404).json({ error: "Testnet agent not found" });
    if (agent.verification_status === "revoked") return res.status(409).json({ error: "Agent identity is revoked" });

    const metadata = agent.metadata && typeof agent.metadata === "object" ? agent.metadata as Record<string, unknown> : {};
    const schema = metadata.capability_schema && typeof metadata.capability_schema === "object"
      ? metadata.capability_schema as Record<string, unknown>
      : { version: 1, inputs: [] };

    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: 97,
      agent: {
        id: agent.id,
        agent_id: agent.agent_id,
        name: agent.name,
        category: agent.category,
        owner: agent.owner,
        status: agent.status,
        verification_status: agent.verification_status,
      },
      capability: schema,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to resolve agent capability schema" });
  }
}
