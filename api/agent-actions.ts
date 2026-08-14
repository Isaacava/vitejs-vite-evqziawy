import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { getAddress } from "viem";

const ACTIONS = new Set(["accept", "start", "progress", "message", "submit"]);
const TRANSITIONS: Record<string, { from: string[]; to: string; requiresPayload?: boolean }> = {
  accept: { from: ["open", "funded"], to: "accepted" },
  start: { from: ["accepted"], to: "in_progress" },
  progress: { from: ["in_progress"], to: "in_progress", requiresPayload: true },
  message: { from: ["accepted", "in_progress"], to: "in_progress", requiresPayload: true },
  submit: { from: ["in_progress"], to: "submitted", requiresPayload: true },
};

function supabaseServer() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function authorized(req: VercelRequest) {
  const secret = process.env.AGENT_RUNTIME_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.authorization === `Bearer ${secret}`;
}

function normalize(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) return res.status(401).json({ error: "Agent runtime unauthorized" });
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const agentId = normalize(req.body?.agent_id);
    const chainJobId = normalize(req.body?.chain_job_id);
    const action = normalize(req.body?.action).toLowerCase();
    const payload = req.body?.payload;

    if (!agentId || !chainJobId || !ACTIONS.has(action)) {
      return res.status(400).json({ error: "agent_id, chain_job_id and a supported action are required" });
    }

    const transition = TRANSITIONS[action];
    if (transition.requiresPayload && (!payload || typeof payload !== "object")) {
      return res.status(400).json({ error: `${action} requires a payload` });
    }

    const supabase = supabaseServer();
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id,agent_id,owner,name")
      .eq("agent_id", agentId)
      .maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    if (agent.owner) {
      try {
        getAddress(agent.owner);
      } catch {
        return res.status(409).json({ error: "Agent provider wallet is invalid" });
      }
    } else {
      return res.status(409).json({ error: "Agent has no provider wallet" });
    }

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id,chain_job_id,status,provider_agent_id,mission_task_id")
      .eq("chain_job_id", Number(chainJobId))
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return res.status(404).json({ error: "Job is not indexed in the marketplace yet" });
    if (job.provider_agent_id !== agent.id) {
      return res.status(403).json({ error: "This agent is not the assigned provider for the job" });
    }

    const current = String(job.status || "").toLowerCase();
    if (!transition.from.includes(current)) {
      return res.status(409).json({ error: `Cannot ${action} a job in ${current || "unknown"} state` });
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };
    if (action !== "progress" && action !== "message") updates.status = transition.to;
    if (action === "submit") updates.deliverable = payload?.deliverable || payload?.result || null;

    const { data: updated, error: updateError } = await supabase
      .from("jobs")
      .update(updates)
      .eq("id", job.id)
      .select("id,chain_job_id,status,provider_agent_id,mission_task_id,deliverable")
      .single();
    if (updateError) throw new Error(updateError.message);

    if (action === "message" || action === "progress") {
      await supabase.from("messages").insert({
        job_id: job.id,
        sender: agent.id,
        kind: action,
        body: payload?.body || payload?.message || payload,
        metadata: { source: "agent_runtime" },
      });
    }

    return res.status(200).json({
      ok: true,
      action,
      job: updated,
      note: "Application state updated. On-chain submission/settlement still requires the ERC-8183 provider transaction flow.",
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to perform agent action" });
  }
}
