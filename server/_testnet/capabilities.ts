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

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function schemaFromManifest(value: unknown): Record<string, unknown> | null {
  const root = object(value);
  const candidates: unknown[] = [
    root.capability_schema,
    root.capabilitySchema,
    object(root.metadata).capability_schema,
    object(root.metadata).capabilitySchema,
  ];
  const capabilities = Array.isArray(root.capabilities) ? root.capabilities : [];
  for (const capability of capabilities) {
    const item = object(capability);
    candidates.push(object(item.metadata).input_schema, object(item.metadata).inputSchema, item.input_schema, item.inputSchema);
  }
  const manifest = object(root.provider_manifest ?? root.providerManifest);
  candidates.push(manifest.capability_schema, object(manifest.metadata).capability_schema);
  const manifestCapabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  for (const capability of manifestCapabilities) {
    const item = object(capability);
    candidates.push(object(item.metadata).input_schema, object(item.metadata).inputSchema, item.input_schema, item.inputSchema);
  }

  for (const candidate of candidates) {
    const schema = object(candidate);
    if (Array.isArray(schema.inputs)) return schema;
  }
  return null;
}

async function discoverLiveSchema(endpoints: Array<{ endpoint_url?: string | null; metadata?: unknown }>) {
  for (const endpoint of endpoints) {
    const fromMetadata = schemaFromManifest(endpoint.metadata);
    if (fromMetadata) return fromMetadata;

    const rawEndpoint = typeof endpoint.endpoint_url === "string" ? endpoint.endpoint_url.trim() : "";
    if (!rawEndpoint) continue;
    try {
      const url = new URL(rawEndpoint);
      url.pathname = "/agent.json";
      url.search = "";
      const response = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) continue;
      const manifest = await response.json();
      const schema = schemaFromManifest(manifest);
      if (schema) return schema;
    } catch {
      // Try the next provider endpoint/manifest source.
    }
  }
  return null;
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

    const metadata = object(agent.metadata);
    let schema = schemaFromManifest(metadata);

    if (!schema) {
      const { data: endpoints, error: endpointError } = await supabase
        .from("agent_endpoints")
        .select("endpoint_url,metadata,last_checked_at")
        .eq("agent_id", String(agent.id))
        .order("last_checked_at", { ascending: false })
        .limit(20);
      if (endpointError) throw new Error(endpointError.message);
      schema = await discoverLiveSchema((endpoints || []) as Array<{ endpoint_url?: string | null; metadata?: unknown }>);
    }

    if (!schema) schema = { version: 1, inputs: [] };

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
