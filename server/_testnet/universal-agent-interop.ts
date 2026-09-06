import type { AgentCapability, AgentCapabilitySnapshot } from "../../src/lib/agentCapability.js";
import { discoverAgentCapabilities } from "./agent-capabilities.js";

type JsonRecord = Record<string, unknown>;

export type AgentOperationKind = "quote" | "execute" | "preflight" | "capability" | "task" | "health" | "unknown";

export type AgentOperation = {
  kind: AgentOperationKind;
  protocol: "a2a" | "mcp" | "openapi" | "http" | "erc8183" | "unknown";
  endpoint: string;
  method: string | null;
  name: string;
  description: string | null;
  input_schema: JsonRecord | null;
  output_schema: JsonRecord | null;
  auth: JsonRecord | null;
  evidence: "explicit" | "strong" | "inferred";
  metadata: JsonRecord;
};

export type UniversalAgentInterop = {
  agent_id: string;
  operations: AgentOperation[];
  capabilities: AgentCapabilitySnapshot;
  discovery_errors: string[];
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function strings(...values: unknown[]) {
  return [...new Set(values.flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim()))];
}

function classify(text: string): AgentOperationKind {
  const value = text.toLowerCase();
  if (/\b(quote|price|estimate|preview|pricing|valuation|cost|fee)\b/.test(value)) return "quote";
  if (/\b(preflight|dry.?run|simulate|simulation)\b/.test(value)) return "preflight";
  if (/\b(execution.?capabilit|capabilit(y|ies)|permissions?|authorization|session)\b/.test(value)) return "capability";
  if (/\b(execute|execution|trade|swap|rebalance|transact|transaction|submit|run.?strategy|place.?order)\b/.test(value)) return "execute";
  if (/\b(health|status|ping)\b/.test(value)) return "health";
  if (/\b(task|job|request|solve)\b/.test(value)) return "task";
  return "unknown";
}

function baseProtocolFromTransport(transport: string | undefined): AgentOperation["protocol"] {
  const value = (transport || "").toLowerCase();
  if (value === "a2a") return "a2a";
  if (value === "mcp") return "mcp";
  return "http";
}

function operationFromCapability(capability: AgentCapability): AgentOperation {
  const text = `${capability.name} ${capability.description || ""} ${JSON.stringify(capability.metadata || {})}`;
  let kind: AgentOperationKind = capability.kind === "execution" ? "execute" : classify(text);
  if (kind === "unknown" && capability.kind === "task_submission") kind = "task";
  return {
    kind,
    protocol: baseProtocolFromTransport(capability.transport),
    endpoint: capability.endpoint || "",
    method: Array.isArray(capability.methods) && capability.methods.length ? capability.methods[0] : null,
    name: capability.name,
    description: capability.description || null,
    input_schema: capability.input_schema || null,
    output_schema: capability.output_schema || null,
    auth: capability.auth || null,
    evidence: capability.evidence?.source_kind === "registered_endpoint" ? "explicit" : "strong",
    metadata: { ...(capability.metadata || {}), evidence: capability.evidence || null },
  };
}

function pushUnique(output: AgentOperation[], operation: AgentOperation) {
  if (!operation.endpoint) return;
  const key = `${operation.kind}|${operation.protocol}|${operation.endpoint}|${operation.method || ""}|${operation.name.toLowerCase()}`;
  if (!output.some((item) => `${item.kind}|${item.protocol}|${item.endpoint}|${item.method || ""}|${item.name.toLowerCase()}` === key)) output.push(operation);
}

function conventionalCandidates(endpoint: string) {
  const clean = endpoint.replace(/\/+$/, "");
  return [
    ["capability", `${clean}/erc8183/execution-capabilities`],
    ["capability", `${clean}/execution-capabilities`],
    ["preflight", `${clean}/preflight`],
    ["quote", `${clean}/quote`],
    ["quote", `${clean}/pricing`],
    ["quote", `${clean}/estimate`],
    ["quote", `${clean}/preview`],
    ["execute", `${clean}/execute`],
    ["execute", `${clean}/execute-swap`],
    ["execute", `${clean}/trade`],
    ["execute", `${clean}/swap`],
    ["execute", `${clean}/rebalance`],
    ["health", `${clean}/health`],
  ] as Array<[AgentOperationKind, string]>;
}

function inferFromEndpointMetadata(endpoint: JsonRecord): AgentOperation | null {
  const url = typeof endpoint.endpoint_url === "string" ? endpoint.endpoint_url.trim() : "";
  if (!url) return null;
  const metadata = record(endpoint.metadata);
  const text = `${endpoint.protocol || ""} ${endpoint.name || ""} ${endpoint.description || ""} ${JSON.stringify(metadata)}`;
  const kind = classify(text || url);
  return {
    kind,
    protocol: baseProtocolFromTransport(typeof endpoint.protocol === "string" ? endpoint.protocol : undefined),
    endpoint: url,
    method: typeof metadata.method === "string" ? metadata.method.toUpperCase() : null,
    name: typeof endpoint.name === "string" ? endpoint.name : typeof endpoint.protocol === "string" ? endpoint.protocol : "registered endpoint",
    description: typeof endpoint.description === "string" ? endpoint.description : null,
    input_schema: record(metadata.input_schema),
    output_schema: record(metadata.output_schema),
    auth: record(metadata.auth),
    evidence: "explicit",
    metadata: { ...metadata, source: "erc8004_registered_service" },
  };
}

