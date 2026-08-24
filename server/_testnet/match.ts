import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { parseMarketplaceIntent } from "../../src/lib/intent.js";

type CachedOnchainStats = {
  source: "erc8183_commerce" | "erc8183_commerce_provider_wallet";
  network: "bsc-testnet";
  chain_id: 97;
  synced_at: string;
  provider_address: string;
  total_jobs: number;
  completed_jobs: number;
  submitted_jobs: number;
  funded_jobs: number;
  open_jobs: number;
  rejected_jobs: number;
  expired_jobs: number;
  terminal_jobs: number;
  success_rate: number | null;
};

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
  metadata?: Record<string, unknown> | null;
};

type EndpointRow = { agent_id: string; status: string; latency_ms: number | null; last_checked_at: string | null };
type ReputationRow = { agent_id: string; score: number; source: string };
type OnchainStats = CachedOnchainStats & { feedback_count: number; reputation_score: number | null };

const WEIGHTS = { capability: 35, verification: 20, endpointLiveness: 15, completion: 10, jobVolume: 5, reputation: 15 } as const;
const TESTNET_CHAIN = "bsc-testnet";
const TESTNET_CHAIN_ID = 97;
const TESTNET_ENVIRONMENT = "testnet";
const GRID_AGENT_ID = "grid-strategy";

function clamp(value: number) { return Math.max(0, Math.min(100, value)); }

function isTestnetAgent(agent: AgentRow) {
  const metadata = agent.metadata ?? {};
  return agent.chain === TESTNET_CHAIN && metadata.environment === TESTNET_ENVIRONMENT;
}

function readCachedOnchainStats(agent: AgentRow): OnchainStats | null {
  const value = agent.metadata?.onchain_stats;
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<CachedOnchainStats>;
  if ((row.source !== "erc8183_commerce" && row.source !== "erc8183_commerce_provider_wallet") || row.network !== TESTNET_CHAIN || row.chain_id !== TESTNET_CHAIN_ID) return null;
  if (typeof row.provider_address !== "string" || typeof row.total_jobs !== "number" || typeof row.completed_jobs !== "number" || typeof row.terminal_jobs !== "number") return null;
  return {
    source: row.source,
    network: TESTNET_CHAIN,
    chain_id: TESTNET_CHAIN_ID,
    synced_at: typeof row.synced_at === "string" ? row.synced_at : "",
    provider_address: row.provider_address,
    total_jobs: row.total_jobs,
    completed_jobs: row.completed_jobs,
    submitted_jobs: typeof row.submitted_jobs === "number" ? row.submitted_jobs : 0,
    funded_jobs: typeof row.funded_jobs === "number" ? row.funded_jobs : 0,
    open_jobs: typeof row.open_jobs === "number" ? row.open_jobs : 0,
    rejected_jobs: typeof row.rejected_jobs === "number" ? row.rejected_jobs : 0,
    expired_jobs: typeof row.expired_jobs === "number" ? row.expired_jobs : 0,
    terminal_jobs: row.terminal_jobs,
    success_rate: typeof row.success_rate === "number" ? row.success_rate : null,
    feedback_count: 0,
    reputation_score: null,
  };
}

