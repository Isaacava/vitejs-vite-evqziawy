import { discoverAgentProviderManifest, manifestOperation, type AgentProviderOperation } from "./agent-provider-manifest.js";

type EndpointRecord = {
  endpoint_url: string;
  protocol: string;
  status: string;
  metadata?: unknown;
  version?: string | null;
};

export type ProviderAction = "quote" | "decision" | "execution_capabilities" | "authorization" | "execute" | "preflight" | "result" | "health";

type ProviderOperation = {
  action: ProviderAction;
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
  rawText: string;
  endpoint: string;
  method: string;
  transport: string;
};

const TIMEOUT_MS = 12_000;
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function urlIsHttp(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try { const parsed = new URL(value.trim()); return parsed.protocol === "http:" || parsed.protocol === "https:"; } catch { return false; }
}
function methods(value: unknown) {
  if (typeof value === "string") return [value.trim().toUpperCase()];
  if (!Array.isArray(value)) return [] as string[];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().toUpperCase());
}
function normalizeOperation(action: ProviderAction, value: Record<string, unknown>): ProviderOperation | null {
  const endpoint = [value.endpoint, value.endpoint_url, value.url, value.serviceEndpoint, value.service_endpoint, value.uri].find((candidate): candidate is string => urlIsHttp(candidate));
  if (!endpoint) return null;
  const declaredMethods = methods(value.methods ?? value.method);
  const invalidMethod = declaredMethods.length > 0 && !declaredMethods.some((method) => HTTP_METHODS.includes(method));
  if (invalidMethod) return null;
  const method = declaredMethods.find((candidate) => HTTP_METHODS.includes(candidate)) || "POST";
  const transport = text(value.transport || value.protocol).toLowerCase() || "http";
  const inputSchema = value.input_schema ?? value.inputSchema ?? value.request_schema ?? value.requestSchema ?? null;
  const metadata = value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) ? value.metadata as Record<string, unknown> : {};
  return { action, endpoint: endpoint.trim(), method, transport, name: text(value.name) || action, inputSchema: inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema) ? inputSchema as Record<string, unknown> : null, metadata };
}
function operationAliases(action: ProviderAction) {
  const aliases: Record<ProviderAction, string[]> = {
    quote: ["quote", "pricing", "price", "estimate", "negotiate"],
    decision: ["decision", "evaluate", "verdict", "policy"],
    execution_capabilities: ["execution_capabilities", "execution_capability", "capabilities", "capability", "execution_scope", "execution_capability_descriptor"],
    authorization: ["authorization", "authorize", "execution_authorization", "permission", "session"],
    execute: ["execute", "execution", "run", "invoke", "submit"],
    preflight: ["preflight", "preview", "validate", "check"],
    result: ["result", "job_response", "response", "output", "artifact"],
    health: ["health", "ready", "readiness", "ping"],
  };
  return aliases[action];
}
function explicitOperations(metadata: Record<string, unknown>, action: ProviderAction): Record<string, unknown>[] {
  const containers = [metadata.operations, metadata.provider_operations, metadata.providerOperations, metadata.actions, metadata.services];
  const aliases = operationAliases(action);
  const found: Record<string, unknown>[] = [];
  for (const container of containers) {
    if (Array.isArray(container)) {
      for (const item of container) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const value = item as Record<string, unknown>;
        const declared = text(value.action || value.operation || value.name || value.kind || value.capability || value.skill || value.task).toLowerCase();
        if (aliases.includes(declared)) found.push(value);
      }
      continue;
    }
    if (!container || typeof container !== "object" || Array.isArray(container)) continue;
    const map = container as Record<string, unknown>;
    for (const alias of aliases) {
      const value = map[alias];
      if (value && typeof value === "object" && !Array.isArray(value)) found.push(value as Record<string, unknown>);
    }
  }
  return found;
}
export async function resolveProviderOperation(endpoint: EndpointRecord, action: ProviderAction): Promise<ProviderOperation | null> {
  try {
    const manifest = await discoverAgentProviderManifest(endpoint);
    const live = manifest ? manifestOperation(manifest, action) : null;
    if (live && ["http", "https", "a2a"].includes(String(live.transport || "").toLowerCase())) {
      const normalized: AgentProviderOperation = live;
      return { action, endpoint: normalized.url, method: String(normalized.method || "POST").toUpperCase(), transport: String(normalized.transport || "http").toLowerCase(), name: text(normalized.name) || action, inputSchema: normalized.inputSchema || null, metadata: normalized.metadata || {} };
    }
  } catch {
    // Preserve compatibility with indexed provider metadata when live discovery is unavailable.
  }
  const endpointMetadata = object(endpoint.metadata);
  const declared = explicitOperations(endpointMetadata, action).map((value) => normalizeOperation(action, value)).find(Boolean) as ProviderOperation | undefined;
  return declared || null;
}
export function validateRequiredProviderOperation(operation: ProviderOperation | null, action: ProviderAction) {
  if (!operation) return { ok: false, reason: `${action} is not declared in the selected provider's Supabase metadata` };
  if (!urlIsHttp(operation.endpoint)) return { ok: false, reason: `${action} endpoint declared in Supabase metadata is invalid` };
  if (!HTTP_METHODS.includes(operation.method)) return { ok: false, reason: `${action} method declared in Supabase metadata is unsupported` };
  return { ok: true, reason: null };
}
function selectBody(action: ProviderAction, body: Record<string, unknown>) { return { action, ...body, request: body }; }
function materializeEndpoint(endpoint: string, body: Record<string, unknown>) {
  const template = endpoint.replace(/%7B(job_id|jobId|chain_job_id|chainJobId|id)%7D/gi, "{$1}");
  const aliases: Record<string, string[]> = {
    job_id: ["chain_job_id", "chainJobId", "provider_job_id", "job_id", "jobId"],
    jobId: ["chainJobId", "chain_job_id", "provider_job_id", "jobId", "job_id"],
    chain_job_id: ["chain_job_id", "chainJobId", "provider_job_id", "job_id", "jobId"],
    chainJobId: ["chainJobId", "chain_job_id", "provider_job_id", "jobId", "job_id"],
    id: ["chain_job_id", "chainJobId", "provider_job_id", "job_id", "jobId"],
  };
  return template.replace(/\{(job_id|jobId|chain_job_id|chainJobId|id)\}/g, (match, key: string) => {
    const value = aliases[key]?.map((candidate) => body[candidate]).find((candidate) => candidate !== undefined && candidate !== null);
    if (value === undefined) throw new Error(`Provider operation endpoint contains unresolved placeholder ${match}`);
    return encodeURIComponent(String(value));
  });
}
async function requestJson(operation: ProviderOperation, body: Record<string, unknown>): Promise<OperationResponse> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let endpoint = materializeEndpoint(operation.endpoint, body); let requestBody: string | undefined;
    if (operation.method === "GET") {
      const url = new URL(endpoint);
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") url.searchParams.set(key, String(value));
      }
      endpoint = url.toString();
    } else requestBody = JSON.stringify(selectBody(operation.action, body));
    const response = await fetch(endpoint, { method: operation.method, headers: { Accept: "application/json", "Content-Type": "application/json" }, body: requestBody, signal: controller.signal });
    const rawText = await response.text(); let parsed: unknown = {};
    try { parsed = rawText ? JSON.parse(rawText) : {}; } catch { parsed = { raw: rawText }; }
    return { status: response.status, body: parsed, rawText, endpoint, method: operation.method, transport: operation.transport };
  } finally { clearTimeout(timer); }
}
async function requestA2A(operation: ProviderOperation, body: Record<string, unknown>): Promise<OperationResponse> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS); const metadata = object(operation.metadata); const rpcMethod = text(metadata.rpc_method) || "message/send";
  const envelope = metadata.request_envelope && typeof metadata.request_envelope === "object" && !Array.isArray(metadata.request_envelope) ? object(metadata.request_envelope) : null;
  const requestPayload = envelope ? { ...envelope, ...body } : { method: rpcMethod, action: operation.action, ...body };
  try {
    const endpoint = materializeEndpoint(operation.endpoint, body); const response = await fetch(endpoint, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(requestPayload), signal: controller.signal });
    const rawText = await response.text(); let parsed: unknown = {};
    try { parsed = rawText ? JSON.parse(rawText) : {}; } catch { parsed = { raw: rawText }; }
    return { status: response.status, body: parsed, rawText, endpoint, method: "POST", transport: "a2a" };
  } finally { clearTimeout(timer); }
}
export async function invokeProviderOperation(operation: ProviderOperation, body: Record<string, unknown>): Promise<OperationResponse> {
  if (operation.transport === "a2a") return requestA2A(operation, body);
  return requestJson(operation, body);
}
