import type { AgentCapability, AgentCapabilitySnapshot } from "../src/lib/agentCapability.js";
import { normalizeAgentCapability } from "../src/lib/agentCapability.js";

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 128 * 1024;

function object(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
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
  return candidates
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

function endpointCandidates(endpoints: Array<Record<string, unknown>>) {
  return endpoints
    .map((endpoint) => typeof endpoint.endpoint_url === "string" ? endpoint.endpoint_url.trim() : "")
    .filter(Boolean);
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

export async function discoverAgentCapabilities(
  agent: Record<string, unknown>,
  registeredEndpoints: Array<Record<string, unknown>> = [],
): Promise<AgentCapabilitySnapshot> {
  const agentId = String(agent.agent_id || agent.id || "unknown");
  const sourceUrls = [...new Set([...candidateUrls(agent), ...endpointCandidates(registeredEndpoints)])];
  const capabilities: AgentCapability[] = [];
  const successfulSources: string[] = [];

  for (const url of sourceUrls) {
    const candidates = [
      url,
      `${url.replace(/\/+$/, "")}/capabilities`,
      `${url.replace(/\/+$/, "")}/.well-known/agent-card.json`,
      `${url.replace(/\/+$/, "")}/agent-card`,
    ];
    for (const candidate of [...new Set(candidates)]) {
      try {
        const document = await fetchJson(candidate);
        const discovered = normalizeDocument(document, candidate);
        if (discovered.length > 0) {
          capabilities.push(...discovered);
          successfulSources.push(candidate);
          break;
        }
      } catch {
        // Capability discovery is best-effort. Unsupported endpoints do not block the agent.
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
