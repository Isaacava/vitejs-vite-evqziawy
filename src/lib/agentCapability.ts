export type AgentCapabilityKind =
  | "task_submission"
  | "result_retrieval"
  | "streaming"
  | "execution"
  | "payment"
  | "wallet"
  | "authentication"
  | "health"
  | "unknown";

export type AgentCapabilityTransport =
  | "http"
  | "https"
  | "websocket"
  | "sse"
  | "a2a"
  | "mcp"
  | "unknown";

export type AgentCapabilityEvidence = {
  source_url: string | null;
  observed_at: string;
  source_kind: "agent_card" | "mcp_discovery" | "mcp_tools" | "generic_capability" | "registered_endpoint" | "unknown";
};

export type AgentCapability = {
  kind: AgentCapabilityKind;
  name: string;
  description?: string | null;
  endpoint?: string | null;
  transport: AgentCapabilityTransport;
  methods?: string[];
  input_schema?: Record<string, unknown> | null;
  output_schema?: Record<string, unknown> | null;
  auth?: {
    required: boolean;
    type?: string | null;
    issuer?: string | null;
  } | null;
  networks?: Array<{ chain_id: number; name?: string | null }>;
  assets?: Array<{ address: string; symbol?: string | null; decimals?: number | null }>;
  limits?: Record<string, unknown>;
  evidence?: AgentCapabilityEvidence;
  metadata?: Record<string, unknown>;
};

export type AgentCapabilitySnapshot = {
  agent_id: string;
  discovered_at: string;
  source_urls: string[];
  capabilities: AgentCapability[];
  raw?: Record<string, unknown> | null;
};

function sourceKind(value: unknown, transport: AgentCapabilityTransport): AgentCapabilityEvidence["source_kind"] {
  const raw = typeof value === "string" ? value.toLowerCase() : "";
  if (raw === "a2a_agent_card" || transport === "a2a") return "agent_card";
  if (raw === "mcp_discovery") return "mcp_discovery";
  if (raw === "mcp_tools_list" || transport === "mcp") return "mcp_tools";
  if (raw === "generic_capability") return "generic_capability";
  if (raw === "registered_endpoint") return "registered_endpoint";
  return "unknown";
}

export function normalizeAgentCapability(value: unknown, sourceUrl?: string): AgentCapability | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const kind = typeof raw.kind === "string" ? raw.kind : typeof raw.type === "string" ? raw.type : "unknown";
  const knownKinds: AgentCapabilityKind[] = [
    "task_submission",
    "result_retrieval",
    "streaming",
    "execution",
    "payment",
    "wallet",
    "authentication",
    "health",
    "unknown",
  ];
  const normalizedKind = (knownKinds.includes(kind as AgentCapabilityKind) ? kind : "unknown") as AgentCapabilityKind;
  const transportValue = typeof raw.transport === "string" ? raw.transport.toLowerCase() : "unknown";
  const transports: AgentCapabilityTransport[] = ["http", "https", "websocket", "sse", "a2a", "mcp", "unknown"];
  const transport = transports.includes(transportValue as AgentCapabilityTransport)
    ? transportValue as AgentCapabilityTransport
    : "unknown";

  const endpoint = typeof raw.endpoint === "string" ? raw.endpoint.trim() : sourceUrl || null;
  const methods = Array.isArray(raw.methods)
    ? raw.methods.filter((item): item is string => typeof item === "string")
    : undefined;
  const rawMetadata = raw.metadata && typeof raw.metadata === "object" ? raw.metadata as Record<string, unknown> : {};
  const observedAt = typeof rawMetadata.observed_at === "string" && rawMetadata.observed_at.trim()
    ? rawMetadata.observed_at.trim()
    : new Date().toISOString();

  return {
    kind: normalizedKind,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : normalizedKind,
    description: typeof raw.description === "string" ? raw.description : null,
    endpoint,
    transport,
    methods,
    input_schema: raw.input_schema && typeof raw.input_schema === "object" ? raw.input_schema as Record<string, unknown> : null,
    output_schema: raw.output_schema && typeof raw.output_schema === "object" ? raw.output_schema as Record<string, unknown> : null,
    auth: raw.auth && typeof raw.auth === "object"
      ? {
          required: Boolean((raw.auth as Record<string, unknown>).required),
          type: typeof (raw.auth as Record<string, unknown>).type === "string" ? (raw.auth as Record<string, unknown>).type as string : null,
          issuer: typeof (raw.auth as Record<string, unknown>).issuer === "string" ? (raw.auth as Record<string, unknown>).issuer as string : null,
        }
      : null,
    networks: Array.isArray(raw.networks)
      ? raw.networks.filter((item): item is Record<string, unknown> => !!item && typeof item === "object").flatMap((item) => {
          const chainId = Number(item.chain_id ?? item.chainId);
          return Number.isInteger(chainId) && chainId > 0 ? [{ chain_id: chainId, name: typeof item.name === "string" ? item.name : null }] : [];
        })
      : undefined,
    assets: Array.isArray(raw.assets)
      ? raw.assets.filter((item): item is Record<string, unknown> => !!item && typeof item === "object").flatMap((item) => {
          const address = typeof item.address === "string" ? item.address : "";
          return address ? [{ address, symbol: typeof item.symbol === "string" ? item.symbol : null, decimals: Number.isInteger(Number(item.decimals)) ? Number(item.decimals) : null }] : [];
        })
      : undefined,
    limits: raw.limits && typeof raw.limits === "object" ? raw.limits as Record<string, unknown> : undefined,
    evidence: {
      source_url: sourceUrl || null,
      observed_at: observedAt,
      source_kind: sourceKind(rawMetadata.source_type, transport),
    },
    metadata: {
      ...raw,
      discovery_source: sourceUrl || null,
    },
  };
}

export function capabilitySupports(snapshot: AgentCapabilitySnapshot, kind: AgentCapabilityKind) {
  return snapshot.capabilities.some((capability) => capability.kind === kind);
}
