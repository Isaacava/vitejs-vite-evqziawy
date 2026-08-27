import type { AgentCapabilitySnapshot } from "../src/lib/agentCapability.js";
import { discoverAgentCapabilities } from "./_testnet/agent-capabilities.js";
import { selectAgentAdapter, type AgentAdapterSelection } from "../src/lib/agentAdapter.js";

export type AgentAdapterResolution = AgentAdapterSelection & {
  agent_id: string;
  discovery: {
    discovered_at: string;
    source_urls: string[];
    capability_count: number;
  };
};

export async function resolveAgentAdapter(
  agent: Record<string, unknown>,
  registeredEndpoints: Array<Record<string, unknown>> = [],
): Promise<AgentAdapterResolution> {
  const snapshot: AgentCapabilitySnapshot = await discoverAgentCapabilities(agent, registeredEndpoints);
  const selection = selectAgentAdapter(snapshot);

  return {
    agent_id: snapshot.agent_id,
    ...selection,
    discovery: {
      discovered_at: snapshot.discovered_at,
      source_urls: snapshot.source_urls,
      capability_count: snapshot.capabilities.length,
    },
  };
}
