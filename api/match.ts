import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { parseMarketplaceIntent } from "../src/lib/intent.js";

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

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function scoreAgent(
  agent: AgentRow,
  intent: ReturnType<typeof parseMarketplaceIntent>,
  endpoint: EndpointRow | undefined,
  reputationRows: ReputationRow[],
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

  const liveness = endpoint?.status === "online"
    ? 100
    : endpoint?.status === "degraded"
      ? 60
      : endpoint?.status === "offline"
        ? 15
        : 35;

  const onChainScores = reputationRows
    .filter((row) => row.source !== "platform")
    .map((row) => clamp(Number(row.score)))
    .filter((score) => Number.isFinite(score));

  const reputation = onChainScores.length
    ? onChainScores.reduce((sum, score) => sum + score, 0) / onChainScores.length
    : 50;

  // New ERC-8004 agents are intentionally not penalized for having no history.
  const volume = onChainScores.length ? clamp(Math.log10(onChainScores.length + 1) * 60) : 0;
  const completion = onChainScores.length ? reputation : 50;

  const score =
    capability * 0.35 +
    verification * 0.20 +
    liveness * 0.15 +
    completion * 0.10 +
    volume * 0.05 +
    reputation * 0.15;

  return {
    score: Math.round(score * 100) / 100,
    breakdown: {
      capability: Math.round(capability),
      verification: Math.round(verification),
      endpointLiveness: Math.round(liveness),
      completion: Math.round(completion),
      jobVolume: Math.round(volume),
      reputation: Math.round(reputation),
    },
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

  const [{ data: agents, error: agentsError }, { data: endpoints, error: endpointsError }, { data: reputation, error: reputationError }] = await Promise.all([
    agentsQuery,
    supabase.from("agent_endpoints").select("agent_id,status,latency_ms,last_checked_at").order("last_checked_at", { ascending: false }),
    supabase.from("reputation").select("agent_id,score,source").limit(500),
  ]);

  if (agentsError) return res.status(500).json({ error: agentsError.message });
  if (endpointsError) return res.status(500).json({ error: endpointsError.message });
  if (reputationError) return res.status(500).json({ error: reputationError.message });

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

  const matches = ((agents ?? []) as AgentRow[])
    .filter((agent) => agent.verification_status !== "revoked")
    .map((agent) => ({
      agent,
      ...scoreAgent(agent, intent, endpointByAgent.get(agent.id), reputationByAgent.get(agent.id) ?? []),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return res.status(200).json({
    intent,
    bestMatch: matches[0] ?? null,
    alternatives: matches.slice(1),
    scoring: {
      capability: 0.35,
      verification: 0.20,
      endpointLiveness: 0.15,
      completion: 0.10,
      jobVolume: 0.05,
      reputation: 0.15,
      historyPolicy: "New agents receive a neutral history score until real job outcomes exist.",
    },
  });
}