async function fetchOpenApi(url: string) {
  const candidates = strings(url, `${url.replace(/\/+$/, "")}/openapi.json`, `${url.replace(/\/+$/, "")}/.well-known/openapi.json`, `${url.replace(/\/+$/, "")}/swagger.json`);
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      const response = await fetch(parsed, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
      if (!response.ok) continue;
      const body = await response.json() as JsonRecord;
      if (body.openapi || body.swagger) return { document: body, url: candidate };
    } catch {
      // Continue discovery. A missing OpenAPI document is not an agent failure.
    }
  }
  return null;
}

function operationsFromOpenApi(document: JsonRecord, sourceUrl: string) {
  const operations: AgentOperation[] = [];
  const paths = record(document.paths);
  for (const [path, rawPath] of Object.entries(paths)) {
    const pathItem = record(rawPath);
    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (!["get", "post", "put", "patch", "delete", "options"].includes(method.toLowerCase())) continue;
      const op = record(rawOperation);
      const text = `${path} ${op.operationId || ""} ${op.summary || ""} ${op.description || ""}`;
      const kind = classify(text);
      const requestBody = record(op.requestBody);
      const content = record(requestBody.content);
      const firstContent = Object.values(content)[0];
      operations.push({
        kind,
        protocol: "openapi",
        endpoint: new URL(path, sourceUrl).toString(),
        method: method.toUpperCase(),
        name: typeof op.operationId === "string" ? op.operationId : `${method.toUpperCase()} ${path}`,
        description: typeof op.description === "string" ? op.description : typeof op.summary === "string" ? op.summary : null,
        input_schema: record(firstContent).schema as JsonRecord || null,
        output_schema: record(op.responses),
        auth: record(op.security),
        evidence: "explicit",
        metadata: { source: "openapi", path, operation: op },
      });
    }
  }
  return operations;
}

export async function discoverUniversalAgentInterop(
  agent: Record<string, unknown>,
  registeredEndpoints: Array<Record<string, unknown>> = [],
): Promise<UniversalAgentInterop> {
  const capabilities = await discoverAgentCapabilities(agent, registeredEndpoints);
  const operations: AgentOperation[] = [];
  const discoveryErrors: string[] = [];
  for (const capability of capabilities.capabilities) pushUnique(operations, operationFromCapability(capability));

  const metadata = record(agent.metadata);
  const serviceMetadata = Array.isArray(metadata.services) ? metadata.services : [];
  for (const raw of serviceMetadata) {
    if (!raw || typeof raw !== "object") continue;
    const service = record(raw);
    const endpoint = typeof service.endpoint === "string" ? service.endpoint : "";
    if (!endpoint) continue;
    const inferred = inferFromEndpointMetadata({ ...service, endpoint_url: endpoint });
    if (inferred) pushUnique(operations, inferred);
  }

  for (const endpoint of registeredEndpoints) {
    const inferred = inferFromEndpointMetadata(endpoint);
    if (inferred) pushUnique(operations, inferred);
    const url = typeof endpoint.endpoint_url === "string" ? endpoint.endpoint_url.trim() : "";
    if (!url) continue;

    try {
      const openapi = await fetchOpenApi(url);
      if (openapi) for (const operation of operationsFromOpenApi(openapi.document, openapi.url)) pushUnique(operations, operation);
    } catch (error) {
      discoveryErrors.push(`${url}: ${error instanceof Error ? error.message : "OpenAPI discovery failed"}`);
    }

    for (const [kind, candidate] of conventionalCandidates(url)) {
      pushUnique(operations, {
        kind,
        protocol: candidate.includes("/erc8183/") ? "erc8183" : "http",
        endpoint: candidate,
        method: null,
        name: kind,
        description: null,
        input_schema: null,
        output_schema: null,
        auth: null,
        evidence: "inferred",
        metadata: { source: "conventional_candidate", registered_endpoint: url },
      });
    }
  }

  return {
    agent_id: String(agent.agent_id || agent.id || "unknown"),
    operations,
    capabilities,
    discovery_errors: discoveryErrors,
  };
}

export function pickOperation(interop: UniversalAgentInterop, kind: AgentOperationKind): AgentOperation | null {
  const ranked = interop.operations
    .filter((operation) => operation.kind === kind)
    .filter((operation) => kind === "execute" || kind === "preflight" ? operation.evidence !== "inferred" : true)
    .sort((a, b) => {
      const score = (operation: AgentOperation) => operation.evidence === "explicit" ? 3 : operation.evidence === "strong" ? 2 : 1;
      return score(b) - score(a);
    });
  return ranked[0] || null;
}
