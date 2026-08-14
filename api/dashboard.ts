import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "./_auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  try {
    const supabase = serverClient();
    const userId = auth.user.id;

    const [missionsResult, activityResult, paymentsResult, notificationsResult] = await Promise.all([
      supabase
        .from("missions")
        .select("id,title,goal,category,budget,status,created_at,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(20),
      supabase
        .from("user_activity")
        .select("id,mission_id,job_id,type,title,description,metadata,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("payments")
        .select("id,mission_id,job_id,amount,token_symbol,status,tx_hash,created_at,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(20),
      supabase
        .from("notifications")
        .select("id,mission_id,task_id,kind,title,body,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (missionsResult.error) throw new Error(missionsResult.error.message);
    if (activityResult.error) throw new Error(activityResult.error.message);
    if (paymentsResult.error) throw new Error(paymentsResult.error.message);
    if (notificationsResult.error) throw new Error(notificationsResult.error.message);

    const missions = missionsResult.data || [];
    const missionIds = missions.map((mission) => mission.id);

    let taskRows: Array<{ id: string; mission_id: string; agent_id: string | null; title: string; role: string; status: string; budget: number }> = [];
    if (missionIds.length) {
      const { data, error } = await supabase
        .from("mission_tasks")
        .select("id,mission_id,agent_id,title,role,status,budget")
        .in("mission_id", missionIds);
      if (error) throw new Error(error.message);
      taskRows = data || [];
    }

    const taskIds = taskRows.map((task) => task.id);
    let jobRows: Array<{ id: string; mission_task_id: string; provider_agent_id: string | null; status: string; budget: number; chain_job_id: number | null; client_wallet: string | null; updated_at: string }> = [];
    if (taskIds.length) {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,mission_task_id,provider_agent_id,status,budget,chain_job_id,client_wallet,updated_at")
        .in("mission_task_id", taskIds)
        .order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      jobRows = data || [];
    }

    const agentIds = Array.from(new Set(taskRows.map((task) => task.agent_id).filter(Boolean)));
    const agents = agentIds.length
      ? (await supabase.from("agents").select("id,agent_id,name,category,status,verification_status").in("id", agentIds)).data || []
      : [];
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));

    const taskById = new Map(taskRows.map((task) => [task.id, task]));
    const jobsByMission = new Map<string, Array<Record<string, unknown>>>();
    for (const job of jobRows) {
      const task = taskById.get(job.mission_task_id);
      if (!task) continue;
      const agent = task.agent_id ? agentById.get(task.agent_id) : null;
      const list = jobsByMission.get(task.mission_id) || [];
      list.push({ ...job, task_id: task.id, agent });
      jobsByMission.set(task.mission_id, list);
    }

    const missionViews = missions.map((mission) => ({
      ...mission,
      jobs: jobsByMission.get(mission.id) || [],
    }));

    const active = missionViews.filter((mission) => ["planning", "in_progress", "awaiting_review"].includes(mission.status)).length;
    const completed = missionViews.filter((mission) => mission.status === "completed").length;
    const awaitingReview = missionViews.filter((mission) => mission.status === "awaiting_review").length;
    const escrow = (paymentsResult.data || [])
      .filter((payment) => ["pending", "funded", "escrowed"].includes(String(payment.status)))
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    return res.status(200).json({
      user: auth.user,
      stats: { active, completed, awaitingReview, escrow },
      missions: missionViews,
      activity: activityResult.data || [],
      payments: paymentsResult.data || [],
      notifications: notificationsResult.data || [],
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load dashboard" });
  }
}
