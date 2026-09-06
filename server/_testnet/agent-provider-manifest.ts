type JsonObject = Record<string, unknown>;

export type AgentProviderOperation = {
  url: string;
  method: string;
  transport: string;
  capability?: string | null;
  name?: string | null;
  inputSchema?: JsonObject | null;
  outputSchema?: JsonObject | null;
  authentication?: JsonObject | null;
  async?: boolean;
  metadata: JsonObject;
};

export type AgentProviderManifest = {
  spec: "agent-provider/v1";
  name: string;
  description?: string;
  version: string;
  agent?: JsonObject;
  protocols: string[];
  networks?: JsonObject[];
  capabilities: JsonObject[];
  endpoints: Record<string, AgentProviderOperation>;
  hiring?: JsonObject;
  execution?: JsonObject;
  discovery?: JsonObject;
  metadata?: JsonObject;
  manifestUrl: string;
  resolvedAt: string;
};

type EndpointRecord = { endpoint_url: string; metadata?: unknown };
type OperationName = "health" | "quote" | "decision" | "authorization" | "preflight" | "execute" | "result";
const OPERATIONS: OperationName[] = ["health", "quote", "decision", "authorization", "preflight", "execute", "result"];
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 512 * 1024;

function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function unique(values: Array<string | null | undefined>) { return [...new Set(values.filter((v): v is string => Boolean(v && v.trim())).map((v) => v.trim()))]; }
function isHttpUrl(value: string) { try { const p = new URL(value); return p.protocol === "http:" || p.protocol === "https:"; } catch { return false; } }
function resolveUrl(value: string, base: string) { try { const url = new URL(value, base).toString(); return isHttpUrl(url) ? url : null; } catch { return null; } }
function normalizeProviderOperationUrl(value: string, manifestUrl: string) {
  try {
    const resolved = new URL(value), manifest = new URL(manifestUrl);
    if (manifest.protocol === "https:" && resolved.protocol === "http:" && resolved.hostname === manifest.hostname && resolved.port === manifest.port) resolved.protocol = "https:";
    return resolved.toString();
  } catch { return value; }
}
function discoveryBaseCandidates(endpointUrl: string): string[] {
  try {
    const p = new URL(endpointUrl), parts = p.pathname.split("/").filter(Boolean), bases = [p.origin];
    for (let length = parts.length - 1; length >= 0; length -= 1) { bases.push(`${p.origin}/${parts.slice(0, length).join("/")}`.replace(/\/$/, "")); if (bases.length >= 5) break; }
    if (parts.some((part) => part.toLowerCase() === "erc8183")) bases.unshift(`${p.origin}/erc8183`);
    return unique(bases);
  } catch { return []; }
}
function manifestCandidates(endpoint: EndpointRecord): string[] {
  const metadata = object(endpoint.metadata), base = endpoint.endpoint_url.replace(/\/+$/, ""), bases = discoveryBaseCandidates(endpoint.endpoint_url);
  const explicit = [metadata.manifest_url, metadata.manifestUrl, metadata.agent_manifest_url, metadata.agentManifestUrl, metadata.canonical_manifest_url, text(object(metadata.discovery).canonical_url)];
  const candidates = [...explicit.filter((v): v is string => typeof v === "string" && v.trim()).map((v) => v.trim()), `${base}/agent.json`, `${base}/.well-known/agent.json`, `${base}/.well-known/agent-provider.json`];
  for (const candidateBase of bases) candidates.push(`${candidateBase}/agent.json`, `${candidateBase}/.well-known/agent.json`, `${candidateBase}/.well-known/agent-provider.json`);
  candidates.push(endpoint.endpoint_url, base, ...bases);
  return unique(candidates);
}
async function fetchManifest(url: string): Promise<JsonObject> {
  const parsed = new URL(url); if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Agent manifest must use HTTP(S)");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") || 0); if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) throw new Error("manifest too large");
    const body = await response.text(); if (new TextEncoder().encode(body).byteLength > MAX_BYTES) throw new Error("manifest too large");
    const parsedBody: unknown = body ? JSON.parse(body) : null; if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) throw new Error("manifest must be a JSON object");
    return parsedBody as JsonObject;
  } finally { clearTimeout(timer); }
}
function normalizeOperation(value: unknown, manifestUrl: string): AgentProviderOperation | null {
  if (typeof value === "string") { const url = resolveUrl(value, manifestUrl); return url ? { url: normalizeProviderOperationUrl(url, manifestUrl), method: "POST", transport: "http", metadata: {} } : null; }
  const raw = object(value), candidate = [raw.url, raw.endpoint, raw.endpoint_url, raw.uri, raw.serviceEndpoint, raw.service_endpoint].find((v): v is string => typeof v === "string" && v.trim());
  if (!candidate) return null;
  const resolvedUrl = resolveUrl(candidate, manifestUrl); if (!resolvedUrl) return null;
  const methods = Array.isArray(raw.methods) ? raw.methods.filter((v): v is string => typeof v === "string") : [text(raw.method)].filter((v): v is string => Boolean(v));
  const method = methods.map((v) => v.toUpperCase()).find((v) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(v)) || "POST";
  return {
    url: normalizeProviderOperationUrl(resolvedUrl, manifestUrl), method, transport: text(raw.transport ?? raw.protocol) || "http",
    capability: text(raw.capability), name: text(raw.name),
    inputSchema: Object.keys(object(raw.input_schema ?? raw.inputSchema)).length ? object(raw.input_schema ?? raw.inputSchema) : null,
    outputSchema: Object.keys(object(raw.output_schema ?? raw.outputSchema)).length ? object(raw.output_schema ?? raw.outputSchema) : null,
    authentication: Object.keys(object(raw.authentication ?? raw.auth)).length ? object(raw.authentication ?? raw.auth) : null,
    async: typeof raw.async === "boolean" ? raw.async : undefined,
    metadata: object(raw.metadata),
  };
}
function metadataCapabilities(agent: JsonObject) {
  const metadata = object(agent.metadata), candidates = [metadata.capabilities, metadata.agent_capabilities, metadata.skills];
  return candidates.flatMap((v) => Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as JsonObject[] : []);
}
function syntheticCapability(raw: JsonObject, endpoint: EndpointRecord): JsonObject { return { id: text(raw.agent_kind) || text(raw.service) || "legacy-erc8183-provider", name: text(raw.service) || text(raw.agent_kind) || "Legacy ERC-8183 Provider", description: text(raw.description) || `Legacy ERC-8183 provider discovered from ${endpoint.endpoint_url}`, metadata: { source: "legacy-erc8183-root" } }; }

