import type { AgentCapability, AgentCapabilitySnapshot } from "../../src/lib/agentCapability.js";
import { normalizeAgentCapability } from "../../src/lib/agentCapability.js";
import { discoverAgentProviderManifest, type AgentProviderManifest } from "./agent-provider-manifest.js";

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 128 * 1024;
const MCP_PROTOCOL_VERSION = "2026-07-28";

function object(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim()))];
}

function originUrl(value: string) {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function candidateUrls(agent: Record<string, unknown>) {
  const metadata = object(agent.metadata);
  const candidates = [
    metadata.agent_card,
    metadata.agent_card_url,
    metadata.capabilities_url,
    metadata.capability_url,
    metadata.a2a_url,
    metadata.mcp_url,
    metadata.api_url,
    metadata.endpoint_url,
  ];
  return uniqueStrings(candidates);
}

function endpointCandidates(endpoints: Array<Record<string, unknown>>) {
  return uniqueStrings(endpoints.map((endpoint) => endpoint.endpoint_url));
}

function wellKnownCandidates(url: string) {
  const origin = originUrl(url);
  const base = url.replace(/\/+$/, "");
  return uniqueStrings([
    `${base}/capabilities`,
    `${base}/agent-card`,
    `${base}/.well-known/agent-card.json`,
    origin ? `${origin}/.well-known/agent-card.json` : null,
    origin ? `${origin}/.well-known/agent-card` : null,
    origin ? `${origin}/.well-known/agent-registration.json` : null,
  ]);
}

function normalizeDocument(document: unknown, sourceUrl: string): AgentCapability[] {
  if (!document || typeof document !== "object") return [];
  const raw = document as Record<string, unknown>;
  const values = Array.isArray(raw.capabilities)
    ? raw.capabilities
    : Array.isArray(raw.skills)
      ? raw.skills
      : [raw];

  return values
    .map((value) => normalizeAgentCapability(value, sourceUrl))
    .filter((value): value is AgentCapability => Boolean(value));
}

function normalizeA2ACard(document: unknown, sourceUrl: string): AgentCapability[] {
  if (!document || typeof document !== "object") return [];
  const raw = document as Record<string, unknown>;
  const skills = Array.isArray(raw.skills) ? raw.skills : [];
  const endpoint = typeof raw.url === "string" ? raw.url : sourceUrl;
  const capabilities = Array.isArray(raw.capabilities) ? raw.capabilities : [];
  const output: AgentCapability[] = [];

  for (const skill of skills) {
    if (!skill || typeof skill !== "object") continue;
    const value = skill as Record<string, unknown>;
    const normalized = normalizeAgentCapability({
      kind: "task_submission",
      name: typeof value.name === "string" ? value.name : typeof value.id === "string" ? value.id : "A2A skill",
      description: typeof value.description === "string" ? value.description : null,
      endpoint,
      transport: "a2a",
      input_schema: Array.isArray(value.examples) ? { examples: value.examples } : null,
      metadata: {
        protocol: "a2a",
        skill_id: typeof value.id === "string" ? value.id : null,
        agent_name: typeof raw.name === "string" ? raw.name : null,
        provider: raw.provider ?? null,
        authentication: raw.authentication ?? null,
        capabilities,
        source_type: "a2a_agent_card",
      },
    }, sourceUrl);
    if (normalized) output.push(normalized);
  }

  const metadata = object(raw.capabilities);
  if (output.length === 0) {
    const normalized = normalizeAgentCapability({
      kind: "task_submission",
      name: typeof raw.name === "string" ? raw.name : "A2A agent",
      description: typeof raw.description === "string" ? raw.description : null,
      endpoint,
      transport: "a2a",
      auth: {
        required: Boolean(raw.authentication),
        type: typeof object(raw.authentication).schemes === "object" ? "declared" : null,
      },
      metadata: {
        protocol: "a2a",
        capabilities: metadata,
        source_type: "a2a_agent_card",
      },
    }, sourceUrl);
    if (normalized) output.push(normalized);
  }

  return output;
}

function jsonRpcEnvelope(method: string, id: string) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientInfo": {
          name: "AgentMarket",
          version: "testnet",
        },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  });
}

async function fetchJson(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Agent capability URL must use HTTP(S)");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(length) && length > MAX_BYTES) throw new Error("response too large");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error("response too large");
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMcpJsonRpc(url: string, method: string, id: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("MCP endpoint must use HTTP(S)");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      },
      body: jsonRpcEnvelope(method, id),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(length) && length > MAX_BYTES) throw new Error("response too large");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error("response too large");
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeMcpTools(document: unknown, endpoint: string): AgentCapability[] {
  const raw = object(document);
  const result = object(raw.result);
  const tools = Array.isArray(result.tools) ? result.tools : [];
  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object") return [];
    const value = tool as Record<string, unknown>;
    const normalized = normalizeAgentCapability({
      kind: "task_submission",
      name: typeof value.name === "string" ? value.name : "MCP tool",
      description: typeof value.description === "string" ? value.description : typeof value.title === "string" ? value.title : null,
      endpoint,
      transport: "mcp",
      methods: ["tools/call"],
      input_schema: value.inputSchema && typeof value.inputSchema === "object" ? value.inputSchema as Record<string, unknown> : null,
      metadata: {
        protocol: "mcp",
        source_type: "mcp_tools_list",
        annotations: value.annotations ?? null,
      },
    }, endpoint);
    return normalized ? [normalized] : [];
  });
}

