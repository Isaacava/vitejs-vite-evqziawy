import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { parseMarketplaceIntent } from "../../lib/intent.js";

type AgentRow = {
  id: string;
  agent_id: string;
  owner: string;
  uri: string;
  name: string | null;
  description: string | null;
  image: string | null;
  chain: string;
  category: string;
  status: string;
  source: string;
  verification_status: string;
  is_first_party: boolean;
};

type EndpointRow = {
  agent_id: string;
  status: string;
  latency_ms: number | null;
  last_checked_at: string | null;
};

type ReputationRow = {
  agent_id: string;
  score: number;
  source: string;
};

type JobRow = {
  provider_agent_id: string;
  status: string | null;
  chain_status: string | null;
};

const WEIGHTS = {
  capability: 35,
  verification: 20,
  endpointLiveness: 15,
  completion: 10,
  jobVolume: 5,
  reputation: 15,
} as const;

const TERMINAL_STATES = new Set(["completed", "settled", "rejected", "expired", "refunded"]);
const SUCCESSFUL_STATES = new Set(["completed", "settled"]);

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function scoreAgent(
  agent: AgentRow,
  intent: ReturnType<typeof parseMarketplaceIntent>,
  endpoint: EndpointRow | undefined,
  reputationRows: ReputationRow[],
  jobRows: JobRow[],
) {
  const capability = agent.category === intent.category
    ? 100
    : intent.category === "other"
      ? 60
      : 25;

  const verification = agent.verification_status === "verified"
    ? 100
    : agent.verification_status === "pending"
      ? 70
      : agent.verification_status === "indexed"
        ? 55
        : 0;

  const livenessAvailable = Boolean(endpoint);
  const liveness = endpoint?.status === "online"
    ? 100
    : endpoint?.status === "degraded"
      ? 60
      : endpoint?.status === "offline"
        ? 15
        : 0;

  // Protocol reputation is kept separate from marketplace execution outcomes.
  const onChainScores = reputationRows
    .filter((row) => row.source !== "platform")
    .map((row) => clamp(Number(row.score)))
    .filter((score) => Number.isFinite(score));

  const reputationAvailable = onChainScores.length > 0;
  const reputation = reputationAvailable
    ? onChainScores.reduce((sum, score) => sum + score, 0) / onChainScores.length
    : 0;

  // ERC-8183-backed marketplace history comes from actual jobs, not reputation rows.
  const terminalJobs = jobRows.filter((job) => {
    const state = String(job.chain_status || job.status || "").toLowerCase();
    return TERMINAL_STATES.has(state);
  });
  const successfulTerminalJobs = terminalJobs.filter((job) => {
    const state = String(job.chain_status || job.status || "").toLowerCase();
    return SUCCESSFUL_STATES.has(state);
  });

  const completionAvailable = terminalJobs.length > 0;
  const completion = completionAvailable
    ? (successfulTerminalJobs.length / terminalJobs.length) * 100
    : 0;

  const volumeAvailable = jobRows.length > 0;
  const volume = volumeAvailable
    ? clamp(Math.log10(jobRows.length + 1) * 60)
    : 0;

  const score =
    capability * (WEIGHTS.capability / 100) +
    verification * (WEIGHTS.verification / 100) +
    liveness * (WEIGHTS.endpointLiveness / 100) +
    completion * (WEIGHTS.completion / 100) +
    volume * (WEIGHTS.jobVolume / 100) +
    reputation * (WEIGHTS.reputation / 100);

  const scoreMax =
    WEIGHTS.capability +
    WEIGHTS.verification +
    (livenessAvailable ? WEIGHTS.endpointLiveness : 0) +
    (completionAvailable ? WEIGHTS.completion : 0) +
    (volumeAvailable ? WEIGHTS.jobVolume : 0) +
    (reputationAvailable ? WEIGHTS.reputation : 0);

  const evidenceCount = [reputationAvailable, completionAvailable, livenessAvailable].filter(Boolean).length;
  const scoreConfidence = evidenceCount >= 2 ? "high" : evidenceCount === 1 ? "medium" : "low";
  const normalizedScore = scoreMax > 0 ? Math.round((score / scoreMax) * 10000) / 100 : 0;
  const reasons: string[] = [];

  if (capability === 100) reasons.push("Strong capability match");
  else if (intent.category === "other") reasons.push("General DeFi capability match");
  if (verification >= 70) reasons.push(`ERC-8004 identity ${agent.verification_status}`);
  if (endpoint?.status === "online") reasons.push("Endpoint is healthy");
  if (completionAvailable) reasons.push(`${terminalJobs.length} verified terminal outcome${terminalJobs.length === 1 ? "" : "s"}`);
  if (volumeAvailable) reasons.push(`${jobRows.length} marketplace job${jobRows.length === 1 ? "" : "s"} recorded`);
  if (reputationAvailable) reasons.push("On-chain reputation evidence available");
  if (!reputationAvailable) reasons.push("Reputation history not yet available");
  if (!completionAvailable) reasons.push("Verified outcome history not yet available");

  // Discovery and hireability are deliberately separate. An ERC-8004 identity
  // may be discoverable even when there is no live provider service behind it.
  const hireability = endpoint?.status === "online"
    ? {
        status: "ready" as const,
        canCreateJob: true,
        reason: "A live provider endpoint is currently reporting healthy.",
      }
    : endpoint?.status === "degraded"
      ? {
          status: "degraded" as const,
          canCreateJob: false,
          reason: "The provider endpoint is reachable but degraded; do not fund a job yet.",
        }
      : {
          status: "discoverable_only" as const,
          canCreateJob: false,
          reason: "The agent is discoverable, but no healthy provider endpoint is available.",
        };

  return {
    score: normalizedScore,
    scoreMax,
    scoreConfidence,
    hireability,
    breakdown: {
      capability: Math.round(capability * WEIGHTS.capability / 100),
      verification: Math.round(verification * WEIGHTS.verification / 100),
      endpointLiveness: Math.round(liveness * WEIGHTS.endpointLiveness / 100),
      completion: Math.round(completion * WEIGHTS.completion / 100),
      jobVolume: Math.round(volume * WEIGHTS.jobVolume / 100),
      reputation: Math.round(reputation * WEIGHTS.reputation / 100),
    },
    evidence: {
      reputationAvailable,
      completionAvailable,
      livenessAvailable,
    },
    reasons: reasons.slice(0, 4),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const input = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  if (!input) return res.status(400).json({ error: "goal is required" });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: "Supabase server configuration is missing" });

  const intent = parseMarketplaceIntent(input);
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let agentsQuery = supabase
    .from("agents")
    .select("id,agent_id,owner,uri,name,description,image,chain,category,status,source,verification_status,is_first_party")
    .limit(100);

  if (intent.category !== "other") agentsQuery = agentsQuery.eq("category", intent.category);

  const [{ data: agents, error: agentsError }, { data: endpoints, error: endpointsError }, { data: reputation, error: reputationError }, { data: jobs, error: jobsError }] = await Promise.all([
    agentsQuery,
    supabase.from("agent_endpoints").select("agent_id,status,latency_ms,last_checked_at").order("last_checked_at", { ascending: false }),
    supabase.from("reputation").select("agent_id,score,source").limit(500),
    supabase.from("jobs").select("provider_agent_id,status,chain_status").limit(5000),
  ]);

  if (agentsError) return res.status(500).json({ error: agentsError.message });
  if (endpointsError) return res.status(500).json({ error: endpointsError.message });
  if (reputationError) return res.status(500).json({ error: reputationError.message });
  if (jobsError) return res.status(500).json({ error: jobsError.message });

  const endpointByAgent = new Map<string, EndpointRow>();
  for (const endpoint of (endpoints ?? []) as EndpointRow[]) {
    if (!endpointByAgent.has(endpoint.agent_id)) endpointByAgent.set(endpoint.agent_id, endpoint);
  }

  const reputationByAgent = new Map<string, ReputationRow[]>();
  for (const row of (reputation ?? []) as ReputationRow[]) {
    const current = reputationByAgent.get(row.agent_id) ?? [];
    current.push(row);
    reputationByAgent.set(row.agent_id, current);
  }

  const jobsByAgent = new Map<string, JobRow[]>();
  for (const row of (jobs ?? []) as JobRow[]) {
    const current = jobsByAgent.get(row.provider_agent_id) ?? [];
    current.push(row);
    jobsByAgent.set(row.provider_agent_id, current);
  }

  const scoredMatches = ((agents ?? []) as AgentRow[])
    .filter((agent) => agent.verification_status !== "revoked")
    .map((agent) => ({
      agent,
      ...scoreAgent(
        agent,
        intent,
        endpointByAgent.get(agent.id),
        reputationByAgent.get(agent.id) ?? [],
        jobsByAgent.get(agent.id) ?? [],
      ),
    }))
    .sort((a, b) => b.score - a.score);

  const bestDiscoveryMatch = scoredMatches[0] ?? null;
  const bestHireableMatch = scoredMatches.find((match) => match.hireability.canCreateJob) ?? null;
  const bestMatch = bestHireableMatch ?? bestDiscoveryMatch;
  const topMatches = scoredMatches.slice(0, 10);

  return res.status(200).json({
    intent,
    bestMatch,
    bestDiscoveryMatch,
    bestHireableMatch,
    alternatives: topMatches.filter((match) => match !== bestMatch),
    scoring: {
      weights: WEIGHTS,
      historyPolicy: "Missing reputation, completion, and liveness evidence contributes no points and reduces the available-score ceiling. New agents remain matchable on capability, availability and identity evidence.",
      evidencePolicy: "Protocol reputation, endpoint health, and AgentMarket ERC-8183 terminal outcomes are independent evidence sources. Reputation rows never count as completed jobs.",
      hireabilityPolicy: "Discovery is separate from hireability. Only agents with a currently healthy provider endpoint are marked ready for job creation.",
      selectionPolicy: "Discovery ranking is score-first. Hiring prefers the highest-scoring healthy provider when the discovery leader is not currently hireable.",
    },
  });
}
