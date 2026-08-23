import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "./_auth.js";

const ACTIONS = new Set(["accept", "start", "submit", "approve", "reject", "cancel"]);

function transition(status: string, action: string) {
  const map: Record<string, Record<string, string>> = {
    open: { accept: "accepted", cancel: "cancelled" },
    funded: { accept: "accepted", cancel: "cancelled" },
    accepted: { start: "in_progress", cancel: "cancelled" },
    in_progress: { submit: "submitted", cancel: "cancelled" },
    submitted: {},
    disputed: {},
  };
  return map[status]?.[action] ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const supabase = serverClient();
    const auth = await getAuthenticatedUser(req);

    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });

    if (req.method === "GET") {
      const id = typeof req.query.id === "string" ? req.query.id : "";
      if (!id) return res.status(400).json({ error: "id is required" });

      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .select("id,mission_task_id,provider_agent_id,client_wallet,status,description,budget,chain_job_id,chain_status,chain_last_synced_at,chain_tx_hash,chain_error,deliverable,created_at,funded_at,accepted_at,submitted_at,terminal_at,updated_at")
        .eq("id", id)
        .maybeSingle();
      if (jobError) return res.status(500).json({ error: jobError.message });
      if (!job) return res.status(404).json({ error: "Job not found" });

      const taskResult = job.mission_task_id
        ? await supabase.from("mission_tasks").select("id,mission_id,agent_id,title,role,description,budget,status,chain_job_id").eq("id", job.mission_task_id).maybeSingle()
        : { data: null, error: null };
      if (taskResult.error) return res.status(500).json({ error: taskResult.error.message });
      const missionId = taskResult.data?.mission_id ?? null;
      if (!missionId) return res.status(403).json({ error: "Job is not attached to a user mission" });

      const { data: mission, error: missionError } = await supabase
        .from("missions")
        .select("id,title,goal,category,budget,status,client_wallet,user_id,created_at,updated_at")
        .eq("id", missionId)
        .maybeSingle();
      if (missionError) return res.status(500).json({ error: missionError.message });
      if (!mission || mission.user_id !== auth.user.id) return res.status(403).json({ error: "You do not own this mission" });

      const [evaluationResult, paymentResult] = await Promise.all([
        supabase.from("evaluations").select("id,job_id,verdict,evaluator_address,evidence,notes,created_at,updated_at").eq("job_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("payments").select("id,job_id,mission_id,token_address,token_symbol,amount,status,tx_hash,created_at,updated_at").eq("job_id", id).maybeSingle(),
      ]);

      const safeMission = { ...mission };
      delete (safeMission as { user_id?: string }).user_id;

      return res.status(200).json({
        job,
        task: taskResult.data,
        mission: safeMission,
        evaluation: evaluationResult.data,
        payment: paymentResult.data,
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const id = typeof req.body?.job_id === "string" ? req.body.job_id.trim() : "";
    const action = typeof req.body?.action === "string" ? req.body.action.trim() : "";
    const deliverable = typeof req.body?.deliverable === "string" ? req.body.deliverable.trim() : "";
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";

    if (!id) return res.status(400).json({ error: "job_id is required" });
    if (!ACTIONS.has(action)) return res.status(400).json({ error: "Unsupported job action" });

    if (action === "approve" || action === "reject") {
      return res.status(409).json({
        error: "On-chain evaluation and settlement are not yet wired here. No payment or terminal state was changed.",
        protocol: { action, onChainRequired: true, chainJobRequired: true },
      });
    }

    const { data: job, error: jobError } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
    if (jobError) return res.status(500).json({ error: jobError.message });
    if (!job) return res.status(404).json({ error: "Job not found" });

    const task = job.mission_task_id
      ? (await supabase.from("mission_tasks").select("id,mission_id,agent_id").eq("id", job.mission_task_id).maybeSingle()).data
      : null;
    if (!task?.mission_id) return res.status(403).json({ error: "Job is not attached to a user mission" });

    const { data: mission, error: missionError } = await supabase.from("missions").select("id,user_id,client_wallet").eq("id", task.mission_id).maybeSingle();
    if (missionError) return res.status(500).json({ error: missionError.message });
    if (!mission || mission.user_id !== auth.user.id) return res.status(403).json({ error: "You do not own this mission" });

    const nextStatus = transition(job.status, action);
    if (!nextStatus) return res.status(409).json({ error: `Cannot ${action} a job in ${job.status} state` });
    if (action === "submit" && !deliverable) return res.status(400).json({ error: "deliverable is required for submit" });

    const now = new Date().toISOString();
    const jobPatch: Record<string, unknown> = { status: nextStatus, updated_at: now };
    if (action === "accept") jobPatch.accepted_at = now;
    if (action === "submit") {
      jobPatch.submitted_at = now;
      jobPatch.deliverable = deliverable;
    }
    if (action === "cancel") jobPatch.terminal_at = now;

    const { data: updatedJob, error: updateError } = await supabase.from("jobs").update(jobPatch).eq("id", id).select("*").single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    if (job.mission_task_id) {
      const taskStatus: Record<string, string> = { accepted: "accepted", in_progress: "in_progress", submitted: "submitted", cancelled: "cancelled" };
      const nextTaskStatus = taskStatus[nextStatus];
      if (nextTaskStatus) await supabase.from("mission_tasks").update({ status: nextTaskStatus, updated_at: now }).eq("id", job.mission_task_id);
    }

    const missionStatus = nextStatus === "in_progress" ? "in_progress" : nextStatus === "submitted" ? "awaiting_review" : nextStatus === "cancelled" ? "cancelled" : null;
    if (missionStatus) await supabase.from("missions").update({ status: missionStatus, updated_at: now }).eq("id", task.mission_id).eq("user_id", auth.user.id);

    if (action === "submit") {
      await supabase.from("evaluations").upsert({
        job_id: id,
        verdict: "pending",
        evidence: { deliverable, source: "marketplace_submission", recorded_at: now },
        notes: note || null,
        updated_at: now,
      }, { onConflict: "job_id" });
    }

    await supabase.from("user_activity").insert({
      user_id: auth.user.id,
      mission_id: task.mission_id,
      job_id: id,
      type: `job_${action}`,
      title: `Job ${action}`,
      description: note || `Job transitioned from ${job.status} to ${nextStatus}.`,
    });

    return res.status(200).json({
      job: updatedJob,
      state: nextStatus,
      protocol: {
        action,
        onChainRequired: ["accept", "start", "submit"].includes(action),
        note: "Marketplace workflow state is recorded separately from ERC-8183 chain state. Payment is never marked released here.",
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected server error" });
  }
}
