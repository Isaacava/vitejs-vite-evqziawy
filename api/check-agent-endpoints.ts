import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { discoverAgentCapabilities } from "../server/_testnet/agent-capabilities.js";
import { discoverAgentProviderManifest, requiredHiringOperations, manifestToMetadata } from "../server/_testnet/agent-provider-manifest.js";
import { resolveProviderOperation } from "../server/_testnet/provider-operation.js";

const REQUEST_TIMEOUT_MS = 8_000;

type OperationSnapshot = Record<string, unknown> | null;

type OperationCheck = {
  checkedUrl: string | null;
  method: string | null;
  reachable: boolean;
  statusCode: number | null;
  latencyMs: number;
};

function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function authorized(req: VercelRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}`;
}

async function probeUrl(url: string, method = "GET") {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const normalizedMethod = method.toUpperCase();
    const needsBody = ["POST", "PUT", "PATCH"].includes(normalizedMethod);
    const response = await fetch(url, {
      method: normalizedMethod,
      headers: {
        Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
        ...(needsBody ? { "Content-Type": "application/json" } : {}),
      },
      body: needsBody ? "{}" : undefined,
      signal: controller.signal,
    });
    return { ok: response.ok, statusCode: response.status, latencyMs: Date.now() - started, checkedUrl: url };
  } catch {
    return { ok: false, statusCode: null, latencyMs: Date.now() - started, checkedUrl: url };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeEndpoint(endpointUrl: string, declaredHealth: OperationSnapshot) {
  // A declared manifest health operation is authoritative. Legacy guessed paths are
  // compatibility-only and are never used when the provider declares health.
  const declaredUrl = declaredHealth && typeof declaredHealth.endpoint === "string" ? declaredHealth.endpoint : null;
  const declaredMethod = declaredHealth && typeof declaredHealth.method === "string" ? declaredHealth.method : "GET";
  if (declaredUrl) {
    const probe = await probeUrl(declaredUrl, declaredMethod);
    if (probe.ok) return { status: "online", ...probe } as const;
    if (probe.statusCode !== null && probe.statusCode >= 500) return { status: "degraded", ...probe } as const;
    return { status: "offline", ...probe } as const;
  }

  const base = endpointUrl.replace(/\/+$/, "");
  const candidates = [`${base}/health`, `${base}/apex/health`, `${base}/erc8183/health`];
  for (const url of candidates) {
    const probe = await probeUrl(url, "GET");
    if (probe.ok) return { status: "online", ...probe } as const;
    if (probe.statusCode !== null && probe.statusCode >= 500) return { status: "degraded", ...probe } as const;
  }
  return { status: "offline", statusCode: null, latencyMs: 0, checkedUrl: null } as const;
}

function materializeProbeUrl(url: string) {
  return url.replace(/\{[^}]+\}/g, "0");
}

async function checkOperation(operation: OperationSnapshot): Promise<OperationCheck> {
  if (!operation || typeof operation.endpoint !== "string") {
    return { checkedUrl: null, method: null, reachable: false, statusCode: null, latencyMs: 0 };
  }
  const method = typeof operation.method === "string" ? operation.method : "GET";
  const checkedUrl = materializeProbeUrl(operation.endpoint);
  const probe = await probeUrl(checkedUrl, method);
  // Any HTTP response means the route is reachable. 4xx is allowed here because
  // a route can legitimately reject a probe payload or a placeholder job id.
  return {
    checkedUrl,
    method,
    reachable: probe.statusCode !== null && probe.statusCode < 500,
    statusCode: probe.statusCode,
    latencyMs: probe.latencyMs,
  };
}

async function discoverOperations(endpoint: Record<string, unknown>) {
  const operations: Record<string, OperationSnapshot> = {};
  for (const action of ["quote", "decision", "authorization", "preflight", "execute", "result", "health"] as const) {
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

async function checkOperations(operations: Record<string, OperationSnapshot>) {
  const checks: Record<string, OperationCheck> = {};
  for (const action of ["quote", "decision", "authorization", "preflight", "execute", "result", "health"] as const) {
    checks[action] = await checkOperation(operations[action]);
  }
  return checks;
}

function requiredChecksPass(requiredOperations: string[], checks: Record<string, OperationCheck>) {
  return requiredOperations.every((action) => checks[action]?.reachable === true);
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

    const results = [] as Array<Record<string, unknown>>;

    for (const endpoint of endpoints ?? []) {
      const manifest = await discoverAgentProviderManifest(endpoint as never);
      const operations = await discoverOperations(endpoint as Record<string, unknown>);
      const operationChecks = await checkOperations(operations);
      const probe = await probeEndpoint(endpoint.endpoint_url, operations.health);
      const capabilitySnapshot = await discoverAgentCapabilities(
        { id: endpoint.agent_id, agent_id: endpoint.agent_id, metadata: manifest ? manifestToMetadata(manifest) : {} },
        [endpoint as Record<string, unknown>],
      );

      const previousMetadata = endpoint.metadata && typeof endpoint.metadata === "object" ? endpoint.metadata as Record<string, unknown> : {};
      const protocol = manifest?.hiring?.protocol && typeof manifest.hiring.protocol === "string"
        ? manifest.hiring.protocol
        : endpoint.protocol;
      const requiredOperations = manifest ? requiredHiringOperations(manifest, protocol) : [];
      const missingRequiredOperations = requiredOperations.filter((action) => !operations[action]);
      const unreachableRequiredOperations = requiredOperations.filter((action) => operationChecks[action]?.reachable !== true);
      const hireable = Boolean(
        manifest
        && probe.status === "online"
        && missingRequiredOperations.length === 0
        && unreachableRequiredOperations.length === 0
        && manifest.capabilities.length > 0,
      );
      const now = new Date().toISOString();
      const metadata = {
        ...previousMetadata,
        ...(manifest ? { provider_manifest: manifestToMetadata(manifest) } : { provider_manifest_error: "No valid agent-provider/v1 manifest discovered" }),
        checked_url: probe.checkedUrl,
        checker: "agentmarket-runtime-discovery",
        checked_at: now,
        capabilities: capabilitySnapshot.capabilities,
        capabilities_source_urls: capabilitySnapshot.source_urls,
        capabilities_discovered_at: capabilitySnapshot.discovered_at,
        capabilities_discovery_source: "agentmarket_runtime_discovery",
        operations,
        operation_checks: operationChecks,
        operations_discovered_at: now,
        hireability: {
          protocol,
          required_operations: requiredOperations,
          missing_operations: missingRequiredOperations,
          unreachable_operations: unreachableRequiredOperations,
          healthy: probe.status === "online",
          hireable,
          evaluated_at: now,
        },
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
        manifest: manifest ? {
          url: manifest.manifestUrl,
          spec: manifest.spec,
          name: manifest.name,
          version: manifest.version,
          protocols: manifest.protocols,
          synthetic: manifest.metadata?.synthetic_manifest === true,
          discovery: manifest.discovery,
        } : null,
        hireability: {
          protocol,
          requiredOperations,
          missingRequiredOperations,
          unreachableRequiredOperations,
          hireable,
        },
        capabilitySources: capabilitySnapshot.source_urls,
        capabilityCount: capabilitySnapshot.capabilities.length,
        operations,
        operationChecks,
      });
    }

    const summary = results.reduce(
      (acc, row) => {
        acc.total += 1;
        const status = typeof row.status === "string" ? row.status : "offline";
        if (status in acc) acc[status] += 1;
        const operations = row.operations && typeof row.operations === "object" ? row.operations as Record<string, unknown> : {};
        const operationChecks = row.operationChecks && typeof row.operationChecks === "object" ? row.operationChecks as Record<string, OperationCheck> : {};
        const hireability = row.hireability && typeof row.hireability === "object" ? row.hireability as Record<string, unknown> : {};
        const capabilities = Number(row.capabilityCount || 0);
        if (capabilities > 0) acc.capabilityProfiles += 1;
        if (operations.quote) acc.providersWithQuote += 1;
        if (operations.decision) acc.providersWithDecision += 1;
        if (operations.preflight) acc.providersWithPreflight += 1;
        if (operations.execute) acc.providersWithExecute += 1;
        if (operations.result) acc.providersWithResult += 1;
        if (operations.health) acc.providersWithHealth += 1;
        if (requiredChecksPass(["quote"], operationChecks)) acc.reachableQuote += 1;
        if (requiredChecksPass(["result"], operationChecks)) acc.reachableResult += 1;
        if (hireability.hireable === true) acc.hireable += 1;
        if (row.manifest) acc.validManifests += 1;
        if (row.manifest && (row.manifest as Record<string, unknown>).synthetic === true) acc.syntheticManifests += 1;
        return acc;
      },
      { total: 0, online: 0, degraded: 0, offline: 0, validManifests: 0, syntheticManifests: 0, hireable: 0, capabilityProfiles: 0, providersWithQuote: 0, reachableQuote: 0, providersWithDecision: 0, providersWithPreflight: 0, providersWithExecute: 0, providersWithResult: 0, reachableResult: 0, providersWithHealth: 0 } as Record<string, number>,
    );

    return res.status(200).json({
      ok: true,
      checkedAt: new Date().toISOString(),
      summary,
      results,
      note: "AgentMarket uses agent-provider/v1 manifests when available and synthesizes a compatibility manifest from legacy ERC-8183 provider roots when necessary. Health and required hiring operations are actively probed; protocol fallbacks remain compatibility-only.",
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected server error" });
  }
}
