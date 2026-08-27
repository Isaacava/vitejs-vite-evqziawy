import type { AgentCapability, AgentCapabilitySnapshot } from "./agentCapability";
import { matchCapabilities, type CapabilityMatch } from "./agentCapabilityMatch";
import { selectAgentAdapter, type AgentAdapterSelection } from "./agentAdapter";

export type AgentResolution = {
  agent_id: string;
  capability_match: CapabilityMatch;
  adapter: AgentAdapterSelection;
  evidence: {
    discovery_sources: string[];
    discovered_at: string;
    capability_count: number;
    verified_capability_count: number;
  };
};

function capabilityHasEvidence(capability: AgentCapability) {
  return Boolean(
    capability.endpoint ||
    capability.transport !== "unknown" ||
    (capability.methods && capability.methods.length > 0) ||
    (capability.networks && capability.networks.length > 0),
  );
}

export function resolveAgent(
  snapshot: AgentCapabilitySnapshot,
  requestedKeywords: string[] = [],
): AgentResolution {
  const adapter = selectAgentAdapter(snapshot);
  const capability_match = matchCapabilities(snapshot, requestedKeywords);

  return {
    agent_id: snapshot.agent_id,
    capability_match,
    adapter,
    evidence: {
      discovery_sources: snapshot.source_urls,
      discovered_at: snapshot.discovered_at,
      capability_count: snapshot.capabilities.length,
      verified_capability_count: snapshot.capabilities.filter(capabilityHasEvidence).length,
    },
  };
}
