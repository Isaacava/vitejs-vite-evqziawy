import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "./_auth.js";
import { parseMarketplaceIntent } from "../src/lib/intent.js";

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function nonNegativeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parameters(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 50));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });

    const goal = text(req.body?.goal, 4000);
    const requestedAgentId = text(req.body?.agent_id, 128);
    const budget = nonNegativeNumber(req.body?.budget);
    const taskParameters = parameters(req.body?.parameters);

    if (!goal) return res.status(400).json({ error: "goal is required" });
    if (!requestedAgentId) return res.status(400).json({ error: "agent_id is required" });

    const intent = parseMarketplaceIntent(goal);
    const supabase = serverClient();
    const now = new Date().toISOString();

    let agentQuery = supabase
      .from("agents")
      .select("id,agent_id,name,owner,chain,status,verification_status");

    agentQuery = isUuid(requestedAgentId)
      ? agentQuery.eq("id", requestedAgentId)
      : agentQuery.eq("agent_id", requestedAgentId);

    const { data: agent, error: agentError } = await agentQuery.maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ error: "Selected agent was not found" });
    if (agent.chain !== "bsc-testnet") return res.status(409).json({ error: "Only BSC Testnet agents can be used from this marketplace" });
    if (agent.verification_status === "revoked") return res.status(409).json({ error: "This agent is revoked and cannot receive a mission" });

    const title = goal.length > 80 ? `${goal.slice(0, 77)}…` : goal;
    const { data: mission, error: missionError } = await supabase
      .from("missions")
      .insert({
        client_wallet: auth.user.wallet_address,
        title,
        goal,
        category: intent.category,
        budget,
        status: "planning",
        user_id: auth.user.id,
        created_at: now,
        updated_at: now,
      })
      .select("id,client_wallet,title,goal,category,budget,status,created_at,updated_at")
      .single();
    if (missionError) throw new Error(missionError.message);

    const { data: task, error: taskError } = await supabase
      .from("mission_tasks")
      .insert({
        mission_id: mission.id,
        agent_id: agent.id,
        title,
        role: "provider",
        description: goal,
        budget,
        status: "planned",
        parameters: taskParameters,
        created_at: now,
        updated_at: now,
      })
      .select("id,mission_id,agent_id,title,role,description,budget,status,chain_job_id,parameters,created_at,updated_at")
      .single();
    if (taskError) {
      await supabase.from("missions").delete().eq("id", mission.id).eq("user_id", auth.user.id);
      throw new Error(taskError.message);
    }

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        mission_task_id: task.id,
        provider_agent_id: agent.id,
        client_wallet: auth.user.wallet_address,
        status: "open",
        description: goal,
        budget,
        parameters: taskParameters,
        created_at: now,
        updated_at: now,
      })
      .select("id,mission_task_id,provider_agent_id,client_wallet,status,description,budget,chain_job_id,parameters,created_at,updated_at")
      .single();
    if (jobError) {
      await supabase.from("mission_tasks").delete().eq("id", task.id).eq("mission_id", mission.id);
      await supabase.from("missions").delete().eq("id", mission.id).eq("user_id", auth.user.id);
      throw new Error(jobError.message);
    }

    await supabase.from("user_activity").insert({
      user_id: auth.user.id,
      mission_id: mission.id,
      job_id: job.id,
      type: "mission_created",
      title: "Mission created",
      description: "Testnet mission created and waiting for provider quote negotiation.",
      metadata: {
        environment: "testnet",
        chain_id: 97,
        agent_id: agent.agent_id,
        category: intent.category,
        parameters: taskParameters,
      },
    });

    return res.status(201).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: 97,
      mission,
      task,
      job,
      agent: {
        id: agent.id,
        agent_id: agent.agent_id,
        name: agent.name,
        owner: agent.owner,
        status: agent.status,
        verification_status: agent.verification_status,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Mission creation failed" });
  }
}
