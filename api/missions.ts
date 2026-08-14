import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { parseMarketplaceIntent } from "../src/lib/intent.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  const agentId = typeof req.body?.agent_id === "string" ? req.body.agent_id.trim() : "";
  const clientWallet = typeof req.body?.client_wallet === "string" ? req.body.client_wallet.trim() : null;
  const budget = Number(req.body?.budget ?? 0);

  if (!goal) return res.status(400).json({ error: "goal is required" });
  if (!agentId) return res.status(400).json({ error: "agent_id is required" });
  if (!Number.isFinite(budget) || budget < 0) {
    return res.status(400).json({ error: "budget must be a non-negative number" });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: "Supabase server configuration is missing" });

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const intent = parseMarketplaceIntent(goal);

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id,agent_id,name,description,category,status,source,verification_status,is_first_party,metadata")
    .eq("agent_id", agentId)
    .maybeSingle();

  if (agentError) return res.status(500).json({ error: agentError.message });
  if (!agent) return res.status(404).json({ error: "Agent is not available for missions" });
  if (agent.status === "offline" || agent.verification_status === "revoked") {
    return res.status(409).json({ error: "Selected agent is not currently available for missions" });
  }

  const role = typeof agent.metadata?.role === "string"
    ? agent.metadata.role
    : agent.category || "DeFi specialist";

  const { data: mission, error: missionError } = await supabase
    .from("missions")
    .insert({
      client_wallet: clientWallet,
      title: `${agent.name || "Agent"} mission`,
      goal,
      category: intent.category,
      budget,
      status: "planning",
    })
    .select("id,title,goal,category,budget,status,created_at")
    .single();

  if (missionError) return res.status(500).json({ error: missionError.message });

  const { data: task, error: taskError } = await supabase
    .from("mission_tasks")
    .insert({
      mission_id: mission.id,
      agent_id: agent.id,
      title: agent.name || "DeFi agent task",
      role,
      description: goal,
      budget,
      status: "assigned",
    })
    .select("id,mission_id,agent_id,title,role,status")
    .single();

  if (taskError) {
    await supabase.from("missions").delete().eq("id", mission.id);
    return res.status(500).json({ error: taskError.message });
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      mission_task_id: task.id,
      provider_agent_id: agent.id,
      client_wallet: clientWallet,
      status: "open",
      chain_status: "not_created",
      description: goal,
      budget,
    })
    .select("id,status,chain_status,budget,created_at")
    .single();

  if (jobError) {
    await supabase.from("mission_tasks").delete().eq("id", task.id);
    await supabase.from("missions").delete().eq("id", mission.id);
    return res.status(500).json({ error: jobError.message });
  }

  await supabase.from("notifications").insert({
    mission_id: mission.id,
    task_id: task.id,
    recipient: agentId,
    kind: "new_job",
    title: "New mission available",
    body: goal,
  });

  return res.status(201).json({
    mission,
    task,
    job,
    agent: {
      id: agent.id,
      agent_id: agent.agent_id,
      name: agent.name,
      category: agent.category,
      status: agent.status,
      verification_status: agent.verification_status,
      source: agent.source,
    },
    intent,
    protocol: {
      chainJobCreated: false,
      chainStatus: "not_created",
      nextStep: "create_and_fund_erc8183_job",
    },
  });
}
