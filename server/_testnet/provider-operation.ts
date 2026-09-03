import { discoverAgentCapabilities } from "./agent-capabilities.js";

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
  const haystack = [
    capability.name,
    capability.description,
    capability.kind,
    object(capability.metadata).operation,
    object(capability.metadata).action,
    object(capability.metadata).capability,
    object(capability.metadata).skill_id,
  ].map(text).filter(Boolean).join(" ");

  if (action === "quote") return /(quote|pricing|price|estimate|negotiate|cost)/i.test(haystack);
  if (action === "execute") return /(execute|execution|run|submit|start|invoke)/i.test(haystack);
  if (action === "preflight") return /(preflight|preview|validate|check)/i.test(haystack);
  if (action === "result") return /(result|status|retrieve|job|output|deliver)/i.test(haystack);
  return /(health|ready|readiness)/i.test(haystack);
}

function methods(value: unknown) {
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
  const endpoint = typeof value.endpoint === "string" ? value.endpoint.trim() : "";
  if (!urlIsHttp(endpoint)) return null;
  const transport = typeof value.transport === "string" ? value.transport.toLowerCase() : "http";
  const declaredMethods = methods(value.methods);
  const method = declaredMethods.find((candidate) => ["GET", "POST", "PUT", "PATCH"].includes(candidate)) || (transport === "mcp" ? "POST" : "POST");
  return {
    action,
    endpoint,
    method,
    transport,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : action,
    inputSchema: value.input_schema && typeof value.input_schema === "object" ? value.input_schema as Record<string, unknown> : null,
    metadata: value.metadata && typeof value.metadata === "object" ? value.metadata as Record<string, unknown> : {},
  };
}

function explicitOperations(metadata: Record<string, unknown>, action: ProviderOperation["action"]) {
  const values = [metadata.operations, metadata.provider_operations, metadata.actions, metadata.services]
    .flatMap((candidate) => Array.isArray(candidate) ? candidate : []);
  return values.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const value = candidate as Record<string, unknown>;
    const declaredAction = text(value.action || value.operation || value.name || value.kind);
    const actionMatch = action === "quote"
      ? /(quote|pricing|price|estimate|negotiate|cost)/i.test(declaredAction)
      : action === "execute"
        ? /(execute|execution|run|submit|start|invoke)/i.test(declaredAction)
        : action === "preflight"
          ? /(preflight|preview|validate|check)/i.test(declaredAction)
          : action === "result"
            ? /(result|status|retrieve|job|output|deliver)/i.test(declaredAction)
            : /(health|ready|readiness)/i.test(declaredAction);
    return actionMatch ? [value] : [];
  });
}

export async function resolveProviderOperation(endpoint: EndpointRecord, action: ProviderOperation["action"]): Promise<ProviderOperation | null> {
  const endpointMetadata = object(endpoint.metadata);
  const direct = explicitOperations(endpointMetadata, action)
    .map((value) => normalizeOperation(action, value))
    .find(Boolean) as ProviderOperation | undefined;
  if (direct) return direct;

  const snapshot = await discoverAgentCapabilities({ id: "runtime", agent_id: "runtime", metadata: endpointMetadata }, [endpoint as Record<string, unknown>]);
  const discovered = snapshot.capabilities
    .filter((capability) => actionMatches(action, capability as unknown as Record<string, unknown>))
    .map((capability) => normalizeOperation(action, capability as unknown as Record<string, unknown>))
    .find(Boolean) as ProviderOperation | undefined;
  if (discovered) return discovered;

  // ERC-8183 remains a standards-based fallback only when the provider explicitly
  // advertises that protocol. AgentMarket never assumes a provider is ERC-8183 from
  // its name, category, or identity alone.
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
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
          url.searchParams.set(key, String(value));
        }
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
  } finally {
    clearTimeout(timer);
  }
}

async function requestMcp(operation: ProviderOperation, body: Record<string, unknown>): Promise<OperationResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const toolName = typeof object(operation.metadata).tool_name === "string" ? String(object(operation.metadata).tool_name) : operation.name;
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
  } finally {
    clearTimeout(timer);
  }
}

export async function invokeProviderOperation(operation: ProviderOperation, body: Record<string, unknown>): Promise<OperationResponse> {
  const result = operation.transport === "mcp" ? await requestMcp(operation, body) : await requestJson(operation, body);
  if (result.status < 200 || result.status >= 300) throw new Error(`Provider ${operation.action} returned HTTP ${result.status} from ${result.endpoint}`);
  return { ...result, body: responseBodyEnvelope(result.body) };
}
