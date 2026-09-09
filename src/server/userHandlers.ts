import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseMarketplaceIntent } from "../lib/intent.js";
import { getAuthenticatedUser, serverClient } from "./authHandlers.js";

const TERMINAL = ["completed", "rejected", "cancelled", "expired", "terminal"];
const ACTIVE = ["planning", "open", "funded", "accepted", "in_progress", "awaiting_review"];
const REVIEW = ["submitted", "awaiting_review"];
const ESCROW = ["pending", "funded", "escrowed", "locked"];

export async function dashboard(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });
  try {
    const supabase = serverClient();
    const userId = auth.user.id;
    const [missionsResult, activityResult, paymentsResult, notificationsResult] = await Promise.all([
      supabase.from("missions").select("id,title,goal,category,budget,status,created_at,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(20),
      supabase.from("user_activity").select("id,mission_id,job_id,type,title,description,metadata,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
      supabase.from("payments").select("id,mission_id,job_id,amount,token_symbol,status,tx_hash,created_at,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(20),
      supabase.from("notifications").select("id,mission_id,task_id,kind,title,body,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
    ]);
    if (missionsResult.error) throw new Error(missionsResult.error.message);
    if (activityResult.error) throw new Error(activityResult.error.message);
    if (paymentsResult.error) throw new Error(paymentsResult.error.message);
    if (notificationsResult.error) throw new Error(notificationsResult.error.message);

    const missions = missionsResult.data || [];
    const missionIds = missions.map((m: any) => m.id);
    let taskRows: any[] = [];
    if (missionIds.length) {
      const { data, error } = await supabase.from("mission_tasks").select("id,mission_id,agent_id,title,role,status,budget").in("mission_id", missionIds);
      if (error) throw new Error(error.message);
      taskRows = data || [];
    }
    const taskIds = taskRows.map((t: any) => t.id);
    let jobRows: any[] = [];
    if (taskIds.length) {
      const { data, error } = await supabase.from("jobs").select("id,mission_task_id,provider_agent_id,status,budget,chain_job_id,chain_status,chain_last_synced_at,chain_tx_hash,chain_error,client_wallet,updated_at").in("mission_task_id", taskIds).order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      jobRows = data || [];
    }
    const agentIds = Array.from(new Set(taskRows.map((t: any) => t.agent_id).filter(Boolean)));
    const agents = agentIds.length ? ((await supabase.from("agents").select("id,agent_id,name,category,status,verification_status").in("id", agentIds)).data || []) : [];
    const agentById = new Map(agents.map((a: any) => [a.id, a]));
    const taskById = new Map(taskRows.map((t: any) => [t.id, t]));
    const jobsByMission = new Map<string, any[]>();
    for (const job of jobRows) {
      const task = taskById.get(job.mission_task_id);
      if (!task) continue;
      const list = jobsByMission.get(task.mission_id) || [];
      list.push({ ...job, task_id: task.id, agent: task.agent_id ? agentById.get(task.agent_id) : null });
      jobsByMission.set(task.mission_id, list);
    }
    const missionViews = missions.map((mission: any) => ({ ...mission, jobs: jobsByMission.get(mission.id) || [] }));
    const active = missionViews.filter((m: any) => !TERMINAL.includes(String(m.status)) && (ACTIVE.includes(String(m.status)) || m.jobs.some((j: any) => ACTIVE.includes(String(j.status))))).length;
    const completed = missionViews.filter((m: any) => TERMINAL.includes(String(m.status)) || m.jobs.some((j: any) => TERMINAL.includes(String(j.status)) || String(j.chain_status) === "completed")).length;
    const awaitingReview = missionViews.filter((m: any) => REVIEW.includes(String(m.status)) || m.jobs.some((j: any) => REVIEW.includes(String(j.status)) || REVIEW.includes(String(j.chain_status)))).length;
    const recordedEscrow = (paymentsResult.data || []).filter((p: any) => ESCROW.includes(String(p.status).toLowerCase())).reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
    const fundedJobs = jobRows.filter((j: any) => ["funded", "accepted", "in_progress", "submitted"].includes(String(j.status)) || ["funded", "accepted", "in_progress", "submitted"].includes(String(j.chain_status))).reduce((sum: number, j: any) => sum + Number(j.budget || 0), 0);
    const escrow = recordedEscrow > 0 ? recordedEscrow : fundedJobs;

    return res.status(200).json({ user: auth.user, stats: { active, completed, awaitingReview, escrow }, missions: missionViews, activity: activityResult.data || [], payments: paymentsResult.data || [], notifications: notificationsResult.data || [] });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load dashboard" });
  }
}

export async function createMission(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Connect and sign in with a wallet before hiring an agent" });
  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  const agentId = typeof req.body?.agent_id === "string" ? req.body.agent_id.trim() : "";
  const suppliedWallet = typeof req.body?.client_wallet === "string" ? req.body.client_wallet.trim() : "";
  const budget = Number(req.body?.budget ?? 0);
  if (!goal || !agentId) return res.status(400).json({ error: goal ? "agent_id is required" : "goal is required" });
  if (!Number.isFinite(budget) || budget < 0) return res.status(400).json({ error: "budget must be a non-negative number" });
  if (suppliedWallet && suppliedWallet.toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "Mission wallet must match the authenticated wallet" });
  const supabase = serverClient();
  const intent = parseMarketplaceIntent(goal);
  const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,name,description,category,status,source,verification_status,is_first_party,metadata").eq("agent_id", agentId).maybeSingle();
  if (agentError) return res.status(500).json({ error: agentError.message });
  if (!agent) return res.status(404).json({ error: "Agent is not available for missions" });
  if (agent.status === "offline" || agent.verification_status === "revoked") return res.status(409).json({ error: "Selected agent is not currently available for missions" });
  const clientWallet = auth.user.wallet_address;
  const role = typeof agent.metadata?.role === "string" ? agent.metadata.role : agent.category || "DeFi specialist";
  const { data: mission, error: missionError } = await supabase.from("missions").insert({ user_id: auth.user.id, client_wallet: clientWallet, title: `${agent.name || "Agent"} mission`, goal, category: intent.category, budget, status: "planning" }).select("id,title,goal,category,budget,status,created_at").single();
  if (missionError) return res.status(500).json({ error: missionError.message });
  const { data: task, error: taskError } = await supabase.from("mission_tasks").insert({ mission_id: mission.id, agent_id: agent.id, title: agent.name || "DeFi agent task", role, description: goal, budget, status: "assigned" }).select("id,mission_id,agent_id,title,role,status").single();
  if (taskError) { await supabase.from("missions").delete().eq("id", mission.id); return res.status(500).json({ error: taskError.message }); }
  const { data: job, error: jobError } = await supabase.from("jobs").insert({ mission_task_id: task.id, provider_agent_id: agent.id, client_wallet: clientWallet, status: "open", chain_status: "not_created", description: goal, budget }).select("id,status,chain_status,budget,created_at").single();
  if (jobError) { await supabase.from("mission_tasks").delete().eq("id", task.id); await supabase.from("missions").delete().eq("id", mission.id); return res.status(500).json({ error: jobError.message }); }
  await supabase.from("notifications").insert({ mission_id: mission.id, task_id: task.id, user_id: auth.user.id, recipient: agentId, kind: "new_job", title: "New mission available", body: goal });
  await supabase.from("user_activity").insert({ user_id: auth.user.id, mission_id: mission.id, job_id: job.id, type: "mission_created", title: `Hired ${agent.name || "an agent"}`, description: goal, metadata: { agent_id: agent.agent_id, category: intent.category, budget } });
  return res.status(201).json({ mission, task, job, agent: { id: agent.id, agent_id: agent.agent_id, name: agent.name, category: agent.category, status: agent.status, verification_status: agent.verification_status, source: agent.source }, intent, protocol: { chainJobCreated: false, chainStatus: "not_created", nextStep: "create_and_fund_erc8183_job" } });
}
