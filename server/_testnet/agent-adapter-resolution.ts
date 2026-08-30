import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { resolveAgentAdapter } from "../agent-adapter-selection.js";

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const agentId = typeof req.body?.agent_id === "string" ? req.body.agent_id.trim() : "";
  if (!agentId) return res.status(400).json({ error: "agent_id is required" });

  try {
    const supabase = serverClient();
    const [{ data: agent, error: agentError }, { data: endpoints, error: endpointsError }] = await Promise.all([
      supabase
        .from("agents")
        .select("id,agent_id,owner,uri,name,description,chain,category,status,verification_status,metadata")
        .eq("agent_id", agentId)
        .maybeSingle(),
      supabase
        .from("agent_endpoints")
        .select("agent_id,endpoint_url,protocol,status,metadata")
        .eq("agent_id", agentId),
    ]);

    if (agentError) throw new Error(agentError.message);
    if (endpointsError) throw new Error(endpointsError.message);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    if (agent.verification_status === "revoked") return res.status(409).json({ error: "Agent identity is revoked" });

    const resolution = await resolveAgentAdapter(
      agent as Record<string, unknown>,
      (endpoints ?? []) as Array<Record<string, unknown>>,
    );

    return res.status(200).json({
      ok: true,
      agent: {
        id: agent.id,
        agent_id: agent.agent_id,
        name: agent.name,
        chain: agent.chain,
        category: agent.category,
        status: agent.status,
        verification_status: agent.verification_status,
      },
      resolution,
      policy: {
        principle: "AgentMarket selects adapters from observed capability evidence, never from agent identity or internal implementation.",
        unknowns_remain_unknown: true,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to resolve agent adapter" });
  }
}
