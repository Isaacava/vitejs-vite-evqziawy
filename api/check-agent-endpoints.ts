import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { discoverAgentCapabilities } from "../server/_testnet/agent-capabilities.js";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_PROFILE_BYTES = 128_000;

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

async function fetchExecutionProfile(endpointUrl: string) {
  const base = endpointUrl.replace(/\/+$/, "");
  const candidates = [`${base}/execution-capabilities`, `${base}/execution-capital`];
  let lastStatusCode: number | null = null;
  for (const url of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      lastStatusCode = response.status;
      if (!response.ok) continue;
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (Number.isFinite(contentLength) && contentLength > MAX_PROFILE_BYTES) return { available: false as const, statusCode: response.status };
      const raw = await response.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_PROFILE_BYTES) return { available: false as const, statusCode: response.status };
      const body = raw ? JSON.parse(raw) : null;
      if (!body || typeof body !== "object") continue;
      const profile = (body as Record<string, unknown>).profile ?? (body as Record<string, unknown>).execution_capital ?? body;
      return { available: true as const, statusCode: response.status, profile, sourceUrl: url };
    } catch {
      // Try the legacy endpoint before declaring the profile unavailable.
    } finally {
      clearTimeout(timeout);
    }
  }
  return { available: false as const, statusCode: lastStatusCode };
}

async function probeEndpoint(endpointUrl: string) {
  const base = endpointUrl.replace(/\/+$/, "");
  const candidates = [
    `${base}/health`,
    `${base}/apex/health`,
    `${base}/erc8183/health`,
  ];

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
      if (response.ok) {
        return {
          status: "online",
          statusCode: response.status,
          latencyMs: Date.now() - started,
          checkedUrl: url,
        } as const;
      }

      if (response.status >= 500) {
        return {
          status: "degraded",
          statusCode: response.status,
          latencyMs: Date.now() - started,
          checkedUrl: url,
        } as const;
      }
    } catch {
      // Try the next known health path before declaring the provider offline.
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    status: "offline",
    statusCode: null,
    latencyMs: Date.now() - started,
    checkedUrl: null,
  } as const;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!authorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

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
      executionCapitalProfileReported: boolean;
    }>;

    for (const endpoint of endpoints ?? []) {
      const probe = await probeEndpoint(endpoint.endpoint_url);

      const capabilitySnapshot = await discoverAgentCapabilities(
        { id: endpoint.agent_id, agent_id: endpoint.agent_id, metadata: {} },
        [endpoint as Record<string, unknown>],
      );

      const profile = probe.status === "online" && endpoint.protocol === "erc8183"
        ? await fetchExecutionProfile(endpoint.endpoint_url)
        : { available: false as const, statusCode: null };

      const previousMetadata = endpoint.metadata && typeof endpoint.metadata === "object"
        ? endpoint.metadata as Record<string, unknown>
        : {};
      const metadata = {
        ...previousMetadata,
        checked_url: probe.checkedUrl,
        checker: "agentmarket-vercel-cron",
        checked_at: new Date().toISOString(),
        capabilities: capabilitySnapshot.capabilities,
        capabilities_source_urls: capabilitySnapshot.source_urls,
        capabilities_discovered_at: capabilitySnapshot.discovered_at,
        capabilities_discovery_source: "agentmarket_runtime_discovery",
        reported_execution_capital: profile.available ? profile.profile : null,
        reported_execution_capital_source: profile.available ? "live_agent_endpoint" : null,
        reported_execution_capital_url: profile.available ? profile.sourceUrl : null,
        reported_execution_capital_verified: false,
        reported_execution_capital_checked_at: profile.available ? new Date().toISOString() : null,
      };

      const { error: updateError } = await supabase
        .from("agent_endpoints")
        .update({
          status: probe.status,
          status_code: probe.statusCode,
          latency_ms: probe.latencyMs,
          last_checked_at: new Date().toISOString(),
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", endpoint.id);

      if (updateError) {
        return res.status(500).json({ error: updateError.message, failedEndpointId: endpoint.id });
      }

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
        executionCapitalProfileReported: profile.available,
      });
    }

    const summary = results.reduce(
      (acc, row) => {
        acc.total += 1;
        acc[row.status] += 1;
        acc.capabilityProfiles += row.capabilityCount > 0 ? 1 : 0;
        if (row.executionCapitalProfileReported) acc.executionCapitalProfiles += 1;
        return acc;
      },
      { total: 0, online: 0, degraded: 0, offline: 0, capabilityProfiles: 0, executionCapitalProfiles: 0 } as Record<string, number>,
    );

    return res.status(200).json({
      ok: true,
      checkedAt: new Date().toISOString(),
      summary,
      results,
      note: "Agent capabilities are discovered from registered or declared endpoints and stored as observed capability metadata. Execution-capital profiles remain agent-reported and are not treated as proof of onchain authorization or custody.",
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected server error" });
  }
}
