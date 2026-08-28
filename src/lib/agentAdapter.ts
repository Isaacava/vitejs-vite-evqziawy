import type { AgentCapability, AgentCapabilityKind, AgentCapabilitySnapshot } from "./agentCapability.js";

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

function confidenceForCapability(capability: AgentCapability): { level: "high" | "medium" | "low"; reason: string } {
  if (!capability.endpoint) {
    return { level: "low", reason: "No callable endpoint was discovered" };
  }

  const evidence = capability.evidence;
  if (!evidence) {
    return { level: "medium", reason: "Endpoint was discovered without explicit provenance metadata" };
  }

  const observedAt = Date.parse(evidence.observed_at);
  if (!Number.isFinite(observedAt)) {
    return { level: "medium", reason: `Evidence source: ${evidence.source_kind}; observation time is not parseable` };
  }

  const ageMs = Math.max(0, Date.now() - observedAt);
  const ageHours = ageMs / (60 * 60 * 1000);
  const ageDays = ageHours / 24;

  if (ageHours <= 24 && ["agent_card", "mcp_discovery", "mcp_tools"].includes(evidence.source_kind)) {
    return { level: "high", reason: `Fresh ${evidence.source_kind.replaceAll("_", " ")} evidence observed within 24 hours` };
  }

  if (ageDays <= 7) {
    return { level: "medium", reason: `${evidence.source_kind.replaceAll("_", " ")} evidence observed within 7 days` };
  }

  return { level: "low", reason: `Capability evidence is ${Math.floor(ageDays)} days old` };
}

export function selectAgentAdapter(snapshot: AgentCapabilitySnapshot, preferredKind: AgentCapabilityKind = "task_submission"): AgentAdapterSelection {
  const preferred = findBest(snapshot, preferredKind);
  const candidates = preferred ? [preferred, ...snapshot.capabilities.filter((item) => item !== preferred)] : snapshot.capabilities;

  for (const capability of candidates) {
    const protocol = protocolFromCapability(capability);
    if (protocol) {
      const confidence = confidenceForCapability(capability);
      const reasons = [
        `Observed ${capability.kind} capability`,
        `Compatible ${protocol.toUpperCase()} transport/protocol evidence`,
        confidence.reason,
      ];
      return {
        adapter: protocol,
        capability,
        confidence: confidence.level,
        reasons,
      };
    }
  }

  const execution = findBest(snapshot, "execution");
  if (execution) {
    const confidence = confidenceForCapability(execution);
    return {
      adapter: "execution",
      capability: execution,
      confidence: confidence.level === "high" ? "medium" : confidence.level,
      reasons: [
        "Execution capability was observed",
        "No provider-specific execution system was inferred",
        confidence.reason,
      ],
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
