import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
import { resolveProviderOperation, type ProviderAction } from "./provider-operation.js";

type EndpointRecord = {
  endpoint_url: string;
  protocol: string;
  status: string;
  metadata?: unknown;
  version?: string | null;
};

const ACTIONS: ProviderAction[] = ["quote", "decision", "authorization", "preflight", "execute", "result", "health"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });

  const agentId = typeof req.query?.agent_id === "string" ? req.query.agent_id.trim() : "";
  if (!agentId) return res.status(400).json({ error: "agent_id is required" });

  try {
    const supabase = serverClient();
    const [{ data: agent, error: agentError }, { data: endpoints, error: endpointError }] = await Promise.all([
      supabase.from("agents").select("id,agent_id,name,owner,status,verification_status,chain").eq("agent_id", agentId).maybeSingle(),
      supabase.from("agent_endpoints").select("endpoint_url,protocol,status,metadata,version").eq("agent_id", agentId).order("last_checked_at", { ascending: false }).limit(20),
    ]);

    if (agentError) throw new Error(agentError.message);
    if (endpointError) throw new Error(endpointError.message);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    if (agent.verification_status === "revoked") return res.status(409).json({ error: "Agent identity is revoked" });

    const typedEndpoints = (endpoints || []) as EndpointRecord[];
    const operations: Record<string, unknown> = {};

    for (const action of ACTIONS) {
      for (const endpoint of typedEndpoints) {
        const operation = await resolveProviderOperation(endpoint, action);
        if (!operation) continue;
        operations[action] = {
          action: operation.action,
          endpoint: operation.endpoint,
          method: operation.method,
          transport: operation.transport,
          name: operation.name,
          input_schema: operation.inputSchema || null,
          metadata: operation.metadata || {},
          registered_endpoint: endpoint.endpoint_url,
          endpoint_status: endpoint.status,
        };
        break;
      }
    }

    return res.status(200).json({
      ok: true,
      agent: {
        agent_id: agent.agent_id,
        name: agent.name,
        owner: agent.owner,
        chain: agent.chain,
        status: agent.status,
        verification_status: agent.verification_status,
      },
      operations,
      declared_actions: ACTIONS.filter((action) => Boolean(operations[action])),
      missing_actions: ACTIONS.filter((action) => !operations[action]),
      routing: {
        source: "agent-provider/v1 manifest or declared capability evidence",
        fallback_policy: "No arbitrary route guessing is exposed by this endpoint.",
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to resolve provider operations" });
  }
}
