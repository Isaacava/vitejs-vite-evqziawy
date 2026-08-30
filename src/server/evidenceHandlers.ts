import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "./authHandlers.js";
import { readAgentOnchainStats } from "./testnetOnchain.js";

export async function evidence(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  const agentId = typeof req.query.agent_id === "string" ? req.query.agent_id.trim() : "";
  if (!agentId) return res.status(400).json({ error: "agent_id is required" });

  try {
    const supabase = serverClient();
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id,agent_id,name,owner,status,verification_status,category")
      .eq("agent_id", agentId)
      .maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    if (!agent.owner || agent.owner.toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ error: "Agent owner authentication required" });
    }

    const onchain = await readAgentOnchainStats(agentId);
    if (onchain.owner.toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ error: "Connected wallet is no longer the ERC-8004 owner of this agent" });
    }

    const counts: Record<string, number> = {};
    for (const job of onchain.jobs) counts[job.chain_status] = (counts[job.chain_status] || 0) + 1;
    const successful = onchain.completed_jobs;
    const outcomeRate = onchain.terminal_jobs > 0 ? Number(((successful / onchain.terminal_jobs) * 100).toFixed(1)) : null;

    return res.status(200).json({
      ok: true,
      agent,
      network: "bsc-testnet",
      chain_id: 97,
      source: "ERC-8004 Identity Registry + ERC-8183 Commerce onchain",
      onchain: {
        agent_wallet: onchain.agent_wallet,
        owner: onchain.owner,
        agent_uri: onchain.agent_uri,
        total_jobs: onchain.total_jobs,
        completed_jobs: onchain.completed_jobs,
        submitted_jobs: onchain.submitted_jobs,
        funded_jobs: onchain.funded_jobs,
        open_jobs: onchain.open_jobs,
        rejected_jobs: onchain.rejected_jobs,
        expired_jobs: onchain.expired_jobs,
        terminal_jobs: onchain.terminal_jobs,
        success_rate: onchain.success_rate,
        feedback_count: onchain.feedback_count,
        reputation_value: onchain.reputation_value,
        reputation_decimals: onchain.reputation_decimals,
        reputation_score: onchain.reputation_score,
      },
      outcomes: {
        scanned: onchain.total_jobs,
        counts,
        terminal_total: onchain.terminal_jobs,
        successful_terminal: successful,
        verified_outcome_rate: outcomeRate,
        methodology: "All ERC-8183 jobs created for the agent wallet/owner are read from BSC Testnet and each job status is verified with Commerce.getJob().",
      },
      jobs: onchain.jobs.map((job) => ({
        id: job.chain_job_id,
        chain_job_id: Number(job.chain_job_id),
        status: job.chain_status,
        chain_status: job.chain_status,
        budget: job.budget,
        description: job.description,
        client: job.client,
        provider: job.provider,
        evaluator: job.evaluator,
        submitted_at: job.submitted_at,
        expired_at: job.expired_at,
        deliverable: job.deliverable,
        tx_hash: job.transaction_hash,
        block_number: job.block_number,
        source: "erc8183_onchain",
      })),
      cached_marketplace_rows: "not used as the source of job counts or outcomes",
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load agent evidence" });
  }
}
