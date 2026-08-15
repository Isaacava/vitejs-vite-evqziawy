export type MarketplaceAgent = {
  id: string;
  name: string;
  role: string;
  capabilities: string[];
  status: "online" | "busy" | "offline" | "pending";
  isFirstParty: boolean;
  reputation?: number;
  completionRate?: number;
  endpointHealthy?: boolean;
};

export type AgentMatch = MarketplaceAgent & {
  score: number;
  scoreMax: number;
  scoreConfidence: "high" | "medium" | "low";
  reasons: string[];
  breakdown: {
    capability: number;
    availability: number;
    verification: number;
    reputation: number;
    completion: number;
    liveness: number;
  };
  evidence: {
    reputationAvailable: boolean;
    completionAvailable: boolean;
    livenessAvailable: boolean;
  };
};

const WEIGHTS = {
  capability: 35,
  availability: 15,
  verification: 15,
  reputation: 15,
  completion: 10,
  liveness: 10,
} as const;

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function intentTerms(goal: string) {
  const normalized = normalize(goal);
  const aliases: Record<string, string[]> = {
    rebalance: ["rebalance", "rebalancing", "portfolio", "allocation"],
    yield: ["yield", "earn", "apy", "lending", "liquidity"],
    grid: ["grid", "trading", "range", "orders"],
    risk: ["risk", "health", "liquidation", "safety", "guardian"],
  };

  return Object.entries(aliases)
    .filter(([, terms]) => terms.some((term) => normalized.includes(term)))
    .map(([key]) => key);
}

export function matchAgents(goal: string, agents: MarketplaceAgent[]): AgentMatch[] {
  const terms = intentTerms(goal);

  return agents
    .map((agent) => {
      const capabilityText = normalize(
        [agent.name, agent.role, ...agent.capabilities].join(" ")
      );
      const matchedTerms = terms.filter((term) => {
        const aliases: Record<string, string[]> = {
          rebalance: ["rebalance", "rebalancing", "portfolio", "allocation"],
          yield: ["yield", "earn", "apy", "lending", "liquidity"],
          grid: ["grid", "trading", "range", "orders"],
          risk: ["risk", "health", "liquidation", "safety", "guardian"],
        };
        return aliases[term].some((value) => capabilityText.includes(value));
      });

      const capability = terms.length
        ? Math.round((matchedTerms.length / terms.length) * WEIGHTS.capability)
        : Math.round(WEIGHTS.capability * 0.5);
      const availability = agent.status === "online"
        ? WEIGHTS.availability
        : agent.status === "busy"
          ? Math.round(WEIGHTS.availability * 0.65)
          : Math.round(WEIGHTS.availability * 0.2);
      const verification = agent.isFirstParty ? WEIGHTS.verification : Math.round(WEIGHTS.verification * 0.65);
      const reputationAvailable = typeof agent.reputation === "number" && Number.isFinite(agent.reputation);
      const completionAvailable = typeof agent.completionRate === "number" && Number.isFinite(agent.completionRate);
      const livenessAvailable = typeof agent.endpointHealthy === "boolean";
      const reputation = reputationAvailable
        ? Math.round((Math.max(0, Math.min(100, agent.reputation!)) / 100) * WEIGHTS.reputation)
        : 0;
      const completion = completionAvailable
        ? Math.round((Math.max(0, Math.min(100, agent.completionRate!)) / 100) * WEIGHTS.completion)
        : 0;
      const liveness = livenessAvailable
        ? (agent.endpointHealthy ? WEIGHTS.liveness : 0)
        : 0;

      const score = capability + availability + verification + reputation + completion + liveness;
      const scoreMax = capability + availability + verification
        + (reputationAvailable ? WEIGHTS.reputation : 0)
        + (completionAvailable ? WEIGHTS.completion : 0)
        + (livenessAvailable ? WEIGHTS.liveness : 0);
      const evidenceCount = [reputationAvailable, completionAvailable, livenessAvailable].filter(Boolean).length;
      const scoreConfidence: AgentMatch["scoreConfidence"] = evidenceCount >= 2 ? "high" : evidenceCount === 1 ? "medium" : "low";
      const normalizedScore = scoreMax > 0 ? Math.round((score / scoreMax) * 100) : 0;
      const reasons: string[] = [];

      if (matchedTerms.length) reasons.push(`Matches ${matchedTerms.join(", ")} intent`);
      if (agent.status === "online") reasons.push("Agent is online");
      if (agent.isFirstParty) reasons.push("Verified first-party agent");
      if (reputationAvailable && agent.reputation! >= 80) reasons.push("Strong verified reputation evidence");
      if (completionAvailable && agent.completionRate! >= 90) reasons.push("High verified completion rate");
      if (livenessAvailable && agent.endpointHealthy) reasons.push("Endpoint is healthy");
      if (!reputationAvailable) reasons.push("Reputation history is not yet available");
      if (!completionAvailable) reasons.push("Completion history is not yet available");

      return {
        ...agent,
        score: normalizedScore,
        scoreMax,
        scoreConfidence,
        reasons: reasons.slice(0, 4),
        breakdown: { capability, availability, verification, reputation, completion, liveness },
        evidence: { reputationAvailable, completionAvailable, livenessAvailable },
      };
    })
    .sort((a, b) => b.score - a.score);
}