function normalizeManifest(raw: JsonObject, manifestUrl: string): AgentProviderManifest | null {
  if (raw.spec !== "agent-provider/v1") return null;
  const name = text(raw.name), version = text(raw.version), protocols = Array.isArray(raw.protocols) ? raw.protocols.filter((v): v is string => typeof v === "string" && v.trim()) : [];
  if (!name || !version || protocols.length === 0) return null;
  const rawEndpoints = object(raw.endpoints), endpoints: Record<string, AgentProviderOperation> = {};
  for (const key of OPERATIONS) { const op = normalizeOperation(rawEndpoints[key], manifestUrl); if (op) endpoints[key] = op; }
  // Providers may advertise the standardized capability route separately from authorization.
  // The current execution-capital preparation flow uses the authorization slot only to
  // discover a verified execution descriptor, so a declared execution-capabilities route
  // is preferred whenever the authorization declaration is merely a POST request trigger.
  if (endpoints.authorization && endpoints.authorization.method === "POST") {
    const capability = normalizeOperation(rawEndpoints.execution_capabilities ?? rawEndpoints.executionCapabilities ?? rawEndpoints.capabilities, manifestUrl);
    if (capability) endpoints.authorization = capability;
  }
  return {
    spec: "agent-provider/v1", name, description: text(raw.description) || undefined, version,
    agent: object(raw.agent), protocols,
    networks: Array.isArray(raw.networks) ? raw.networks.filter((v) => v && typeof v === "object") as JsonObject[] : [],
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.filter((v) => v && typeof v === "object") as JsonObject[] : [],
    endpoints, hiring: object(raw.hiring), execution: object(raw.execution), discovery: object(raw.discovery), metadata: object(raw.metadata), manifestUrl, resolvedAt: new Date().toISOString(),
  };
}

