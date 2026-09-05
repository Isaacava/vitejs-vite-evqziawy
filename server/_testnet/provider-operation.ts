import { discoverAgentCapabilities } from "./agent-capabilities.js";
import { discoverAgentProviderManifest, manifestOperation, manifestToMetadata } from "./agent-provider-manifest.js";

type EndpointRecord = {
  endpoint_url: string;
  protocol: string;
  status: string;
  metadata?: unknown;
  version?: string | null;
};

type ProviderOperation = {
  action: "quote" | "execute" | "preflight" | "result" | "health";
  endpoint: string;
  method: string;
  transport: string;
  name: string;
  inputSchema?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

type OperationResponse = {
  status: number;
  body: unknown;
  endpoint: string;
  method: string;
  transport: string;
};

const TIMEOUT_MS = 12_000;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function actionMatches(action: ProviderOperation["action"], capability: Record<string, unknown>) {
  const metadata = object(capability.metadata);
  const haystack = [capability.name, capability.description, capability.kind, metadata.operation, metadata.action, metadata.capability, metadata.skill_id, metadata.task]
    .map(text).filter(Boolean).join(" ");
  if (action === "quote") return /(quote|pricing|price|estimate|negotiate|cost)/i.test(haystack);
  if (action === "execute") return /(execute|execution|run|submit|start|invoke|task)/i.test(haystack);
  if (action === "preflight") return /(preflight|preview|validate|check|dry.?run)/i.test(haystack);
  if (action === "result") return /(result|status|retrieve|job|output|deliver|artifact)/i.test(haystack);
  return /(health|ready|readiness|ping)/i.test(haystack);
}

function methods(value: unknown) {
  if (typeof value === "string") return [value.trim().toUpperCase()];
  if (!Array.isArray(value)) return [] as string[];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.toUpperCase());
}

function urlIsHttp(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeOperation(action: ProviderOperation["action"], value: Record<string, unknown>): ProviderOperation | null {
  const endpoint = [value.endpoint, value.endpoint_url, value.url, value.serviceEndpoint, value.service_endpoint, value.uri]
    .find((candidate): candidate is string => urlIsHttp(candidate)) || "";
  if (!endpoint) return null;
  const transport = typeof value.transport === "string"
    ? value.transport.trim().toLowerCase()
    : typeof value.protocol === "string" ? value.protocol.trim().toLowerCase() : "http";
  const declaredMethods = methods(value.methods ?? value.method);
  const method = declaredMethods.find((candidate) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(candidate)) || "POST";
  const inputSchema = value.input_schema ?? value.inputSchema ?? value.request_schema ?? value.requestSchema ?? null;
  return {
    action,
    endpoint,
    method,
    transport,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : action,
    inputSchema: inputSchema && typeof inputSchema === "object" ? inputSchema as Record<string, unknown> : null,
    metadata: value.metadata && typeof value.metadata === "object" ? value.metadata as Record<string, unknown> : {},
  };
}

function explicitOperations(metadata: Record<string, unknown>, action: ProviderOperation["action"]) {
  const values = [metadata.operations, metadata.provider_operations, metadata.providerOperations, metadata.actions, metadata.services]
    .flatMap((candidate) => Array.isArray(candidate) ? candidate : []);
  return values.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const value = candidate as Record<string, unknown>;
    const declaredAction = text(value.action || value.operation || value.name || value.kind || value.capability || value.skill || value.task);
    const actionMatch = action === "quote"
      ? /(quote|pricing|price|estimate|negotiate|cost)/i.test(declaredAction)
      : action === "execute"
        ? /(execute|execution|run|submit|start|invoke|task)/i.test(declaredAction)
        : action === "preflight"
          ? /(preflight|preview|validate|check|dry.?run)/i.test(declaredAction)
          : action === "result"
            ? /(result|status|retrieve|job|output|deliver|artifact)/i.test(declaredAction)
            : /(health|ready|readiness|ping)/i.test(declaredAction);
    return actionMatch ? [value] : [];
  });
}

async function manifestOperationFor(endpoint: EndpointRecord, action: ProviderOperation["action"]): Promise<ProviderOperation | null> {
  const manifest = await discoverAgentProviderManifest(endpoint);
  if (!manifest) return null;
  const operation = manifestOperation(manifest, action);
  if (!operation) return null;
  const metadata = {
    ...(operation.metadata || {}),
    manifest: manifestToMetadata(manifest),
    source: "agent-provider-manifest",
  };
  return {
    action,
    endpoint: operation.url,
    method: operation.method,
    transport: operation.transport,
    name: operation.name || action,
    inputSchema: operation.inputSchema || null,
    metadata,
  };
}

