import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { readAgentOnchainStats, type OnchainAgentStats } from "../src/server/testnetOnchain";

type Agent = {
  id: string;
  agent_id: string;
  metadata: Record<string, unknown> | null;
};

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function buildCachedStats(stats: OnchainAgentStats, syncedAt: string) {
  return {
    source: "erc8183_commerce" as const,
    network: stats.network,
    chain_id: stats.chain_id,
    synced_at: syncedAt,
    provider_address: stats.agent_wallet,
    owner_address: stats.owner,
    job_provider_addresses: stats.job_provider_addresses,
    total_jobs: stats.total_jobs,
    completed_jobs: stats.completed_jobs,
    submitted_jobs: stats.submitted_jobs,
    funded_jobs: stats.funded_jobs,
    open_jobs: stats.open_jobs,
    rejected_jobs: stats.rejected_jobs,
    expired_jobs: stats.expired_jobs,
    terminal_jobs: stats.terminal_jobs,
    success_rate: stats.success_rate,
    feedback_count: stats.feedback_count,
    reputation_value: stats.reputation_value,
    reputation_decimals: stats.reputation_decimals,
    reputation_score: stats.reputation_score,
    job_counter_scope: "full_erc8183_commerce_scan",
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (process.env.NODE_ENV === "production" && !cronSecret) {
    return res.status(503).json({ error: "CRON_SECRET must be configured before agent statistics sync is enabled" });
  }

  try {
    const supabase = serverClient();
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select("id,agent_id,metadata")
      .eq("chain", "bsc-testnet")
      .not("agent_id", "is", null);

    if (agentsError) throw new Error(agentsError.message);

    const agentRows = (agents || []) as Agent[];
    if (agentRows.length === 0) {
      return res.status(200).json({
        ok: true,
        network: "bsc-testnet",
        chain_id: 97,
        source: "erc8183_commerce",
        agents_scanned: 0,
        agents_updated: 0,
        jobs_scanned: 0,
      });
    }

    const syncedAt = new Date().toISOString();

    // Use the exact same on-chain reader used by the marketplace matcher.
    // It resolves ERC-8004 owner + configured agent wallet and scans the full
    // ERC-8183 Commerce jobCounter, so the cron cannot drift from matching.
    const statsResults = await Promise.allSettled(
      agentRows.map((agent) => readAgentOnchainStats(agent.agent_id)),
    );

    let updated = 0;
    let failed = 0;
    let jobsScanned = 0;
    const errors: Array<{ agent_id: string; error: string }> = [];

    for (let i = 0; i < agentRows.length; i += 1) {
      const agent = agentRows[i];
      const result = statsResults[i];

      if (result.status === "rejected") {
        failed += 1;
        errors.push({
          agent_id: agent.agent_id,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
        continue;
      }

      const stats = result.value;
      jobsScanned = Math.max(jobsScanned, stats.jobs.length);
      const nextMetadata = {
        ...(agent.metadata || {}),
        onchain_stats: buildCachedStats(stats, syncedAt),
      };

      const { error: updateError } = await supabase
        .from("agents")
        .update({ metadata: nextMetadata, last_indexed_at: syncedAt })
        .eq("id", agent.id);

      if (updateError) {
        throw new Error(`Agent ${agent.agent_id}: ${updateError.message}`);
      }

      updated += 1;
    }

    return res.status(200).json({
      ok: failed === 0,
      network: "bsc-testnet",
      chain_id: 97,
      source: "erc8183_commerce",
      agents_scanned: agentRows.length,
      agents_updated: updated,
      agents_failed: failed,
      jobs_scanned: jobsScanned,
      synced_at: syncedAt,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("BSC Testnet agent statistics sync failed", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Agent statistics sync failed",
    });
  }
}
