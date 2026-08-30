import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "./authHandlers.js";
import { readAgentOnchainStats } from "./testnetOnchain.js";

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function runtimeAuthorized(req: VercelRequest) {
  const secret = process.env.AGENT_RUNTIME_SECRET;
  return !secret ? process.env.NODE_ENV !== "production" : req.headers.authorization === `Bearer ${secret}`;
}

async function authorizedForAgent(req: VercelRequest, owner: string | null | undefined) {
  if (runtimeAuthorized(req)) return true;
  const auth = await getAuthenticatedUser(req);
  return !!auth && typeof owner === "string" && auth.user.wallet_address.toLowerCase() === owner.toLowerCase();
}

export async function history(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const agentId = typeof req.query.agent_id === "string" ? req.query.agent_id.trim() : "";
    if (!agentId) return res.status(400).json({ error: "agent_id is required" });

    const supabase = db();
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id,agent_id,owner,name,status,verification_status")
      .eq("agent_id", agentId)
      .maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    if (!(await authorizedForAgent(req, agent.owner))) return res.status(401).json({ error: "Agent owner authentication required" });

    const onchain = await readAgentOnchainStats(agentId);
    if (agent.owner && onchain.owner.toLowerCase() !== agent.owner.toLowerCase() && !runtimeAuthorized(req)) {
      return res.status(409).json({ error: "Indexed owner does not match the current ERC-8004 owner", source: "erc8004_identity" });
    }

    const statusCounts: Record<string, number> = {};
    for (const row of onchain.jobs) {
      statusCounts[row.chain_status] = (statusCounts[row.chain_status] || 0) + 1;
    }

    return res.status(200).json({
      ok: true,
      agent,
      history: {
        total_indexed_jobs: onchain.total_jobs,
        total_onchain_jobs: onchain.total_jobs,
        status_counts: statusCounts,
        chain_status_counts: statusCounts,
        completed_jobs: onchain.completed_jobs,
        terminal_jobs: onchain.terminal_jobs,
        success_rate: onchain.success_rate,
        feedback_count: onchain.feedback_count,
        reputation_score: onchain.reputation_score,
        settled_count: onchain.completed_jobs,
        failed_disputed_or_recovered_count: onchain.rejected_jobs + onchain.expired_jobs,
        evidence_note: "Counts and outcomes are derived directly from BSC Testnet ERC-8183 job events and Commerce.getJob(). Supabase is used only for agent metadata and owner-scoped access.",
        source: "ERC-8004 + ERC-8183 onchain",
        agent_wallet: onchain.agent_wallet,
        recent_jobs: onchain.jobs.slice(0, 25),
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load agent evidence history" });
  }
}
