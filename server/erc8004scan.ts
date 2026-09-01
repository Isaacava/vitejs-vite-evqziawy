const BASE_URL = "https://api.8004scan.io/api/v1";

type JsonRecord = Record<string, unknown>;

type ExternalAgent = {
  agent_id: string;
  agent_registry: string | null;
  owner: string | null;
  name: string;
  description: string;
  image: string | null;
  chain_id: number | null;
  chain_name: string | null;
  services: Array<{ name: string; endpoint: string; version?: string; metadata?: JsonRecord }>;
  x402_support: boolean | null;
  supported_trust: string[];
  registrations: Array<{ agentId: string | number; agentRegistry: string }>;
  reputation_score: number | null;
  feedback_count: number | null;
  search_score: number | null;
  source: "8004scan";
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function unwrapResults(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const root = record(body);
  for (const key of ["agents", "items", "results", "data"]) {
    const nested = root[key];
    if (Array.isArray(nested)) return nested;
    if (nested && typeof nested === "object") {
      const deeper = record(nested);
      for (const nestedKey of ["agents", "items", "results"]) {
        if (Array.isArray(deeper[nestedKey])) return deeper[nestedKey] as unknown[];
      }
    }
  }
  return [];
}

function normalizeService(value: unknown) {
  const service = record(value);
  const endpoint = [service.endpoint, service.serviceEndpoint, service.url, service.uri]
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0) || "";
  return {
    name: stringValue(service.name, "unknown"),
    endpoint,
    ...(typeof service.version === "string" ? { version: service.version } : {}),
    metadata: service,
  };
}

function normalizeAgent(value: unknown, index: number): ExternalAgent {
  const a = record(value);
  const chain = record(a.chain);
  const rawRegistrations = arrayValue(a.registrations);
  const registrations = rawRegistrations.flatMap((entry) => {
    const item = record(entry);
    const agentId = item.agentId ?? item.agent_id;
    const agentRegistry = stringValue(item.agentRegistry, stringValue(item.agent_registry, ""));
    return agentId !== undefined && agentRegistry ? [{ agentId: typeof agentId === "number" || typeof agentId === "string" ? agentId : String(agentId), agentRegistry }] : [];
  });
  const services = arrayValue(a.services).map(normalizeService).filter((service) => service.endpoint);
  return {
    agent_id: stringValue(a.agent_id, stringValue(a.agentId, stringValue(a.id, String(index)))),
    agent_registry: stringValue(a.agentRegistry, stringValue(a.agent_registry, "")) || null,
    owner: stringValue(a.owner, stringValue(a.owner_address, stringValue(a.ownerAddress, ""))) || null,
    name: stringValue(a.name, `ERC-8004 Agent #${index}`),
    description: stringValue(a.description, "No description supplied."),
    image: stringValue(a.image, "") || null,
    chain_id: numberValue(a.chainId ?? a.chain_id ?? chain.chainId ?? chain.chain_id),
    chain_name: stringValue(a.chainName, stringValue(a.network, stringValue(chain.name, ""))) || null,
    services,
    x402_support: booleanValue(a.x402Support ?? a.x402_support),
    supported_trust: arrayValue(a.supportedTrust ?? a.supported_trust).filter((item): item is string => typeof item === "string"),
    registrations,
    reputation_score: numberValue(a.reputationScore ?? a.reputation_score ?? a.score),
    feedback_count: numberValue(a.feedbackCount ?? a.feedback_count ?? a.feedbacks),
    search_score: numberValue(a.searchScore ?? a.search_score ?? a.similarity ?? a.score),
    source: "8004scan",
  };
}

export async function search8004scan(query: string, limit = 8): Promise<ExternalAgent[]> {
  const q = query.trim();
  if (!q) return [];

  const apiKey = process.env.EIGHT004SCAN_API_KEY || process.env.ERC8004SCAN_API_KEY || "";
  const url = new URL(`${BASE_URL}/agents/search/semantic`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 24)));

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    if (!response.ok) throw new Error(`8004scan semantic search returned ${response.status}`);
    return unwrapResults(body).map(normalizeAgent);
  } finally {
    clearTimeout(timer);
  }
}

export type { ExternalAgent };
