import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "./authHandlers.js";

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

    const { data: jobs, error: jobsError } = await supabase
      .from("jobs")
      .select("id,chain_job_id,status,chain_status,budget,updated_at,created_at,mission_task_id")
      .eq("provider_agent_id", agent.id)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (jobsError) throw new Error(jobsError.message);

    const rows = jobs || [];
    const counts = rows.reduce<Record<string, number>>((acc, job: any) => {
      const state = String(job.chain_status || job.status || "unknown").toLowerCase();
      acc[state] = (acc[state] || 0) + 1;
      return acc;
    }, {});

    const terminalStates = new Set(["completed", "rejected", "expired", "refunded", "settled"]);
    const terminalTotal = Object.entries(counts).reduce((sum, [state, count]) => terminalStates.has(state) ? sum + count : sum, 0);
    const successful = (counts.completed || 0) + (counts.settled || 0);
    const outcomeRate = terminalTotal > 0 ? Number(((successful / terminalTotal) * 100).toFixed(1)) : null;

    return res.status(200).json({
      ok: true,
      agent,
      network: "marketplace",
      source: "AgentMarket verified job records",
      outcomes: {
        scanned: rows.length,
        counts,
        terminal_total: terminalTotal,
        successful_terminal: successful,
        verified_outcome_rate: outcomeRate,
        methodology: "successful terminal outcomes divided by verified terminal outcomes; no score is produced when terminal history is empty"
      },
      jobs: rows.map((job: any) => ({
        id: job.id,
        chain_job_id: job.chain_job_id,
        status: job.status,
        chain_status: job.chain_status,
        budget: job.budget,
        created_at: job.created_at,
        updated_at: job.updated_at
      }))
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load agent evidence" });
  }
}
