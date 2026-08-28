import type { AgentAdapterId, AgentAdapterSelection } from "./agentAdapter";
import type { AgentCapabilityKind, AgentCapabilitySnapshot } from "./agentCapability";

export type AgentAdapterDescriptor = {
  id: AgentAdapterId;
  label: string;
  supportedKinds: AgentCapabilityKind[];
  priority: number;
};

const DEFAULT_ADAPTERS: AgentAdapterDescriptor[] = [
  { id: "erc8183", label: "ERC-8183", supportedKinds: ["task_submission", "result_retrieval", "payment"], priority: 50 },
  { id: "a2a", label: "A2A", supportedKinds: ["task_submission", "result_retrieval", "streaming"], priority: 40 },
  { id: "mcp", label: "MCP", supportedKinds: ["task_submission", "result_retrieval"], priority: 30 },
  { id: "http", label: "HTTP", supportedKinds: ["task_submission", "result_retrieval", "streaming", "execution", "payment", "wallet", "authentication", "health"], priority: 20 },
  { id: "execution", label: "Execution", supportedKinds: ["execution"], priority: 10 },
];

export function listAgentAdapters(): AgentAdapterDescriptor[] {
  return [...DEFAULT_ADAPTERS].sort((a, b) => b.priority - a.priority);
}

export function adapterCanHandleKind(
  adapter: AgentAdapterId,
  kind: AgentCapabilityKind,
  descriptors: AgentAdapterDescriptor[] = DEFAULT_ADAPTERS,
) {
  const descriptor = descriptors.find((item) => item.id === adapter);
  return Boolean(descriptor?.supportedKinds.includes(kind));
}

export function selectBestAdapterForCapability(
  snapshot: AgentCapabilitySnapshot,
  kind: AgentCapabilityKind,
  selection: AgentAdapterSelection,
  descriptors: AgentAdapterDescriptor[] = DEFAULT_ADAPTERS,
): AgentAdapterDescriptor | null {
  const selected = descriptors.find((descriptor) => descriptor.id === selection.adapter) ?? null;
  if (selected && adapterCanHandleKind(selected.id, kind, descriptors)) return selected;

  const candidates = descriptors
    .filter((descriptor) => adapterCanHandleKind(descriptor.id, kind, descriptors))
    .filter((descriptor) => snapshot.capabilities.some((capability) => capability.kind === kind));

  return candidates.sort((a, b) => b.priority - a.priority)[0] ?? null;
}
