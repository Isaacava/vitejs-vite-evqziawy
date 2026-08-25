import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const COMMERCE_ABI = [{
  type: "function",
  name: "getJob",
  stateMutability: "view",
  inputs: [{ name: "jobId", type: "uint256" }],
  outputs: [{
    name: "job",
    type: "tuple",
    components: [
      { name: "id", type: "uint256" },
      { name: "client", type: "address" },
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "description", type: "string" },
      { name: "budget", type: "uint256" },
      { name: "expiredAt", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "hook", type: "address" },
      { name: "submittedAt", type: "uint256" },
      { name: "deliverable", type: "bytes32" },
    ],
  }],
}] as const;

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

function address(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function positiveNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0;
  }
  return false;
}

function integerBetween(value: unknown, min: number, max: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isInteger(numeric) && numeric >= min && numeric <= max;
}

function walletProviderFromAgent(agent: Record<string, unknown>) {
  const metadata = agent.metadata && typeof agent.metadata === "object" ? agent.metadata as Record<string, unknown> : {};
  const execution = metadata.execution && typeof metadata.execution === "object" ? metadata.execution as Record<string, unknown> : {};
  const declared = typeof execution.wallet_provider === "string" ? execution.wallet_provider.toLowerCase() : "";
  const text = JSON.stringify(metadata).toLowerCase();
  if (declared === "altana" || text.includes("altana")) return "altana";
  if (declared === "twak" || text.includes("twak")) return "twak";
  if (declared === "evm" || text.includes("evmwalletprovider")) return "evm";
  return "unknown";
}

async function loadOwnedFundedJob(supabase: ReturnType<typeof serverClient>, jobId: string, userId: string, userWallet: string | null) {
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id,mission_task_id,client_wallet,chain_job_id,budget")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Job not found");
  if (!job.mission_task_id) throw new Error("Job is not attached to a mission task");
  if (!userWallet || String(job.client_wallet || "").toLowerCase() !== userWallet.toLowerCase()) throw new Error("The authenticated wallet does not own this job");

  const { data: task, error: taskError } = await supabase
    .from("mission_tasks")
    .select("id,mission_id,agent_id")
    .eq("id", job.mission_task_id)
    .maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task?.mission_id || !task.agent_id) throw new Error("Job does not identify a provider agent");

  const { data: mission, error: missionError } = await supabase
    .from("missions")
    .select("id,user_id,client_wallet")
    .eq("id", task.mission_id)
    .maybeSingle();
  if (missionError) throw new Error(missionError.message);
  if (!mission || mission.user_id !== userId) throw new Error("You do not own this mission");

  const { data: agent, error: agentError } = await supabase
    .from("marketplace_agents")
    .select("id,agent_id,owner,metadata")
    .eq("id", task.agent_id)
    .maybeSingle();
  if (agentError) throw new Error(agentError.message);
  if (!agent) throw new Error("Provider agent not found");

  if (!job.chain_job_id) throw new Error("The ERC-8183 chain job has not been created yet");
  const chainJob = await publicClient.readContract({
    address: COMMERCE,
    abi: COMMERCE_ABI,
    functionName: "getJob",
    args: [BigInt(job.chain_job_id)],
  });
  if (Number(chainJob.status) !== 1) throw new Error(`Execution capital can only be requested for a funded job; live status is ${Number(chainJob.status)}`);
  if (String(chainJob.client).toLowerCase() !== userWallet.toLowerCase()) throw new Error("The live ERC-8183 client is not the authenticated wallet");

  const providerSupport = walletProviderFromAgent(agent as Record<string, unknown>);
  if (providerSupport !== "altana") throw new Error("This provider has not explicitly declared Altana scoped-session execution support");

  return { job, task, mission, agent, chainJob };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });

    const supabase = serverClient();

    if (req.method === "GET") {
      const jobId = typeof req.query.job === "string" ? req.query.job.trim() : "";
      if (!jobId) return res.status(400).json({ error: "job is required" });
      const { data: request, error } = await supabase.from("execution_capital_requests").select("*").eq("job_id", jobId).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!request) return res.status(404).json({ error: "Execution capital request not found" });

      const { data: job } = await supabase.from("jobs").select("id,mission_task_id,client_wallet").eq("id", jobId).maybeSingle();
      if (!job || !auth.user.wallet_address || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "You do not own this execution capital request" });
      return res.status(200).json({ ok: true, request });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const jobId = typeof req.body?.job_id === "string" ? req.body.job_id.trim() : "";
    const capitalRequested = req.body?.capital_requested;
    const capitalToken = typeof req.body?.capital_token === "string" ? req.body.capital_token.trim() : "";
    const purpose = typeof req.body?.purpose === "string" ? req.body.purpose.trim() : "";
    const duration = req.body?.requested_duration_seconds;
    const walletProvider = typeof req.body?.wallet_provider === "string" ? req.body.wallet_provider.toLowerCase().trim() : "";
    const authorizationModel = typeof req.body?.authorization_model === "string" ? req.body.authorization_model.toLowerCase().trim() : "";

    if (!jobId || !positiveNumber(capitalRequested) || !address(capitalToken) || !purpose) return res.status(400).json({ error: "job_id, positive capital_requested, ERC-20 capital_token, and purpose are required" });
    if (!integerBetween(duration, 300, 7 * 24 * 60 * 60)) return res.status(400).json({ error: "requested_duration_seconds must be an integer between 300 and 604800" });
    if (walletProvider !== "altana" || authorizationModel !== "scoped_session") return res.status(400).json({ error: "Execution capital is currently available only through Altana scoped sessions" });

    const owned = await loadOwnedFundedJob(supabase, jobId, auth.user.id, auth.user.wallet_address);
    const { data: existing, error: existingError } = await supabase.from("execution_capital_requests").select("*").eq("job_id", jobId).maybeSingle();
    if (existingError) return res.status(500).json({ error: existingError.message });
    if (existing) return res.status(409).json({ error: "An execution capital request already exists for this job", request: existing });

    const numericCapital = String(capitalRequested);
    const { data: request, error: insertError } = await supabase.from("execution_capital_requests").insert({
      job_id: jobId,
      agent_id: owned.agent.id,
      requester_wallet: auth.user.wallet_address,
      capital_requested: numericCapital,
      capital_token: capitalToken,
      purpose,
      requested_duration_seconds: Number(duration),
      wallet_provider: "altana",
      authorization_model: "scoped_session",
      status: "requested",
      evidence: {
        source: "agentmarket_execution_capital_request",
        chain_id: 97,
        chain_job_id: Number(owned.job.chain_job_id),
        provider_agent_id: owned.agent.agent_id,
      },
    }).select("*").single();
    if (insertError) return res.status(500).json({ error: insertError.message });

    return res.status(201).json({ ok: true, request });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    const status = /not found|does not|only|cannot|not attached|not the authenticated|not created|live status|own this|declared/i.test(message) ? 409 : 500;
    return res.status(status).json({ error: message });
  }
}
