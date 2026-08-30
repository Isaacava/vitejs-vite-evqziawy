import type { AgentCapability, AgentCapabilitySnapshot } from "./agentCapability";

export type CapabilityMatch = {
  score: number;
  matched: boolean;
  matchedCapabilities: string[];
  reasons: string[];
};

function searchableText(capability: AgentCapability) {
  const metadata = capability.metadata && typeof capability.metadata === "object" ? capability.metadata : {};
  return [
    capability.kind,
    capability.name,
    capability.description,
    capability.transport,
    capability.endpoint,
    ...(capability.methods ?? []),
    ...(typeof metadata.protocol === "string" ? [metadata.protocol] : []),
    ...(typeof metadata.type === "string" ? [metadata.type] : []),
    ...(typeof metadata.category === "string" ? [metadata.category] : []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function normalizeTerm(term: string) {
  return term.toLowerCase().replace(/[^a-z0-9-]/g, " ").replace(/\s+/g, " ").trim();
}

export function matchCapabilities(snapshot: AgentCapabilitySnapshot, keywords: string[]): CapabilityMatch {
  const normalizedKeywords = [...new Set(keywords.map(normalizeTerm).filter((value) => value.length >= 3))];
  if (normalizedKeywords.length === 0 || snapshot.capabilities.length === 0) {
    return {
      score: 0,
      matched: false,
      matchedCapabilities: [],
      reasons: ["No capability evidence was available for this agent"],
    };
  }

  const matchedCapabilities = new Set<string>();
  let matchedTerms = 0;

  for (const capability of snapshot.capabilities) {
    const text = searchableText(capability);
    let capabilityMatched = false;
    for (const keyword of normalizedKeywords) {
      if (text.includes(keyword)) {
        matchedTerms += 1;
        capabilityMatched = true;
      }
    }
    if (capabilityMatched) matchedCapabilities.add(`${capability.kind}:${capability.name}`);
  }

  const score = normalizedKeywords.length > 0
    ? Math.min(100, Math.round((matchedTerms / normalizedKeywords.length) * 100))
    : 0;

  return {
    score,
    matched: matchedTerms > 0,
    matchedCapabilities: [...matchedCapabilities],
    reasons: matchedTerms > 0
      ? [`${matchedTerms} requested term${matchedTerms === 1 ? "" : "s"} matched observed capability evidence`]
      : ["No requested term matched the agent's observed capability evidence"],
  };
}
