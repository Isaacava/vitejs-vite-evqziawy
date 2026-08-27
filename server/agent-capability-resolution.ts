import type { AgentCapabilitySnapshot } from "../src/lib/agentCapability.js";
import { discoverAgentCapabilities } from "./_testnet/agent-capabilities.js";
import { presentAgentCapabilities, type CapabilityPresentation } from "../src/lib/agentCapabilityPresentation.js";

export type ResolvedAgentCapabilities = CapabilityPresentation & {
  discovery: {
    discovered_at: string;
    source_urls: string[];
  };
};

export async function resolveAgentCapabilities(
  agent: Record<string, unknown>,
  registeredEndpoints: Array<Record<string, unknown>> = [],
): Promise<ResolvedAgentCapabilities> {
  const snapshot: AgentCapabilitySnapshot = await discoverAgentCapabilities(agent, registeredEndpoints);
  const presentation = presentAgentCapabilities(snapshot);

  return {
    ...presentation,
    discovery: {
      discovered_at: snapshot.discovered_at,
      source_urls: snapshot.source_urls,
    },
  };
}
