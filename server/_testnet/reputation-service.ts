import type { Address } from "viem";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";

function normalizeAddress(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function scoreFromVerdict(verdict: unknown): number | null {
  if (verdict === "approve") return 100;
  if (verdict === "reject") return 0;
  return null;
}

export async function refreshAgentReputation(provider: Address | string) {
  const supabase = serverClient();
  const providerAddress = normalizeAddress(provider);
  if (!providerAddress) return null;

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("agent_id,owner,name,uri,metadata")
    .ilike("owner", providerAddress)
    .limit(1)
    .maybeSingle();
  if (agentError) throw new Error(agentError.message);
  if (!agent) return null;

  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select("id,chain_status")
    .ilike("provider_address", providerAddress)
    .in("chain_status", ["completed", "rejected", "expired"])
    .limit(500);
  if (jobsError) throw new Error(jobsError.message);

  const jobIds = (jobs || []).map((job) => job.id).filter(Boolean);
  let evaluations: Array<{ job_id: string; verdict: string | null; evidence: unknown }> = [];
  if (jobIds.length) {
    const { data, error } = await supabase
      .from("evaluations")
      .select("job_id,verdict,evidence")
      .in("job_id", jobIds);
    if (error) throw new Error(error.message);
    evaluations = (data || []) as Array<{ job_id: string; verdict: string | null; evidence: unknown }>;
  }

  const completed = (jobs || []).filter((job) => job.chain_status === "completed").length;
  const rejected = (jobs || []).filter((job) => job.chain_status === "rejected").length;
  const expired = (jobs || []).filter((job) => job.chain_status === "expired").length;
  const verifiedScores = evaluations.map((evaluation) => scoreFromVerdict(evaluation.verdict)).filter((value): value is number => value !== null);
  const avgScore = verifiedScores.length ? verifiedScores.reduce((sum, value) => sum + value, 0) / verifiedScores.length : null;
  const successRate = completed + rejected + expired > 0 ? (completed / (completed + rejected + expired)) * 100 : null;

  const snapshot = {
    protocol: "erc-8004",
    agent_id: agent.agent_id ?? null,
    provider: providerAddress,
    verified_outcomes: verifiedScores.length,
    completed,
    rejected,
    expired,
    success_rate: successRate === null ? null : Number(successRate.toFixed(2)),
    average_verified_score: avgScore === null ? null : Number(avgScore.toFixed(2)),
    source: "agentmarket_erc8183_verified_outcomes",
    refreshed_at: new Date().toISOString(),
  };

  const metadata = agent.metadata && typeof agent.metadata === "object" ? agent.metadata as Record<string, unknown> : {};
  const mergedMetadata = { ...metadata, agentmarket_reputation: snapshot };
  const { error: updateError } = await supabase.from("agents").update({ metadata: mergedMetadata }).eq("agent_id", agent.agent_id);
  if (updateError) throw new Error(updateError.message);

  return { agent, snapshot };
}

export async function reputationHandler(req: any, res: any) {
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const provider = typeof req.query?.provider === "string" ? req.query.provider.trim() : "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(provider)) return res.status(400).json({ error: "A valid provider address is required" });

  try {
    const result = await refreshAgentReputation(provider);
    if (!result) return res.status(404).json({ error: "Agent not found for provider" });
    return res.status(200).json({ ok: true, ...result.snapshot, agent: {
      agent_id: result.agent.agent_id,
      name: result.agent.name,
      owner: result.agent.owner,
      uri: result.agent.uri,
    } });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to calculate agent reputation" });
  }
}
