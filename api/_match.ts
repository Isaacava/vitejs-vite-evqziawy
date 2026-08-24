import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { parseMarketplaceIntent } from "../../src/lib/intent";
import { readAgentOnchainStats, type OnchainAgentStats } from "../../src/server/testnetOnchain";

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

type EndpointRow = { agent_id: string; status: string; latency_ms: number | null; last_checked_at: string | null };
type ReputationRow = { agent_id: string; score: number; source: string };

const WEIGHTS = { capability: 35, verification: 20, endpointLiveness: 15, completion: 10, jobVolume: 5, reputation: 15 } as const;

function clamp(value: number) { return Math.max(0, Math.min(100, value)); }

function scoreAgent(agent: AgentRow, intent: ReturnType<typeof parseMarketplaceIntent>, endpoint: EndpointRow | undefined, reputationRows: ReputationRow[], onchain: OnchainAgentStats | null) {
  const capability = agent.category === intent.category ? 100 : intent.category === "other" ? 60 : 25;
  const verification = agent.verification_status === "verified" ? 100 : agent.verification_status === "pending" ? 70 : agent.verification_status === "indexed" ? 55 : 0;
  const livenessAvailable = Boolean(endpoint);
  const liveness = endpoint?.status === "online" ? 100 : endpoint?.status === "degraded" ? 60 : endpoint?.status === "offline" ? 15 : 0;
  const cacheScores = reputationRows.filter((row) => row.source !== "platform").map((row) => clamp(Number(row.score))).filter(Number.isFinite);
  const cachedReputation = cacheScores.length > 0 ? cacheScores.reduce((sum, score) => sum + score, 0) / cacheScores.length : null;
  const reputation = onchain?.reputation_score ?? cachedReputation ?? 0;
  const reputationAvailable = onchain ? onchain.feedback_count > 0 && onchain.reputation_score !== null : cachedReputation !== null;
  const totalJobs = onchain?.total_jobs ?? 0;
  const terminalJobs = onchain?.terminal_jobs ?? 0;
  const completionAvailable = terminalJobs > 0;
  const completion = completionAvailable ? clamp((onchain?.completed_jobs || 0) / terminalJobs * 100) : 0;
  const volumeAvailable = totalJobs > 0;
  const volume = volumeAvailable ? clamp(Math.log10(totalJobs + 1) * 50) : 0;
  const score = capability * 0.35 + verification * 0.2 + liveness * 0.15 + completion * 0.1 + volume * 0.05 + reputation * 0.15;
  const scoreMax = WEIGHTS.capability + WEIGHTS.verification + (livenessAvailable ? WEIGHTS.endpointLiveness : 0) + (completionAvailable ? WEIGHTS.completion : 0) + (volumeAvailable ? WEIGHTS.jobVolume : 0) + (reputationAvailable ? WEIGHTS.reputation : 0);
  const evidenceCount = [reputationAvailable, completionAvailable, volumeAvailable, livenessAvailable].filter(Boolean).length;
  const scoreConfidence = evidenceCount >= 3 ? "high" : evidenceCount === 2 ? "medium" : "low";
  const normalizedScore = scoreMax > 0 ? Math.round((score / scoreMax) * 10000) / 100 : 0;
  const reasons: string[] = [];
  if (capability === 100) reasons.push("Strong capability match"); else if (intent.category === "other") reasons.push("General DeFi capability match");
  if (verification >= 70) reasons.push(`ERC-8004 identity ${agent.verification_status}`);
  if (endpoint?.status === "online") reasons.push("Endpoint is healthy");
  if (onchain?.completed_jobs) reasons.push(`${onchain.completed_jobs} completed Testnet jobs verified onchain`);
  else if (onchain?.total_jobs) reasons.push(`${onchain.total_jobs} ERC-8183 Testnet jobs verified onchain`);
  if (reputationAvailable) reasons.push("ERC-8004 reputation history available onchain"); else reasons.push("ERC-8004 reputation history not yet available");
  const hireability = endpoint?.status === "online"
    ? { status: "ready" as const, canCreateJob: true, reason: "A live Testnet provider endpoint is currently reporting healthy." }
    : endpoint?.status === "degraded"
      ? { status: "degraded" as const, canCreateJob: false, reason: "The Testnet provider endpoint is reachable but degraded; do not fund a job yet." }
      : { status: "discoverable_only" as const, canCreateJob: false, reason: "The agent is discoverable on BSC Testnet, but no healthy Testnet provider endpoint is available." };
  return {
    score: normalizedScore,
    scoreMax,
    scoreConfidence,
    hireability,
    breakdown: {
      capability: Math.round(capability * 0.35),
      verification: Math.round(verification * 0.2),
      endpointLiveness: Math.round(liveness * 0.15),
      completion: Math.round(completion * 0.1),
      jobVolume: Math.round(volume * 0.05),
      reputation: Math.round(reputation * 0.15),
    },
    evidence: { reputationAvailable, completionAvailable, livenessAvailable, onchainJobHistoryAvailable: volumeAvailable, onchainSource: onchain?.source || null },
    onchain: onchain ? {
      totalJobs: onchain.total_jobs,
      completedJobs: onchain.completed_jobs,
      submittedJobs: onchain.submitted_jobs,
      fundedJobs: onchain.funded_jobs,
      terminalJobs: onchain.terminal_jobs,
      successRate: onchain.success_rate,
      feedbackCount: onchain.feedback_count,
      reputationScore: onchain.reputation_score,
      reputationValue: onchain.reputation_value,
      reputationDecimals: onchain.reputation_decimals,
      agentWallet: onchain.agent_wallet,
      owner: onchain.owner,
      network: onchain.network,
      chainId: onchain.chain_id,
    } : null,
    reasons: reasons.slice(0, 5),
  };
}

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function readOnchainBatch(agents: AgentRow[]) {
  const results = new Map<string, OnchainAgentStats | null>();
  for (let start = 0; start < agents.length; start += 10) {
    const batch = agents.slice(start, start + 10);
    const values = await Promise.all(batch.map(async (agent) => {
      try { return [agent.agent_id, await readAgentOnchainStats(agent.agent_id)] as const; }
      catch { return [agent.agent_id, null] as const; }
    }));
    for (const [agentId, stats] of values) results.set(agentId, stats);
  }
  return results;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  const input = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  if (!input) return res.status(400).json({ error: "goal is required" });
  try {
    const supabase = serverClient();
    const intent = parseMarketplaceIntent(input);
    let agentsQuery = supabase.from("agents").select("id,agent_id,owner,uri,name,description,image,chain,category,status,source,verification_status,is_first_party").eq("chain", "bsc-testnet").limit(100);
    if (intent.category !== "other") agentsQuery = agentsQuery.eq("category", intent.category);
    const [{ data: agents, error: agentsError }, { data: endpoints, error: endpointsError }, { data: reputation, error: reputationError }] = await Promise.all([
      agentsQuery,
      supabase.from("agent_endpoints").select("agent_id,status,latency_ms,last_checked_at").order("last_checked_at", { ascending: false }),
      supabase.from("reputation").select("agent_id,score,source").limit(500),
    ]);
    if (agentsError) throw new Error(agentsError.message);
    if (endpointsError) throw new Error(endpointsError.message);
    if (reputationError) throw new Error(reputationError.message);
    const endpointByAgent = new Map<string, EndpointRow>();
    for (const endpoint of (endpoints ?? []) as EndpointRow[]) if (!endpointByAgent.has(endpoint.agent_id)) endpointByAgent.set(endpoint.agent_id, endpoint);
    const reputationByAgent = new Map<string, ReputationRow[]>();
    for (const row of (reputation ?? []) as ReputationRow[]) reputationByAgent.set(row.agent_id, [...(reputationByAgent.get(row.agent_id) ?? []), row]);
    const candidateAgents = ((agents ?? []) as AgentRow[]).filter((agent) => agent.verification_status !== "revoked");
    const onchainByAgent = await readOnchainBatch(candidateAgents);
    const matches = candidateAgents.map((agent) => ({ agent, ...scoreAgent(agent, intent, endpointByAgent.get(agent.id), reputationByAgent.get(agent.id) ?? [], onchainByAgent.get(agent.agent_id) ?? null) }))
      .sort((a, b) => a.hireability.canCreateJob !== b.hireability.canCreateJob ? (a.hireability.canCreateJob ? -1 : 1) : b.score - a.score)
      .slice(0, 10);
    const bestHireableMatch = matches.find((match) => match.hireability.canCreateJob) ?? null;
    return res.status(200).json({
      intent,
      bestMatch: matches[0] ?? null,
      bestHireableMatch,
      alternatives: matches.slice(1),
      network: { environment: "testnet", chain: "bsc-testnet", chain_id: 97 },
      scoring: {
        weights: WEIGHTS,
        hireabilityPolicy: "Only BSC Testnet agents with a currently healthy Testnet provider endpoint are hireable.",
        jobHistorySource: "ERC-8183 Commerce on BSC Testnet",
        reputationSource: "ERC-8004 Reputation Registry on BSC Testnet; Supabase reputation rows are fallback cache only",
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Testnet matching failed" });
  }
}
