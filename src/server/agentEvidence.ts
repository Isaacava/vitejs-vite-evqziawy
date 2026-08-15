import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "./authHandlers.js";

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

    const { data: rows, error: jobsError } = await supabase
      .from("jobs")
      .select("id,chain_job_id,status,chain_status,description,budget,payment_token,chain_tx_hash,chain_last_synced_at,updated_at")
      .eq("provider_agent_id", agent.id)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (jobsError) throw new Error(jobsError.message);

    const jobs = rows || [];
    const statusCounts: Record<string, number> = {};
    const chainStatusCounts: Record<string, number> = {};
    let settledCount = 0;
    let failedOrDisputedCount = 0;

    for (const row of jobs) {
      const status = String(row.status || "unknown").toLowerCase();
      const chainStatus = String(row.chain_status || "unknown").toLowerCase();
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      chainStatusCounts[chainStatus] = (chainStatusCounts[chainStatus] || 0) + 1;
      if (["settled", "terminal", "completed"].includes(chainStatus) || ["settled", "terminal", "completed"].includes(status)) settledCount += 1;
      if (["failed", "disputed", "rejected", "refunded", "expired"].includes(chainStatus) || ["failed", "disputed", "rejected", "refunded", "expired"].includes(status)) failedOrDisputedCount += 1;
    }

    return res.status(200).json({
      ok: true,
      agent,
      history: {
        total_indexed_jobs: jobs.length,
        status_counts: statusCounts,
        chain_status_counts: chainStatusCounts,
        settled_count: settledCount,
        failed_disputed_or_recovered_count: failedOrDisputedCount,
        evidence_note: "Counts are derived from marketplace rows indexed for this provider. No black-box or missing-history score is generated.",
        recent_jobs: jobs.slice(0, 25),
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load agent evidence history" });
  }
}
