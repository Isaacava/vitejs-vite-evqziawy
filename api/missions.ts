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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type CapabilityInput = {
  name?: unknown;
  required?: unknown;
  type?: unknown;
};

function matchesType(value: unknown, type: string) {
  const normalized = type.toLowerCase();
  if (normalized === "number" || normalized === "integer" || normalized === "uint" || normalized === "uint256") {
    return (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()));
  }
  if (normalized === "boolean" || normalized === "bool") return typeof value === "boolean";
  if (normalized === "string" || normalized === "text") return typeof value === "string";
  if (normalized === "array" || normalized.endsWith("[]")) return Array.isArray(value);
  if (normalized === "object" || normalized === "json") return Boolean(value && typeof value === "object" && !Array.isArray(value));
  return true;
}

function capabilityInputs(metadata: unknown): CapabilityInput[] {
  const object = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  const schema = object.capability_schema && typeof object.capability_schema === "object" ? object.capability_schema as Record<string, unknown> : null;
  return Array.isArray(schema?.inputs) ? schema.inputs.filter((item): item is CapabilityInput => Boolean(item && typeof item === "object")) : [];
}

function validateParameters(metadata: unknown, parameters: unknown) {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) throw new Error("Structured agent inputs are required before creating a mission");
  const input = parameters as Record<string, unknown>;
  for (const field of capabilityInputs(metadata)) {
    const name = typeof field.name === "string" ? field.name.trim() : "";
    if (!name) continue;
    const required = field.required !== false;
    const value = input[name];
    if (required && (value === undefined || value === null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0))) {
      throw new Error(`Missing required capability input: ${name}`);
    }
    if (value === undefined || value === null) continue;
    if (typeof field.type === "string" && !matchesType(value, field.type)) throw new Error(`Capability input ${name} must be of type ${field.type}`);
  }
  if (typeof input.current_tick !== "undefined" && !Number.isFinite(Number(input.current_tick))) throw new Error("current_tick must be numeric");
  if (typeof input.tick_lower !== "undefined" && !Number.isFinite(Number(input.tick_lower))) throw new Error("tick_lower must be numeric");
  if (typeof input.tick_upper !== "undefined" && !Number.isFinite(Number(input.tick_upper))) throw new Error("tick_upper must be numeric");
  if (input.tick_lower !== undefined && input.tick_upper !== undefined && Number(input.tick_upper) <= Number(input.tick_lower)) throw new Error("Upper tick must be greater than lower tick");
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
    const parameters = req.body?.parameters;

    if (!goal) return res.status(400).json({ error: "goal is required" });
    if (!requestedAgentId) return res.status(400).json({ error: "agent_id is required" });

    const intent = parseMarketplaceIntent(goal);
    const supabase = serverClient();
    const now = new Date().toISOString();

    let agentQuery = supabase
      .from("agents")
      .select("id,agent_id,name,owner,chain,status,verification_status,metadata");

    agentQuery = isUuid(requestedAgentId)
      ? agentQuery.eq("id", requestedAgentId)
      : agentQuery.eq("agent_id", requestedAgentId);

    const { data: agent, error: agentError } = await agentQuery.maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ error: "Selected agent was not found" });
    if (agent.chain !== "bsc-testnet") return res.status(409).json({ error: "Only BSC Testnet agents can be used from this marketplace" });
    if (agent.verification_status === "revoked") return res.status(409).json({ error: "This agent is revoked and cannot receive a mission" });

    validateParameters(agent.metadata, parameters);
    const structuredParameters = parameters as Record<string, unknown>;
    const structuredDescription = JSON.stringify({ goal, inputs: structuredParameters });

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
        description: structuredDescription,
        parameters: structuredParameters,
        budget,
        status: "planned",
        created_at: now,
        updated_at: now,
      })
      .select("id,mission_id,agent_id,title,role,description,parameters,budget,status,chain_job_id,created_at,updated_at")
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
        description: structuredDescription,
        parameters: structuredParameters,
        budget,
        created_at: now,
        updated_at: now,
      })
      .select("id,mission_task_id,provider_agent_id,client_wallet,status,description,parameters,budget,chain_job_id,created_at,updated_at")
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
      description: "Testnet mission created with structured agent inputs and waiting for provider quote negotiation.",
      metadata: {
        environment: "testnet",
        chain_id: 97,
        agent_id: agent.agent_id,
        category: intent.category,
        parameters: structuredParameters,
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
    const message = error instanceof Error ? error.message : "Mission creation failed";
    const status = message.startsWith("Missing required capability input:") || message.startsWith("Capability input") || message.startsWith("Structured agent inputs") || message.includes("must be numeric") || message === "Upper tick must be greater than lower tick" ? 400 : 500;
    return res.status(status).json({ error: message });
  }
}