function normalizeLegacyErc8183Root(raw: JsonObject, endpoint: EndpointRecord, sourceUrl: string): AgentProviderManifest | null {
  const rawEndpoints = object(raw.endpoints); if (!Object.keys(rawEndpoints).length) return null;
  const aliases: Record<string, OperationName> = { health: "health", negotiate: "quote", quote: "quote", decision: "decision", authorization: "authorization", execution_authorization: "authorization", preflight: "preflight", execute: "execute", job_response: "result", response: "result", result: "result" };
  const endpoints: Record<string, AgentProviderOperation> = {};
  for (const key of Object.keys(rawEndpoints)) { const operation = aliases[key]; if (!operation) continue; const normalized = normalizeOperation(rawEndpoints[key], sourceUrl); if (!normalized || endpoints[operation]) continue; endpoints[operation] = normalized; }
  // Legacy ERC-8183 roots commonly expose execution_capabilities as a separate GET route.
  // When the declared authorization operation is POST, use that standard GET descriptor
  // as the discovery operation consumed by execution-capital preparation.
  if (endpoints.authorization && endpoints.authorization.method === "POST") {
    const capabilityRaw = rawEndpoints.execution_capabilities ?? rawEndpoints.executionCapabilities ?? rawEndpoints.capabilities;
    const capability = normalizeOperation(capabilityRaw, sourceUrl); if (capability) endpoints.authorization = capability;
  }
  if (!endpoints.health) { const fallback = normalizeOperation("/erc8183/health", sourceUrl); if (fallback) endpoints.health = fallback; }
  if (!endpoints.quote) { const fallback = normalizeOperation("/erc8183/negotiate", sourceUrl); if (fallback) endpoints.quote = fallback; }
  if (!endpoints.result) { const fallback = normalizeOperation("/erc8183/job/{job_id}/response", sourceUrl); if (fallback) endpoints.result = fallback; }
  const capabilities = metadataCapabilities(endpoint); if (!capabilities.length) capabilities.push(syntheticCapability(raw, endpoint));
  const metadata = object(endpoint.metadata), name = text(metadata.agent_name) || text(metadata.display_name) || text(raw.service) || text(raw.agent_kind) || "ERC-8183 Provider";
  return {
    spec: "agent-provider/v1", name, description: text(metadata.description) || text(raw.description) || `Legacy ERC-8183 provider discovered from ${sourceUrl}`, version: "legacy-erc8183",
    agent: { address: text(raw.agent_address) || text(raw.provider_address) || null, kind: text(raw.agent_kind) || null }, protocols: ["erc8183"],
    networks: [{ name: text(raw.network) || "bsc-testnet", chain_id: Number(raw.chain_id || 97) }], capabilities, endpoints,
    hiring: { protocol: "erc8183", required_operations: ["quote", "result"], compatibility: "legacy-root-discovery" },
    execution: { mode: endpoints.execute ? "declared-execute" : "provider-watcher", legacy: true },
    discovery: { source: "legacy-erc8183-root", synthetic: true }, metadata: { synthetic_manifest: true, source_url: sourceUrl, source_service: text(raw.service) || null }, manifestUrl: sourceUrl, resolvedAt: new Date().toISOString(),
  };
}

export async function discoverAgentProviderManifest(endpoint: EndpointRecord): Promise<AgentProviderManifest | null> {
  for (const candidate of manifestCandidates(endpoint)) {
    try { const document = await fetchManifest(candidate); const manifest = normalizeManifest(document, candidate); if (manifest) return manifest; const legacy = normalizeLegacyErc8183Root(document, endpoint, candidate); if (legacy) return legacy; } catch { /* try next discovery source */ }
  }
  return null;
}
export function manifestOperation(manifest: AgentProviderManifest, action: OperationName): AgentProviderOperation | null { return manifest.endpoints[action] || null; }
export function requiredHiringOperations(manifest: AgentProviderManifest, protocol = "") {
  if (protocol.trim().toLowerCase() === "erc8183") return ["quote", "result"] as OperationName[];
  const required = object(manifest.hiring).required_operations;
  if (Array.isArray(required)) { const operations = required.filter((v): v is OperationName => typeof v === "string" && OPERATIONS.includes(v as OperationName)); if (operations.length) return operations; }
  return ["quote", "result"] as OperationName[];
}
export function manifestToMetadata(manifest: AgentProviderManifest) {
  return {
    spec: manifest.spec, manifest_url: manifest.manifestUrl, manifest_resolved_at: manifest.resolvedAt, manifest_name: manifest.name, manifest_version: manifest.version,
    manifest_protocols: manifest.protocols, manifest_hiring: manifest.hiring, manifest_execution: manifest.execution, manifest_discovery: manifest.discovery, manifest_synthetic: manifest.metadata?.synthetic_manifest === true,
    manifest_endpoints: Object.fromEntries(Object.entries(manifest.endpoints).map(([name, op]) => [name, { endpoint: op.url, method: op.method, transport: op.transport, capability: op.capability || null, name: op.name || null, input_schema: op.inputSchema || null, output_schema: op.outputSchema || null, authentication: op.authentication || null, async: op.async ?? false, metadata: op.metadata }])),
  };
}