export async function resolveProviderOperation(endpoint: EndpointRecord, action: ProviderOperation["action"]): Promise<ProviderOperation | null> {
  // The provider manifest is authoritative. AgentMarket learns the operation URL,
  // HTTP method, transport and schemas from the agent instead of guessing them.
  try {
    const declared = await manifestOperationFor(endpoint, action);
    if (declared) return declared;
  } catch {
    // Compatibility paths below keep older providers working while they migrate.
  }

  const endpointMetadata = object(endpoint.metadata);
  const direct = explicitOperations(endpointMetadata, action)
    .map((value) => normalizeOperation(action, value))
    .find(Boolean) as ProviderOperation | undefined;
  if (direct) return direct;

  const snapshot = await discoverAgentCapabilities(
    { id: "runtime", agent_id: "runtime", metadata: endpointMetadata },
    [endpoint as Record<string, unknown>],
  );
  const discovered = snapshot.capabilities
    .filter((capability) => actionMatches(action, capability as unknown as Record<string, unknown>))
    .map((capability) => normalizeOperation(action, capability as unknown as Record<string, unknown>))
    .find(Boolean) as ProviderOperation | undefined;
  if (discovered) return discovered;

  // Standards fallback is retained only when the stored provider explicitly declares
  // ERC-8183. This never treats an agent category or identity as proof of protocol support.
  if (endpoint.protocol.toLowerCase() === "erc8183") {
    const base = endpoint.endpoint_url.replace(/\/+$/, "");
    if (action === "quote") return {
      action,
      endpoint: base.endsWith("/erc8183") ? `${base}/negotiate` : `${base}/erc8183/negotiate`,
      method: "POST",
      transport: "http",
      name: "ERC-8183 negotiation",
      inputSchema: null,
      metadata: { fallback: "erc8183" },
    };
  }
  return null;
}

export function validateRequiredProviderOperation(operation: ProviderOperation | null, action: ProviderOperation["action"]) {
  if (!operation) return { ok: false, reason: `${action} is not declared or discoverable` };
  if (!urlIsHttp(operation.endpoint)) return { ok: false, reason: `${action} endpoint is invalid` };
  return { ok: true, reason: null };
}

function selectBody(action: ProviderOperation["action"], body: Record<string, unknown>) {
  return { action, ...body, request: body };
}

function responseBodyEnvelope(body: unknown) {
  const root = object(body);
  for (const key of ["data", "result", "response", "quote", "output", "job", "operation_result"]) {
    if (root[key] && typeof root[key] === "object") return root[key];
  }
  return body;
}

async function requestJson(operation: ProviderOperation, body: Record<string, unknown>): Promise<OperationResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let endpoint = operation.endpoint;
    let requestBody: string | undefined;
    if (operation.method === "GET") {
      const url = new URL(endpoint);
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") url.searchParams.set(key, String(value));
      }
      endpoint = url.toString();
    } else {
      requestBody = JSON.stringify(selectBody(operation.action, body));
    }
    const response = await fetch(endpoint, {
      method: operation.method,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: requestBody,
      signal: controller.signal,
    });
    const raw = await response.text();
    let parsed: unknown = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; }
    return { status: response.status, body: parsed, endpoint, method: operation.method, transport: operation.transport };
  } finally { clearTimeout(timer); }
}

async function requestA2A(operation: ProviderOperation, body: Record<string, unknown>): Promise<OperationResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const metadata = object(operation.metadata);
  const rpcMethod = typeof metadata.rpc_method === "string" && metadata.rpc_method.trim() ? metadata.rpc_method.trim() : "message/send";
  const envelope = metadata.request_envelope && typeof metadata.request_envelope === "object" ? object(metadata.request_envelope) : null;
  const requestPayload = envelope ? { ...envelope, ...body } : { method: rpcMethod, action: operation.action, ...body };
  try {
    const response = await fetch(operation.endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });
    const raw = await response.text();
    let parsed: unknown = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; }
    return { status: response.status, body: parsed, endpoint: operation.endpoint, method: "POST", transport: "a2a" };
  } finally { clearTimeout(timer); }
}

async function requestMcp(operation: ProviderOperation, body: Record<string, unknown>): Promise<OperationResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const metadata = object(operation.metadata);
  const toolName = typeof metadata.tool_name === "string" ? metadata.tool_name : operation.name;
  try {
    const response = await fetch(operation.endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: `agentmarket-${Date.now()}`, method: "tools/call", params: { name: toolName, arguments: selectBody(operation.action, body) } }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let parsed: unknown = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; }
    return { status: response.status, body: parsed, endpoint: operation.endpoint, method: "POST", transport: "mcp" };
  } finally { clearTimeout(timer); }
}

export async function invokeProviderOperation(operation: ProviderOperation, body: Record<string, unknown>): Promise<OperationResponse> {
  const result = operation.transport === "mcp"
    ? await requestMcp(operation, body)
    : operation.transport === "a2a"
      ? await requestA2A(operation, body)
      : await requestJson(operation, body);
  if (result.status < 200 || result.status >= 300) throw new Error(`Provider ${operation.action} returned HTTP ${result.status} from ${result.endpoint}`);
  return { ...result, body: responseBodyEnvelope(result.body) };
}
