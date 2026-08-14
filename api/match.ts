import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { parseMarketplaceIntent } from "../src/lib/intent.js";

type AgentRow = {
  agent_id: string;
  owner: string;
  uri: string;
  name: string | null;
  description: string | null;
  image: string | null;
  chain: string;
  category: string;
  verified?: boolean | null;
  reputation_score?: number | null;
  completion_rate?: number | null;
  jobs_completed?: number | null;
  endpoint_status?: string | null;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function scoreAgent(agent: AgentRow, intent: ReturnType<typeof parseMarketplaceIntent>) {
  const capability = agent.category === intent.category ? 100 : intent.category === "other" ? 60 : 25;
  const verification = agent.verified ? 100 : 50;
  const reputation = clamp(Number(agent.reputation_score ?? 0));
  const completion = clamp(Number(agent.completion_rate ?? 0));
  const volume = clamp((Number(agent.jobs_completed ?? 0) / 100) * 100);
  const liveness = agent.endpoint_status === "online" ? 100 : agent.endpoint_status === "degraded" ? 60 : 30;

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

  const input = typeof req.body?.goal === "string" ? req.body.goal : "";
  if (!input.trim()) return res.status(400).json({ error: "goal is required" });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: "Supabase server configuration is missing" });

  const intent = parseMarketplaceIntent(input);
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let query = supabase.from("agents").select("*").limit(50);
  if (intent.category !== "other") query = query.eq("category", intent.category);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const matches = ((data ?? []) as AgentRow[])
    .map((agent) => ({ agent, ...scoreAgent(agent, intent) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return res.status(200).json({
    intent,
    bestMatch: matches[0] ?? null,
    alternatives: matches.slice(1),
  });
}
