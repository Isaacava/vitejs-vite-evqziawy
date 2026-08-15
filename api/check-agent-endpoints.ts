import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

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
      .select("id,agent_id,endpoint_url,protocol,version,status")
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
    }>;

    for (const endpoint of endpoints ?? []) {
      const probe = await probeEndpoint(endpoint.endpoint_url);
      const metadata = {
        checked_url: probe.checkedUrl,
        checker: "agentmarket-vercel-cron",
        checked_at: new Date().toISOString(),
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
      });
    }

    const summary = results.reduce(
      (acc, row) => {
        acc.total += 1;
        acc[row.status] += 1;
        return acc;
      },
      { total: 0, online: 0, degraded: 0, offline: 0 } as Record<string, number>,
    );

    return res.status(200).json({
      ok: true,
      checkedAt: new Date().toISOString(),
      summary,
      results,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected server error" });
  }
}
