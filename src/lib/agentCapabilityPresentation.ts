import type { AgentCapability, AgentCapabilitySnapshot } from "./agentCapability";
import { selectAgentAdapter, type AgentAdapterSelection } from "./agentAdapter";

export type CapabilityPresentation = {
  agent_id: string;
  adapter: AgentAdapterSelection["adapter"];
  confidence: AgentAdapterSelection["confidence"];
  capability_count: number;
  capabilities: Array<{
    kind: AgentCapability["kind"];
    name: string;
    transport: AgentCapability["transport"];
    endpoint: string | null;
    networks: Array<{ chain_id: number; name: string | null }>;
    evidence: string[];
  }>;
  reasons: string[];
};

function evidenceForCapability(capability: AgentCapability): string[] {
  const evidence: string[] = [];
  if (capability.endpoint) evidence.push("Endpoint was observed");
  if (capability.transport !== "unknown") evidence.push(`${capability.transport.toUpperCase()} transport was observed`);
  if ((capability.networks ?? []).length > 0) evidence.push("Network scope was declared");
  if ((capability.methods ?? []).length > 0) evidence.push("Methods were declared");
  if (capability.auth?.required) evidence.push(`Authentication is required${capability.auth.type ? ` (${capability.auth.type})` : ""}`);
  return evidence;
}

export function presentAgentCapabilities(snapshot: AgentCapabilitySnapshot): CapabilityPresentation {
  const selection = selectAgentAdapter(snapshot);

  return {
    agent_id: snapshot.agent_id,
    adapter: selection.adapter,
    confidence: selection.confidence,
    capability_count: snapshot.capabilities.length,
    capabilities: snapshot.capabilities.map((capability) => ({
      kind: capability.kind,
      name: capability.name,
      transport: capability.transport,
      endpoint: capability.endpoint ?? null,
      networks: capability.networks ?? [],
      evidence: evidenceForCapability(capability),
    })),
    reasons: selection.reasons,
  };
}

export function capabilityStatusLabel(capability: AgentCapability) {
  if (!capability.endpoint && capability.transport === "unknown") return "Declared, not yet endpoint-verified";
  if (!capability.endpoint) return "Observed, endpoint not supplied";
  return "Observed";
}
