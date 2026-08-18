import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { parseMarketplaceIntent } from "../../src/lib/intent.js";

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

function scoreAgent(agent: AgentRow, intent: ReturnType<typeof parseMarketplaceIntent>, endpoint: EndpointRow | undefined, reputationRows: ReputationRow[]) {
  const capability = agent.category === intent.category ? 100 : intent.category === "other" ? 60 : 25;
  const verification = agent.verification_status === "verified" ? 100 : agent.verification_status === "pending" ? 70 : agent.verification_status === "indexed" ? 55 : 0;
  const livenessAvailable = Boolean(endpoint);
  const liveness = endpoint?.status === "online" ? 100 : endpoint?.status === "degraded" ? 60 : endpoint?.status === "offline" ? 15 : 0;
  const scores = reputationRows.filter((row) => row.source !== "platform").map((row) => clamp(Number(row.score))).filter(Number.isFinite);
  const reputationAvailable = scores.length > 0;
  const reputation = reputationAvailable ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  const volumeAvailable = scores.length > 0;
  const volume = volumeAvailable ? clamp(Math.log10(scores.length + 1) * 60) : 0;
  const completionAvailable = reputationAvailable;
  const completion = completionAvailable ? reputation : 0;
  const score = capability * 0.35 + verification * 0.2 + liveness * 0.15 + completion * 0.1 + volume * 0.05 + reputation * 0.15;
  const scoreMax = WEIGHTS.capability + WEIGHTS.verification + (livenessAvailable ? WEIGHTS.endpointLiveness : 0) + (completionAvailable ? WEIGHTS.completion : 0) + (volumeAvailable ? WEIGHTS.jobVolume : 0) + (reputationAvailable ? WEIGHTS.reputation : 0);
  const evidenceCount = [reputationAvailable, completionAvailable, livenessAvailable].filter(Boolean).length;
  const scoreConfidence = evidenceCount >= 2 ? "high" : evidenceCount === 1 ? "medium" : "low";
  const normalizedScore = scoreMax > 0 ? Math.round((score / scoreMax) * 10000) / 100 : 0;
  const reasons: string[] = [];
  if (capability === 100) reasons.push("Strong capability match"); else if (intent.category === "other") reasons.push("General Testnet DeFi capability match");
  if (verification >= 70) reasons.push(`ERC-8004 Testnet identity ${agent.verification_status}`);
  if (endpoint?.status === "online") reasons.push("Testnet endpoint is healthy");
  if (reputationAvailable) reasons.push("On-chain reputation evidence available"); else reasons.push("Reputation history not yet available");
  if (completionAvailable) reasons.push("Verified outcome history available"); else reasons.push("Completion history not yet available");

  const ownerValid = /^0x[a-f-fA-F0-9]{40}$/.test(agent.owner);
  const isGrid = agent.agent_id === GRID_AGENT_ID;
  const gridIdentityReady = !isGrid || (agent.is_first_party && ownerValid);
  const hireability = !isTestnetAgent(agent)
    ? { status: "discoverable_only" as const, canCreateJob: false, reason: "Blocked: provider is not explicitly tagged for the isolated BSC Testnet environment." }
    : isGrid && !gridIdentityReady
      ? { status: "discoverable_only" as const, canCreateJob: false, reason: "Grid Agent endpoint is healthy, but its BSC Testnet ERC-8004 owner identity has not been synced. No job can be created until the real Testnet owner is verified on-chain." }
      : endpoint?.status === "online"
        ? { status: "ready" as const, canCreateJob: true, reason: "A live BSC Testnet provider endpoint and verified Testnet identity are currently available." }
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
    evidence: { reputationAvailable, completionAvailable, livenessAvailable },
    reasons: reasons.slice(0, 4),
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
    const matches = ((agents ?? []) as AgentRow[])
      .filter((agent) => agent.verification_status !== "revoked")
      .filter(isTestnetAgent)
      .map((agent) => ({ agent, ...scoreAgent(agent, intent, endpointByAgent.get(agent.id), reputationByAgent.get(agent.id) ?? []) }))
      .sort((a, b) => a.hireability.canCreateJob !== b.hireability.canCreateJob ? (a.hireability.canCreateJob ? -1 : 1) : b.score - a.score)
      .slice(0, 10);
    const bestHireableMatch = matches.find((match) => match.hireability.canCreateJob) ?? null;
    return res.status(200).json({
      intent,
      bestMatch: matches[0] ?? null,
      bestHireableMatch,
      alternatives: matches.slice(1),
      network: { environment: TESTNET_ENVIRONMENT, chain: TESTNET_CHAIN, chain_id: TESTNET_CHAIN_ID },
      scoring: { weights: WEIGHTS, hireabilityPolicy: "Only explicitly Testnet-tagged BSC Testnet agents with a healthy Testnet endpoint and verified identity are hireable." },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Testnet matching failed" });
  }
}