function scoreAgent(
  agent: AgentRow,
  intent: ReturnType<typeof parseMarketplaceIntent>,
  endpoint: EndpointRow | undefined,
  reputationRows: ReputationRow[],
  onchain: OnchainStats | null,
) {
  const capability = agent.category === intent.category ? 100 : intent.category === "other" ? 60 : 25;
  const verification = agent.verification_status === "verified" ? 100 : agent.verification_status === "pending" ? 70 : agent.verification_status === "indexed" ? 55 : 0;
  const livenessAvailable = Boolean(endpoint);
  const liveness = endpoint?.status === "online" ? 100 : endpoint?.status === "degraded" ? 60 : endpoint?.status === "offline" ? 15 : 0;

  const scores = reputationRows.filter((row) => row.source !== "platform").map((row) => clamp(Number(row.score))).filter(Number.isFinite);
  const cachedReputation = scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
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
  if (capability === 100) reasons.push("Strong capability match"); else if (intent.category === "other") reasons.push("General Testnet DeFi capability match");
  if (verification >= 70) reasons.push(`ERC-8004 Testnet identity ${agent.verification_status}`);
  if (endpoint?.status === "online") reasons.push("Testnet endpoint is healthy");
  if (onchain?.completed_jobs) reasons.push(`${onchain.completed_jobs} completed Testnet jobs verified onchain`);
  else if (onchain?.total_jobs) reasons.push(`${onchain.total_jobs} ERC-8183 Testnet jobs verified onchain`);
  if (reputationAvailable) reasons.push("On-chain reputation evidence available");
  if (!onchain?.total_jobs) reasons.push("On-chain job history not yet available");

  const ownerValid = /^0x[a-fA-F0-9]{40}$/.test(agent.owner);
  const isGrid = agent.agent_id === GRID_AGENT_ID;
  const gridIdentityReady = !isGrid || ownerValid;
  const hireability = !isTestnetAgent(agent)
    ? { status: "discoverable_only" as const, canCreateJob: false, reason: "Blocked: provider is not explicitly tagged for the isolated BSC Testnet environment." }
    : isGrid && !gridIdentityReady
      ? { status: "discoverable_only" as const, canCreateJob: false, reason: "Grid Agent owner address is not a valid BSC Testnet address yet." }
      : endpoint?.status === "online"
        ? { status: "ready" as const, canCreateJob: true, reason: "A live BSC Testnet provider endpoint is currently reporting healthy." }
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
    evidence: {
      reputationAvailable,
      completionAvailable,
      livenessAvailable,
      onchainJobHistoryAvailable: volumeAvailable,
      onchainSource: onchain?.source ?? null,
    },
    onchain: onchain ? {
      totalJobs: onchain.total_jobs,
      completedJobs: onchain.completed_jobs,
      submittedJobs: onchain.submitted_jobs,
      fundedJobs: onchain.funded_jobs,
      terminalJobs: onchain.terminal_jobs,
      successRate: onchain.success_rate,
      feedbackCount: onchain.feedback_count,
      reputationScore: onchain.reputation_score,
      agentWallet: onchain.provider_address,
      owner: agent.owner,
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  const input = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  if (!input) return res.status(400).json({ error: "goal is required" });

  try {
    const supabase = serverClient();
    const intent = parseMarketplaceIntent(input);
    let agentsQuery = supabase.from("agents").select("id,agent_id,owner,uri,name,description,image,chain,category,status,source,verification_status,is_first_party,metadata").eq("chain", TESTNET_CHAIN).limit(100);
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

    const candidateAgents = ((agents ?? []) as AgentRow[])
      .filter((agent) => agent.verification_status !== "revoked")
      .filter(isTestnetAgent);

    const matches = candidateAgents
      .map((agent) => ({
        agent,
        ...scoreAgent(agent, intent, endpointByAgent.get(agent.id), reputationByAgent.get(agent.id) ?? [], readCachedOnchainStats(agent)),
      }))
      .sort((a, b) => a.hireability.canCreateJob !== b.hireability.canCreateJob ? (a.hireability.canCreateJob ? -1 : 1) : b.score - a.score)
      .slice(0, 10);

    const bestHireableMatch = matches.find((match) => match.hireability.canCreateJob) ?? null;

    return res.status(200).json({
      intent,
      bestMatch: matches[0] ?? null,
      bestHireableMatch,
      alternatives: matches.slice(1),
      network: { environment: TESTNET_ENVIRONMENT, chain: TESTNET_CHAIN, chain_id: TESTNET_CHAIN_ID },
      scoring: {
        weights: WEIGHTS,
        hireabilityPolicy: "Only explicitly Testnet-tagged BSC Testnet agents with a healthy Testnet endpoint are hireable.",
        jobHistorySource: "ERC-8183 Commerce on BSC Testnet; cached in Supabase by the provider-wallet chain sync.",
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Testnet matching failed" });
  }
}
