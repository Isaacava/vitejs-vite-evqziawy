import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  try {
    const supabase = serverClient();
    const { data: missions, error: missionError } = await supabase
      .from("missions")
      .select("id,title,goal,status,budget,created_at,updated_at")
      .eq("user_id", auth.user.id)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (missionError) throw new Error(missionError.message);

    const missionIds = (missions ?? []).map((mission) => mission.id);
    if (!missionIds.length) return res.status(200).json({ ok: true, network: "bsc-testnet", chain_id: 97, jobs: [] });

    const { data: tasks, error: taskError } = await supabase
      .from("mission_tasks")
      .select("id,mission_id,agent_id,title,role,status,budget,chain_job_id,created_at,updated_at")
      .in("mission_id", missionIds)
      .order("updated_at", { ascending: false });
    if (taskError) throw new Error(taskError.message);

    const taskIds = (tasks ?? []).map((task) => task.id);
    const { data: jobs, error: jobError } = taskIds.length
      ? await supabase
          .from("jobs")
          .select("id,mission_task_id,provider_agent_id,client_wallet,status,budget,chain_job_id,chain_status,deliverable,created_at,funded_at,submitted_at,terminal_at,updated_at")
          .in("mission_task_id", taskIds)
          .order("updated_at", { ascending: false })
      : { data: [], error: null };
    if (jobError) throw new Error(jobError.message);

    const missionById = new Map((missions ?? []).map((mission) => [mission.id, mission]));
    const taskById = new Map((tasks ?? []).map((task) => [task.id, task]));

    const result = (jobs ?? []).map((job) => {
      const task = taskById.get(job.mission_task_id);
      const mission = task ? missionById.get(task.mission_id) : undefined;
      return {
        id: job.id,
        mission_id: mission?.id ?? null,
        mission_title: mission?.title ?? "Untitled mission",
        mission_status: mission?.status ?? "unknown",
        task_title: task?.title ?? "Marketplace task",
        job_status: job.status,
        chain_job_id: job.chain_job_id,
        chain_status: job.chain_status,
        budget: job.budget,
        client_wallet: job.client_wallet,
        created_at: job.created_at,
        funded_at: job.funded_at,
        submitted_at: job.submitted_at,
        terminal_at: job.terminal_at,
        updated_at: job.updated_at,
        recoverable: Boolean(job.chain_job_id) && !["completed", "rejected", "cancelled", "expired"].includes(String(job.status).toLowerCase()),
      };
    });

    return res.status(200).json({ ok: true, network: "bsc-testnet", chain_id: 97, jobs: result });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load Testnet job history" });
  }
}
