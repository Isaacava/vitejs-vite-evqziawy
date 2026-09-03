import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { discoverAgentCapabilities } from "../server/_testnet/agent-capabilities.js";
import { resolveProviderOperation } from "../server/_testnet/provider-operation.js";

const REQUEST_TIMEOUT_MS = 8_000;

function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function authorized(req: VercelRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.authorization;
  return auth === `Bearer ${secret}`;
}

async function probeEndpoint(endpointUrl: string) {
  const base = endpointUrl.replace(/\/+$/, "");
  const candidates = [`${base}/health`, `${base}/apex/health`, `${base}/erc8183/health`];
  const started = Date.now();
  for (const url of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json,text/plain;q=0.9,*/*;q=0.8" },
        signal: controller.signal,
      });
      if (response.ok) return { status: "online", statusCode: response.status, latencyMs: Date.now() - started, checkedUrl: url } as const;
      if (response.status >= 500) return { status: "degraded", statusCode: response.status, latencyMs: Date.now() - started, checkedUrl: url } as const;
    } catch {
      // Try the next known health path before declaring the provider offline.
    } finally {
      clearTimeout(timeout);
    }
  }
  return { status: "offline", statusCode: null, latencyMs: Date.now() - started, checkedUrl: null } as const;
}

async function discoverOperations(endpoint: Record<string, unknown>) {
  const operations = {} as Record<string, Record<string, unknown> | null>;
  for (const action of ["quote", "preflight", "execute", "result", "health"] as const) {
    try {
      const operation = await resolveProviderOperation(endpoint as never, action);
      operations[action] = operation ? {
        endpoint: operation.endpoint,
        method: operation.method,
        transport: operation.transport,
        name: operation.name,
        input_schema: operation.inputSchema ?? null,
        metadata: operation.metadata ?? {},
      } : null;
    } catch {
      operations[action] = null;
    }
  }
  return operations;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized" });

  try {
    const supabase = getServiceClient();
    const { data: endpoints, error } = await supabase
      .from("agent_endpoints")
      .select("id,agent_id,endpoint_url,protocol,version,status,metadata")
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });

    const results = [] as Array<{
      id: string;
      agentId: string;
      endpointUrl: string;
      previousStatus: string;
      status: string;
      statusCode: number | null;
      latencyMs: number;
      checkedUrl: string | null;
      capabilitySources: string[];
      capabilityCount: number;
      operations: Record<string, Record<string, unknown> | null>;
    }>;

    for (const endpoint of endpoints ?? []) {
      const probe = await probeEndpoint(endpoint.endpoint_url);
      const capabilitySnapshot = await discoverAgentCapabilities(
        { id: endpoint.agent_id, agent_id: endpoint.agent_id, metadata: {} },
        [endpoint as Record<string, unknown>],
      );
      const operations = await discoverOperations(endpoint as Record<string, unknown>);
      const previousMetadata = endpoint.metadata && typeof endpoint.metadata === "object" ? endpoint.metadata as Record<string, unknown> : {};
      const now = new Date().toISOString();
      const metadata = {
        ...previousMetadata,
        checked_url: probe.checkedUrl,
        checker: "agentmarket-runtime-discovery",
        checked_at: now,
        capabilities: capabilitySnapshot.capabilities,
        capabilities_source_urls: capabilitySnapshot.source_urls,
        capabilities_discovered_at: capabilitySnapshot.discovered_at,
        capabilities_discovery_source: "agentmarket_runtime_discovery",
        operations,
        operations_discovered_at: now,
      };

      const { error: updateError } = await supabase
        .from("agent_endpoints")
        .update({
          status: probe.status,
          status_code: probe.statusCode,
          latency_ms: probe.latencyMs,
          last_checked_at: now,
          metadata,
          updated_at: now,
        })
        .eq("id", endpoint.id);
      if (updateError) return res.status(500).json({ error: updateError.message, failedEndpointId: endpoint.id });

      results.push({
        id: endpoint.id,
        agentId: endpoint.agent_id,
        endpointUrl: endpoint.endpoint_url,
        previousStatus: endpoint.status,
        status: probe.status,
        statusCode: probe.statusCode,
        latencyMs: probe.latencyMs,
        checkedUrl: probe.checkedUrl,
        capabilitySources: capabilitySnapshot.source_urls,
        capabilityCount: capabilitySnapshot.capabilities.length,
        operations,
      });
    }

    const summary = results.reduce(
      (acc, row) => {
        acc.total += 1;
        acc[row.status] += 1;
        acc.capabilityProfiles += row.capabilityCount > 0 ? 1 : 0;
        acc.providersWithQuote += row.operations.quote ? 1 : 0;
        acc.providersWithPreflight += row.operations.preflight ? 1 : 0;
        acc.providersWithExecute += row.operations.execute ? 1 : 0;
        acc.providersWithResult += row.operations.result ? 1 : 0;
        acc.providersWithHealth += row.operations.health ? 1 : 0;
        return acc;
      },
      { total: 0, online: 0, degraded: 0, offline: 0, capabilityProfiles: 0, providersWithQuote: 0, providersWithPreflight: 0, providersWithExecute: 0, providersWithResult: 0, providersWithHealth: 0 } as Record<string, number>,
    );

    return res.status(200).json({
      ok: true,
      checkedAt: new Date().toISOString(),
      summary,
      results,
      note: "AgentMarket records only observed capabilities and provider operations. It does not infer an execution route from agent identity, and it does not treat agent-reported execution capital as proof of custody or authorization.",
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected server error" });
  }
}