export async function discoverAgentCapabilities(
  agent: Record<string, unknown>,
  registeredEndpoints: Array<Record<string, unknown>> = [],
): Promise<AgentCapabilitySnapshot> {
  const agentId = String(agent.agent_id || agent.id || "unknown");

  // Prefer the provider's canonical agent-provider/v1 manifest. When one is
  // available it is authoritative and prevents unrelated legacy/A2A/MCP probes.
  for (const endpoint of registeredEndpoints) {
    if (typeof endpoint.endpoint_url !== "string" || !endpoint.endpoint_url.trim()) continue;
    try {
      const manifest = await discoverAgentProviderManifest({
        endpoint_url: endpoint.endpoint_url,
        metadata: endpoint.metadata,
      });
      if (manifest) {
        const fallbackEndpoint = Object.values(manifest.endpoints)
          .find((operation) => operation.transport === "http" || operation.transport === "https")?.url || endpoint.endpoint_url;
        const capabilities = manifest.capabilities.flatMap((value) => {
          const normalized = normalizeAgentCapability({
            kind: "task_submission",
            name: typeof value.name === "string" ? value.name : manifest.name,
            description: typeof value.description === "string" ? value.description : manifest.description || null,
            endpoint: fallbackEndpoint,
            transport: "http",
            input_schema: value.input_schema || value.inputSchema || null,
            output_schema: value.output_schema || value.outputSchema || null,
            networks: manifest.networks || [],
            metadata: {
              ...(value.metadata && typeof value.metadata === "object" ? value.metadata : {}),
              protocol: manifest.protocols.join(","),
              source_type: "agent_provider_manifest",
              manifest_url: manifest.manifestUrl,
              manifest_endpoints: manifest.endpoints,
              hiring: manifest.hiring,
              execution: manifest.execution,
            },
          }, manifest.manifestUrl);
          return normalized ? [normalized] : [];
        });
        return {
          agent_id: agentId,
          discovered_at: new Date().toISOString(),
          source_urls: [manifest.manifestUrl],
          capabilities,
        };
      }
    } catch {
      // A provider without a usable canonical manifest may still use legacy discovery.
    }
  }

  const sourceUrls = [...new Set([...candidateUrls(agent), ...endpointCandidates(registeredEndpoints)])];
  const capabilities: AgentCapability[] = [];
  const successfulSources: string[] = [];

  for (const url of sourceUrls) {
    let discoveredFromA2A = false;
    for (const candidate of wellKnownCandidates(url)) {
      try {
        const document = await fetchJson(candidate);
        const discovered = normalizeA2ACard(document, candidate);
        if (discovered.length > 0) {
          capabilities.push(...discovered);
          successfulSources.push(candidate);
          discoveredFromA2A = true;
          break;
        }

        const generic = normalizeDocument(document, candidate);
        if (generic.length > 0) {
          capabilities.push(...generic);
          successfulSources.push(candidate);
          break;
        }
      } catch {
        // Continue to the next discovery mechanism.
      }
    }

    if (discoveredFromA2A) continue;

    for (const candidate of uniqueStrings([`${url.replace(/\/+$/, "")}/capabilities`, url])) {
      try {
        const document = await fetchJson(candidate);
        const discovered = normalizeDocument(document, candidate);
        if (discovered.length > 0) {
          capabilities.push(...discovered);
          successfulSources.push(candidate);
          break;
        }
      } catch {
        // Unsupported endpoints do not block discovery.
      }
    }

    for (const candidate of uniqueStrings([url, `${url.replace(/\/+$/, "")}/mcp`])) {
      try {
        const discovery = await fetchMcpJsonRpc(candidate, "server/discover", `discover-${Date.now()}`);
        const result = object(discovery).result;
        if (!result || typeof result !== "object") continue;
        const mcpCapability = normalizeAgentCapability({
          kind: "task_submission",
          name: "MCP server",
          description: typeof object(result).serverInfo === "object" ? String(object(object(result).serverInfo).description || "") || null : null,
          endpoint: candidate,
          transport: "mcp",
          methods: ["server/discover", "tools/list", "tools/call"],
          metadata: {
            protocol: "mcp",
            source_type: "mcp_server_discover",
            capabilities: object(result).capabilities ?? null,
            server_info: object(result).serverInfo ?? null,
            protocol_version: object(result).protocolVersion ?? MCP_PROTOCOL_VERSION,
          },
        }, candidate);
        if (mcpCapability) capabilities.push(mcpCapability);

        const tools = await fetchMcpJsonRpc(candidate, "tools/list", `tools-${Date.now()}`);
        const normalizedTools = normalizeMcpTools(tools, candidate);
        if (normalizedTools.length > 0) {
          capabilities.push(...normalizedTools);
          successfulSources.push(candidate);
        } else if (mcpCapability) {
          successfulSources.push(candidate);
        }
        break;
      } catch {
        // Not an MCP endpoint, or it requires a different auth/protocol mode.
      }
    }
  }

  return {
    agent_id: agentId,
    discovered_at: new Date().toISOString(),
    source_urls: [...new Set(successfulSources)],
    capabilities,
  };
}
