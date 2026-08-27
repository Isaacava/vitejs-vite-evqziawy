import type { AgentCapability, AgentCapabilityKind, AgentCapabilitySnapshot } from "./agentCapability";

export type AgentAdapterId =
  | "erc8183"
  | "a2a"
  | "mcp"
  | "http"
  | "execution"
  | "unsupported";

export type AgentAdapterSelection = {
  adapter: AgentAdapterId;
  capability: AgentCapability | null;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

function protocolFromCapability(capability: AgentCapability) {
  const metadata = capability.metadata && typeof capability.metadata === "object"
    ? capability.metadata
    : {};
  const values = [
    capability.name,
    capability.description,
    capability.transport,
    capability.endpoint,
    ...(capability.methods ?? []),
    typeof metadata.protocol === "string" ? metadata.protocol : "",
    typeof metadata.protocol_id === "string" ? metadata.protocol_id : "",
    typeof metadata.type === "string" ? metadata.type : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/erc[- ]?8183|agentic commerce/.test(values)) return "erc8183" as const;
  if (capability.transport === "a2a" || /\ba2a\b|agent2agent/.test(values)) return "a2a" as const;
  if (capability.transport === "mcp" || /\bmcp\b|model context protocol/.test(values)) return "mcp" as const;
  if (capability.transport === "http" || capability.transport === "https") return "http" as const;
  return null;
}

function findBest(snapshot: AgentCapabilitySnapshot, kind: AgentCapabilityKind) {
  return snapshot.capabilities.find((capability) => capability.kind === kind) ?? null;
}

export function selectAgentAdapter(snapshot: AgentCapabilitySnapshot, preferredKind: AgentCapabilityKind = "task_submission"): AgentAdapterSelection {
  const preferred = findBest(snapshot, preferredKind);
  const candidates = preferred ? [preferred, ...snapshot.capabilities.filter((item) => item !== preferred)] : snapshot.capabilities;

  for (const capability of candidates) {
    const protocol = protocolFromCapability(capability);
    if (protocol) {
      const reasons = [`Observed ${capability.kind} capability`, `Compatible ${protocol.toUpperCase()} transport/protocol evidence`];
      return {
        adapter: protocol,
        capability,
        confidence: capability.endpoint ? "high" : "medium",
        reasons,
      };
    }
  }

  const execution = findBest(snapshot, "execution");
  if (execution) {
    return {
      adapter: "execution",
      capability: execution,
      confidence: execution.endpoint ? "medium" : "low",
      reasons: ["Execution capability was observed", "No provider-specific execution system was inferred"],
    };
  }

  return {
    adapter: "unsupported",
    capability: null,
    confidence: "low",
    reasons: ["No compatible adapter was identified from observed capability evidence", "Agent remains discoverable but this action is not currently supported"],
  };
}

export function adapterSupportsKind(adapter: AgentAdapterId, kind: AgentCapabilityKind) {
  if (adapter === "unsupported") return false;
  if (adapter === "execution") return kind === "execution";
  if (adapter === "erc8183") return kind === "task_submission" || kind === "result_retrieval" || kind === "payment";
  if (adapter === "a2a") return kind === "task_submission" || kind === "result_retrieval" || kind === "streaming";
  if (adapter === "mcp") return kind === "task_submission" || kind === "result_retrieval";
  if (adapter === "http") return kind !== "unknown";
  return false;
}