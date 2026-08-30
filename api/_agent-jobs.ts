import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const ACTIONS = new Set(["accept", "start", "progress", "message", "submit"]);
const TRANSITIONS: Record<string, Record<string, string>> = {
  open: { accept: "accepted" },
  funded: { accept: "accepted" },
  accepted: { start: "in_progress" },
  in_progress: { submit: "submitted" },
};

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function runtimeAuthorized(req: VercelRequest) {
  const secret = process.env.AGENT_RUNTIME_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.authorization === `Bearer ${secret}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!runtimeAuthorized(req)) return res.status(401).json({ error: "Agent runtime unauthorized" });

  try {
    const supabase = serverClient();
    const agentId = typeof req.query.agent_id === "string" ? req.query.agent_id : typeof req.body?.agent_id === "string" ? req.body.agent_id : "";

    if (req.method === "GET") {
      if (!agentId) return res.status(400).json({ error: "agent_id is required" });
      const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,name,status,verification_status").eq("agent_id", agentId).maybeSingle();
      if (agentError) throw new Error(agentError.message);
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      const { data: jobs, error: jobsError } = await supabase
        .from("jobs")
        .select("id,mission_task_id,provider_agent_id,status,description,budget,chain_job_id,created_at,updated_at")
        .eq("provider_agent_id", agent.id)
        .in("status", ["open", "funded", "accepted", "in_progress", "submitted"])
        .order("created_at", { ascending: false });
      if (jobsError) throw new Error(jobsError.message);

      return res.status(200).json({ agent, jobs: jobs || [] });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const jobId = typeof req.body?.job_id === "string" ? req.body.job_id : "";
    const action = typeof req.body?.action === "string" ? req.body.action : "";
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const deliverable = typeof req.body?.deliverable === "string" ? req.body.deliverable.trim() : "";
    if (!agentId) return res.status(400).json({ error: "agent_id is required" });
    if (!jobId) return res.status(400).json({ error: "job_id is required" });
    if (!ACTIONS.has(action)) return res.status(400).json({ error: "Unsupported agent action" });

    const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,name").eq("agent_id", agentId).maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const { data: job, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,provider_agent_id,status,description,budget,chain_job_id").eq("id", jobId).maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.provider_agent_id !== agent.id) return res.status(403).json({ error: "Agent is not the assigned provider for this job" });

    if (action === "progress" || action === "message") {
      if (!message) return res.status(400).json({ error: `${action} requires message` });
      await supabase.from("messages").insert({
        task_id: job.mission_task_id,
        sender: agent.agent_id,
        recipient: "mission",
        body: message,
        created_at: new Date().toISOString(),
      });
      return res.status(200).json({ ok: true, action, job_id: job.id, message_recorded: true });
    }

    if (action === "submit" && !deliverable) return res.status(400).json({ error: "deliverable is required for submit" });
    const nextStatus = TRANSITIONS[job.status]?.[action];
    if (!nextStatus) return res.status(409).json({ error: `Cannot ${action} a job in ${job.status} state` });

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: nextStatus, updated_at: now };
    if (action === "accept") patch.accepted_at = now;
    if (action === "submit") {
      patch.submitted_at = now;
      patch.deliverable = deliverable;
    }

    const { data: updated, error: updateError } = await supabase.from("jobs").update(patch).eq("id", job.id).select("*").single();
    if (updateError) throw new Error(updateError.message);

    if (job.mission_task_id) {
      const taskStatus: Record<string, string> = { accepted: "accepted", in_progress: "in_progress", submitted: "submitted" };
      const mapped = taskStatus[nextStatus];
      if (mapped) await supabase.from("mission_tasks").update({ status: mapped, updated_at: now }).eq("id", job.mission_task_id);
    }

    if (action === "submit") {
      await supabase.from("evaluations").upsert({
        job_id: job.id,
        verdict: "pending",
        evidence: { source: "agent_runtime", deliverable, agent_id: agent.agent_id, submitted_at: now },
        updated_at: now,
      }, { onConflict: "job_id" });
    }

    await supabase.from("notifications").insert({
      task_id: job.mission_task_id,
      recipient: job.provider_agent_id,
      kind: `agent_${action}`,
      title: `Agent ${action}`,
      body: message || `Agent ${agent.agent_id} moved job ${job.id} to ${nextStatus}.`,
    });

    return res.status(200).json({ ok: true, agent: agent.agent_id, job: updated, state: nextStatus });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Agent runtime request failed" });
  }
}
