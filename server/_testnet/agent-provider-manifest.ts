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

type EndpointRecord = {
  endpoint_url: string;
  metadata?: unknown;
};

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 512 * 1024;
const OPERATIONS = ["health", "quote", "decision", "authorization", "preflight", "execute", "result"] as const;

type OperationName = typeof OPERATIONS[number];

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim()))];
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveUrl(value: string, base: string) {
  try {
    const resolved = new URL(value, base).toString();
    return isHttpUrl(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function discoveryBaseCandidates(endpointUrl: string): string[] {
  try {
    const parsed = new URL(endpointUrl);
    const origin = parsed.origin;
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const bases = [origin];
    for (let length = pathParts.length - 1; length >= 0; length -= 1) {
      bases.push(`${origin}/${pathParts.slice(0, length).join("/")}`.replace(/\/$/, ""));
      if (bases.length >= 5) break;
    }
    if (pathParts.some((part) => part.toLowerCase() === "erc8183")) bases.unshift(`${origin}/erc8183`);
    return unique(bases);
  } catch {
    return [];
  }
}

function manifestCandidates(endpoint: EndpointRecord): string[] {
  const metadata = object(endpoint.metadata);
  const explicit = [
    text(metadata.manifest_url),
    text(metadata.manifestUrl),
    text(metadata.agent_manifest_url),
    text(metadata.agentManifestUrl),
    text(metadata.canonical_manifest_url),
    text(object(metadata.discovery).canonical_url),
  ];

  const base = endpoint.endpoint_url.replace(/\/+$/, "");
  const bases = discoveryBaseCandidates(endpoint.endpoint_url);
  const candidates: string[] = [
    ...explicit,
    endpoint.endpoint_url,
    `${base}/agent.json`,
    `${base}/.well-known/agent.json`,
    `${base}/.well-known/agent-provider.json`,
  ];

  for (const candidateBase of bases) {
    candidates.push(
      candidateBase,
      `${candidateBase}/agent.json`,
      `${candidateBase}/.well-known/agent.json`,
      `${candidateBase}/.well-known/agent-provider.json`,
    );
  }
  return unique(candidates);
}

async function fetchManifest(url: string): Promise<JsonObject> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Agent manifest must use HTTP(S)");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) throw new Error("manifest too large");
    const textBody = await response.text();
    if (new TextEncoder().encode(textBody).byteLength > MAX_BYTES) throw new Error("manifest too large");
    const parsedBody: unknown = textBody ? JSON.parse(textBody) : null;
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) throw new Error("manifest must be a JSON object");
    return parsedBody as JsonObject;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeOperation(value: unknown, manifestUrl: string): AgentProviderOperation | null {
  if (typeof value === "string") {
    const url = resolveUrl(value, manifestUrl);
    return url ? { url, method: "POST", transport: "http", metadata: {} } : null;
  }
  const raw = object(value);
  const candidate = [raw.url, raw.endpoint, raw.endpoint_url, raw.uri, raw.serviceEndpoint, raw.service_endpoint]
    .find((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (!candidate) return null;
  const url = resolveUrl(candidate, manifestUrl);
  if (!url) return null;
  const declaredMethods = Array.isArray(raw.methods)
    ? raw.methods.filter((method): method is string => typeof method === "string")
    : [text(raw.method)].filter((method): method is string => Boolean(method));
  const method = declaredMethods.map((method) => method.toUpperCase()).find((method) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) || "POST";
  const inputSchema = object(raw.input_schema ?? raw.inputSchema);
  const outputSchema = object(raw.output_schema ?? raw.outputSchema);
  const authentication = object(raw.authentication ?? raw.auth);
  return {
    url,
    method,
    transport: text(raw.transport ?? raw.protocol) || "http",
    capability: text(raw.capability),
    name: text(raw.name),
    inputSchema: Object.keys(inputSchema).length ? inputSchema : null,
    outputSchema: Object.keys(outputSchema).length ? outputSchema : null,
    authentication: Object.keys(authentication).length ? authentication : null,
    async: typeof raw.async === "boolean" ? raw.async : undefined,
    metadata: object(raw.metadata),
  };
}

function normalizeManifest(raw: JsonObject, manifestUrl: string): AgentProviderManifest | null {
  if (raw.spec !== "agent-provider/v1") return null;
  const name = text(raw.name);
  const version = text(raw.version);
  const protocols = Array.isArray(raw.protocols) ? unique(raw.protocols.map((value) => typeof value === "string" ? value : null)) : [];
  const capabilities = Array.isArray(raw.capabilities)
    ? raw.capabilities.filter((value): value is JsonObject => Boolean(value && typeof value === "object" && !Array.isArray(value))).map(object)
    : [];
  if (!name || !version || protocols.length === 0 || capabilities.length === 0) return null;

  const rawEndpoints = object(raw.endpoints);
  const endpoints: Record<string, AgentProviderOperation> = {};
  for (const operation of Object.keys(rawEndpoints)) {
    const normalized = normalizeOperation(rawEndpoints[operation], manifestUrl);
    if (normalized) endpoints[operation] = normalized;
  }

  return {
    spec: "agent-provider/v1",
    name,
    description: text(raw.description) || undefined,
    version,
    agent: object(raw.agent),
    protocols,
    networks: Array.isArray(raw.networks) ? raw.networks.filter((value): value is JsonObject => Boolean(value && typeof value === "object" && !Array.isArray(value))).map(object) : undefined,
    capabilities,
    endpoints,
    hiring: object(raw.hiring),
    execution: object(raw.execution),
    discovery: object(raw.discovery),
    metadata: object(raw.metadata),
    manifestUrl,
    resolvedAt: new Date().toISOString(),
  };
}

function metadataCapabilities(endpoint: EndpointRecord): JsonObject[] {
  const metadata = object(endpoint.metadata);
  const candidates = [metadata.capabilities, metadata.capability_profile, metadata.provider_capabilities];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const values = candidate
      .filter((value): value is JsonObject => Boolean(value && typeof value === "object" && !Array.isArray(value)))
      .map(object);
    if (values.length > 0) return values;
  }
  return [];
}

function syntheticCapability(document: JsonObject, endpoint: EndpointRecord): JsonObject {
  const metadata = object(endpoint.metadata);
  const kind = text(document.agent_kind) || text(metadata.agent_kind) || text(document.service) || "agent-provider";
  const name = text(document.service) || text(document.agent_kind) || kind;
  return {
    id: `legacy:${kind}`,
    kind: "task_submission",
    name,
    description: `Legacy ERC-8183 provider capability discovered from ${endpoint.endpoint_url}`,
    transport: "http",
    protocol: "erc8183",
    source_type: "legacy_erc8183_root",
  };
}

function normalizeLegacyErc8183Root(raw: JsonObject, endpoint: EndpointRecord, sourceUrl: string): AgentProviderManifest | null {
  const rawEndpoints = object(raw.endpoints);
  const endpointEntries = Object.keys(rawEndpoints);
  const looksLikeErc8183 = endpointEntries.length > 0
    && (text(raw.service)?.toLowerCase().includes("erc-8183") || text(raw.service)?.toLowerCase().includes("erc8183") || text(raw.network) === "bsc-testnet" || raw.chain_id === 97 || endpointEntries.some((key) => ["negotiate", "execution_capabilities", "job_response"].includes(key)));
  if (!looksLikeErc8183) return null;

  const endpoints: Record<string, AgentProviderOperation> = {};
  const aliases: Record<string, OperationName> = {
    health: "health",
    quote: "quote",
    negotiate: "quote",
    decision: "decision",
    authorization: "authorization",
    preflight: "preflight",
    execute: "execute",
    result: "result",
    job_response: "result",
  };

  for (const key of endpointEntries) {
    const operation = aliases[key];
    if (!operation) continue;
    const normalized = normalizeOperation(rawEndpoints[key], sourceUrl);
    if (!normalized || endpoints[operation]) continue;
    endpoints[operation] = normalized;
  }

  if (!endpoints.health) {
    const fallback = normalizeOperation("/erc8183/health", sourceUrl);
    if (fallback) endpoints.health = fallback;
  }
  if (!endpoints.quote) {
    const fallback = normalizeOperation("/erc8183/negotiate", sourceUrl);
    if (fallback) endpoints.quote = fallback;
  }
  if (!endpoints.result) {
    const fallback = normalizeOperation("/erc8183/job/{job_id}/response", sourceUrl);
    if (fallback) endpoints.result = fallback;
  }

  const metadata = object(endpoint.metadata);
  const capabilities = metadataCapabilities(endpoint);
  if (capabilities.length === 0) capabilities.push(syntheticCapability(raw, endpoint));

  const name = text(metadata.agent_name) || text(metadata.display_name) || text(raw.service) || text(raw.agent_kind) || "ERC-8183 Provider";
  const description = text(metadata.description) || text(raw.description) || `Legacy ERC-8183 provider discovered from ${sourceUrl}`;
  return {
    spec: "agent-provider/v1",
    name,
    description,
    version: "legacy-erc8183",
    agent: {
      address: text(raw.agent_address) || text(raw.provider_address) || null,
      kind: text(raw.agent_kind) || null,
    },
    protocols: ["erc8183"],
    networks: [{ name: text(raw.network) || "bsc-testnet", chain_id: Number(raw.chain_id || 97) }],
    capabilities,
    endpoints,
    hiring: { protocol: "erc8183", required_operations: ["quote", "result"], compatibility: "legacy-root-discovery" },
    execution: {
      mode: endpoints.execute ? "declared-execute" : "provider-watcher",
      legacy: true,
    },
    discovery: {
      source: "legacy-erc8183-root",
      synthetic: true,
    },
    metadata: {
      synthetic_manifest: true,
      source_url: sourceUrl,
      source_service: text(raw.service) || null,
    },
    manifestUrl: sourceUrl,
    resolvedAt: new Date().toISOString(),
  };
}

export async function discoverAgentProviderManifest(endpoint: EndpointRecord): Promise<AgentProviderManifest | null> {
  for (const candidate of manifestCandidates(endpoint)) {
    try {
      const document = await fetchManifest(candidate);
      const manifest = normalizeManifest(document, candidate);
      if (manifest) return manifest;
      const legacy = normalizeLegacyErc8183Root(document, endpoint, candidate);
      if (legacy) return legacy;
    } catch {
      // Continue to the next canonical/compatibility candidate.
    }
  }
  return null;
}

export function manifestOperation(manifest: AgentProviderManifest, action: OperationName): AgentProviderOperation | null {
  return manifest.endpoints[action] || null;
}

export function requiredHiringOperations(manifest: AgentProviderManifest, protocol = "") {
  const normalizedProtocol = protocol.trim().toLowerCase();
  if (normalizedProtocol === "erc8183") return ["quote", "result"] as OperationName[];
  const explicitlyRequired = object(manifest.hiring).required_operations;
  if (Array.isArray(explicitlyRequired)) {
    const operations = explicitlyRequired.filter((value): value is OperationName => typeof value === "string" && OPERATIONS.includes(value as OperationName));
    if (operations.length > 0) return operations;
  }
  return ["quote", "result"] as OperationName[];
}

export function manifestToMetadata(manifest: AgentProviderManifest) {
  return {
    spec: manifest.spec,
    manifest_url: manifest.manifestUrl,
    manifest_resolved_at: manifest.resolvedAt,
    manifest_name: manifest.name,
    manifest_version: manifest.version,
    manifest_protocols: manifest.protocols,
    manifest_hiring: manifest.hiring,
    manifest_execution: manifest.execution,
    manifest_discovery: manifest.discovery,
    manifest_synthetic: manifest.metadata?.synthetic_manifest === true,
    manifest_endpoints: Object.fromEntries(Object.entries(manifest.endpoints).map(([name, operation]) => [name, {
      endpoint: operation.url,
      method: operation.method,
      transport: operation.transport,
      capability: operation.capability || null,
      name: operation.name || null,
      input_schema: operation.inputSchema || null,
      output_schema: operation.outputSchema || null,
      authentication: operation.authentication || null,
      async: operation.async ?? false,
      metadata: operation.metadata,
    }])),
  };
}
