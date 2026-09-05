import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function metadataUrls(agent: Record<string, unknown>): string[] {
  const metadata = object(agent.metadata);
  const execution = object(metadata.execution);
  return [
    metadata.execution_decision_url,
    metadata.execution_decisions_url,
    execution.execution_decision_url,
    execution.execution_decisions_url,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim());
}
function decisionUrls(base: string, jobId: number): string[] {
  const clean = base.replace(/\/+$/, "");
  const urls = [`${clean}/job/${jobId}/decision`];
  if (!clean.endsWith("/erc8183")) urls.push(`${clean}/erc8183/job/${jobId}/decision`);
  return urls;
}

function resolveAdvertisedEndpoint(base: string, advertised: string, jobId: number): string | null {
  if (!advertised || typeof advertised !== "string") return null;
  const normalized = advertised.replace("{job_id}", String(jobId)).replace("{jobId}", String(jobId));
  try {
    return new URL(normalized, `${base.replace(/\/+$/, "")}/`).toString();
  } catch {
    return null;
  }
}

async function discoverDecisionUrls(base: string, jobId: number): Promise<string[]> {
  const clean = base.replace(/\/+$/, "");
  try {
    const response = await fetch(clean, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (response.ok) {
      const manifest = object(await response.json());
      const endpoints = object(manifest.endpoints);
      const advertised = [
        endpoints.decision,
        endpoints.execution_decision,
        endpoints.executionDecision,
        manifest.decision_url,
        manifest.execution_decision_url,
      ];
      const resolved = advertised
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => resolveAdvertisedEndpoint(clean, value, jobId))
        .filter((value): value is string => Boolean(value));
      return [...new Set(resolved)];
    }
  } catch {
    // Fall back to explicit metadata/protocol routes below.
  }
  return [];
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
    const { data: job, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,client_wallet,chain_job_id").eq("chain_job_id", chainJobId).maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job || !job.mission_task_id) return res.status(404).json({ ok: false, error: "Marketplace job not found" });
    if (!auth.user.wallet_address || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ ok: false, error: "The authenticated wallet does not own this job" });

    const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,agent_id").eq("id", job.mission_task_id).maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task?.agent_id) return res.status(409).json({ ok: false, error: "Job does not identify a provider agent" });
    const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,metadata").eq("id", task.agent_id).maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ ok: false, error: "Provider agent not found" });
    const { data: endpoints, error: endpointError } = await supabase.from("agent_endpoints").select("endpoint_url").eq("agent_id", String(agent.id)).limit(20);
    if (endpointError) throw new Error(endpointError.message);

    const bases = [...new Set([
      ...metadataUrls(agent as Record<string, unknown>),
      ...(endpoints || []).map((entry) => String(entry.endpoint_url || "").trim()).filter(Boolean),
    ])];
    const candidates = [] as string[];
    for (const base of bases) {
      candidates.push(...await discoverDecisionUrls(base, chainJobId));
      candidates.push(...decisionUrls(base, chainJobId));
    }

    for (const candidate of [...new Set(candidates)]) {
      try {
        const response = await fetch(candidate, { headers: { Accept: "application/json" }, cache: "no-store" });
        if (!response.ok) continue;
        const body = object(await response.json());
        if (body.execution_required !== undefined && body.decision) {
          return res.status(200).json({ ok: true, source_url: candidate, ...body });
        }
      } catch { /* Try the next provider-declared decision endpoint. */ }
    }
    return res.status(202).json({ ok: false, pending: true, error: "The provider has not published a decision for this funded ERC-8183 job yet." });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to resolve provider execution decision" });
  }
}
