import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { discoverAgentCapabilities } from "./agent-capabilities.js";
import type { AgentCapability } from "../../src/lib/agentCapability.js";

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function schemaInputs(schema: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(schema.inputs)) {
    return schema.inputs.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)));
  }

  const properties = object(schema.properties);
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === "string") : []);
  return Object.entries(properties).map(([name, property]) => {
    const item = object(property);
    const jsonType = text(item.type) || "string";
    const type = jsonType === "integer" ? "integer" : jsonType === "number" ? "number" : jsonType === "boolean" ? "boolean" : jsonType === "array" ? "json" : "text";
    const options = Array.isArray(item.enum) ? item.enum : undefined;
    return {
      name,
      label: text(item.title) || name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      type,
      required: required.has(name),
      help: text(item.description),
      ...(options ? { options } : {}),
      ...(item.default !== undefined ? { default: item.default } : {}),
    };
  });
}

function capabilityToResponseSchema(capability: AgentCapability): Record<string, unknown> {
  const metadata = object(capability.metadata);
  const declaredCapabilitySchema = object(metadata.capability_schema ?? metadata.capabilitySchema);
  const inputSchema = object(capability.input_schema ?? metadata.input_schema ?? metadata.inputSchema ?? declaredCapabilitySchema);
  const inputs = schemaInputs(inputSchema);
  const defaults = object(declaredCapabilitySchema.defaults ?? metadata.defaults);

  return {
    version: Number.isFinite(Number(declaredCapabilitySchema.version)) ? Number(declaredCapabilitySchema.version) : 1,
    inputs,
    ...(Object.keys(defaults).length ? { defaults } : {}),
  };
}

function capabilityMatchesAgent(capability: AgentCapability, agentId: string) {
  const metadata = object(capability.metadata);
  const ids = [metadata.erc8004_agent_id, metadata.erc8004AgentId, metadata.agent_id, metadata.agentId, metadata.capability_id, metadata.capabilityId];
  return ids.some((value) => typeof value === "string" && value.trim() === agentId);
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
    const { data: agent, error } = await supabase
      .from("agents")
      .select("id,agent_id,name,category,chain,status,verification_status,owner,metadata")
      .eq("chain", "bsc-testnet")
      .eq("agent_id", agentId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!agent) return res.status(404).json({ error: "Testnet agent not found" });
    if (agent.verification_status === "revoked") return res.status(409).json({ error: "Agent identity is revoked" });

    const { data: endpoints, error: endpointError } = await supabase
      .from("agent_endpoints")
      .select("endpoint_url,metadata")
      .eq("agent_id", String(agent.id));
    if (endpointError) throw new Error(endpointError.message);

    const snapshot = await discoverAgentCapabilities(
      agent as Record<string, unknown>,
      (endpoints || []) as Array<Record<string, unknown>>,
    );

    const matched = snapshot.capabilities.find((capability) => capabilityMatchesAgent(capability, agentId));
    const capability = matched || snapshot.capabilities.find((item) => item.kind === "task_submission") || snapshot.capabilities[0] || null;
    const responseSchema = capability ? capabilityToResponseSchema(capability) : { version: 1, inputs: [] };

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
      capability: responseSchema,
      discovery: {
        source_urls: snapshot.source_urls,
        discovered_at: snapshot.discovered_at,
        capability_count: snapshot.capabilities.length,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to resolve agent capability schema" });
  }
}
