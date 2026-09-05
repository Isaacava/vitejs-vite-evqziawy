import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
import { invokeProviderOperation, resolveProviderOperation } from "./provider-operation.js";

type EndpointRecord = { endpoint_url: string; protocol: string; status: string; metadata?: unknown; version?: string | null };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    const chainJobIdRaw = typeof req.query?.job === "string" ? req.query.job.trim() : "";
    if (!/^\d+$/.test(chainJobIdRaw)) return res.status(400).json({ ok: false, error: "job must be a numeric ERC-8183 job id" });
    const chainJobId = Number(chainJobIdRaw);
    const supabase = serverClient();

    const { data: job, error: jobError } = await supabase.from("jobs")
      .select("id,mission_task_id,client_wallet,chain_job_id")
      .eq("chain_job_id", chainJobId).maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job || !job.mission_task_id) return res.status(404).json({ ok: false, error: "Marketplace job not found" });
    if (!auth.user.wallet_address || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ ok: false, error: "The authenticated wallet does not own this job" });

    const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,agent_id").eq("id", job.mission_task_id).maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task?.agent_id) return res.status(409).json({ ok: false, error: "Job does not identify a provider agent" });

    const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,metadata").eq("id", task.agent_id).maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ ok: false, error: "Provider agent not found" });

    const { data: endpoints, error: endpointError } = await supabase.from("agent_endpoints")
      .select("endpoint_url,protocol,status,metadata")
      .eq("agent_id", String(agent.id)).order("last_checked_at", { ascending: false }).limit(20);
    if (endpointError) throw new Error(endpointError.message);

    let lastError = "Provider has not published a decision yet.";
    for (const endpoint of (endpoints || []) as EndpointRecord[]) {
      const operation = await resolveProviderOperation(endpoint, "decision");
      if (!operation) continue;
      try {
        const result = await invokeProviderOperation(operation, {
          chain_job_id: chainJobId,
          job_id: job.id,
          agent_id: agent.agent_id,
          client_wallet: auth.user.wallet_address,
          network: "bsc-testnet",
        });
        const body = object(result.body);
        if (body.execution_required !== undefined || body.decision !== undefined || body.approved !== undefined || body.verdict !== undefined) {
          return res.status(200).json({ ok: true, source_url: result.endpoint, operation: { action: operation.action, endpoint: result.endpoint, method: operation.method, transport: operation.transport, name: operation.name }, ...body });
        }
        lastError = "Provider decision operation returned no decision payload.";
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Provider decision operation failed";
      }
    }
    return res.status(202).json({ ok: false, pending: true, error: lastError });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to resolve provider execution decision" });
  }
}
