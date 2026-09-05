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
  return unique([
    ...explicit,
    endpoint.endpoint_url,
    `${base}/agent.json`,
    `${base}/.well-known/agent.json`,
    `${base}/.well-known/agent-provider.json`,
  ]);
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

export async function discoverAgentProviderManifest(endpoint: EndpointRecord): Promise<AgentProviderManifest | null> {
  for (const candidate of manifestCandidates(endpoint)) {
    try {
      const document = await fetchManifest(candidate);
      const manifest = normalizeManifest(document, candidate);
      if (manifest) return manifest;
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
