import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  try {
    const supabase = serverClient();
    const { data: agents, error: agentError } = await supabase
      .from("agents")
      .select("id,agent_id,owner,name,status,verification_status,chain,updated_at")
      .eq("chain", "bsc-testnet")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (agentError) throw new Error(agentError.message);

    const agentIds = (agents ?? []).map((agent) => agent.id);
    const { data: endpoints, error: endpointError } = agentIds.length
      ? await supabase.from("agent_endpoints")
          .select("id,agent_id,endpoint_url,protocol,version,status,status_code,latency_ms,last_checked_at,updated_at")
          .in("agent_id", agentIds)
          .order("last_checked_at", { ascending: false })
      : { data: [], error: null };
    if (endpointError) throw new Error(endpointError.message);

    const endpointByAgent = new Map<string, (typeof endpoints)[number]>();
    for (const endpoint of endpoints ?? []) {
      if (!endpointByAgent.has(endpoint.agent_id)) endpointByAgent.set(endpoint.agent_id, endpoint);
    }

    const providers = (agents ?? []).map((agent) => {
      const endpoint = endpointByAgent.get(agent.id);
      const identityReady = Boolean(agent.agent_id && agent.owner && agent.verification_status !== "revoked");
      const serviceReady = endpoint?.status === "online";
      return {
        id: agent.id,
        agent_id: agent.agent_id,
        name: agent.name,
        owner: agent.owner,
        status: agent.status,
        verification_status: agent.verification_status,
        chain: agent.chain,
        identity_ready: identityReady,
        service_ready: serviceReady,
        marketplace_ready: identityReady && serviceReady && agent.status !== "offline",
        endpoint: endpoint ? {
          url: endpoint.endpoint_url,
          protocol: endpoint.protocol,
          version: endpoint.version,
          status: endpoint.status,
          status_code: endpoint.status_code,
          latency_ms: endpoint.latency_ms,
          last_checked_at: endpoint.last_checked_at,
        } : null,
        updated_at: agent.updated_at,
      };
    });

    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: 97,
      requested_by: auth.user.wallet_address,
      providers,
      summary: providers.reduce((acc, provider) => {
        acc.total += 1;
        if (provider.marketplace_ready) acc.ready += 1;
        if (provider.service_ready) acc.online += 1;
        if (provider.verification_status === "revoked") acc.revoked += 1;
        return acc;
      }, { total: 0, ready: 0, online: 0, revoked: 0 }),
      note: "Readiness is based on Testnet identity and the latest stored service health check. No server-side endpoint probing is performed by this user-facing route.",
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load Testnet provider readiness" });
  }
}
