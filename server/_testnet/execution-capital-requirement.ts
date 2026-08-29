import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { detectAgentCapitalRequest } from "./execution-capital-detection.js";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

const ERC20_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function executionObject(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function metadataCapabilityUrls(agent: Record<string, unknown>) {
  const metadata = executionObject(agent.metadata);
  const execution = executionObject(metadata.execution);
  return [
    metadata.execution_capabilities_url,
    metadata.execution_capability_url,
    execution.execution_capabilities_url,
    execution.execution_capability_url,
    execution.capabilities_url,
    execution.capability_url,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Execution capability endpoint returned HTTP ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function loadCapability(
  agent: Record<string, unknown>,
  endpoints: Array<Record<string, unknown>>,
) {
  const candidates = [
    ...metadataCapabilityUrls(agent),
    ...(endpoints || []).map((endpoint) => `${String(endpoint.endpoint_url).replace(/\/+$/, "")}/execution-capabilities`),
  ];
  const unique = [...new Set(candidates.filter(Boolean))];
  if (unique.length === 0) throw new Error("Provider has no execution capability endpoint");

  const failures: string[] = [];
  for (const candidate of unique) {
    try {
      const value = await fetchJson(candidate);
      if (value.network === "bsc-testnet" && Number(value.chainId) === 97 && value.private_key_exposed === false) {
        return { capability: value, source: candidate };
      }
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : "capability fetch failed"}`);
    }
  }
  throw new Error(`Provider execution capability could not be verified. ${failures.join(" | ")}`);
}

async function loadStoredRequests(supabase: ReturnType<typeof serverClient>, jobId: string) {
  const { data, error } = await supabase
    .from("execution_capital_requests")
    .select("*")
    .eq("job_id", jobId)
    .limit(10);
  if (error) throw new Error(error.message);
  return (data || []) as Array<Record<string, unknown>>;
}

async function resolveRequirement(jobId: string, userId: string, wallet: string | null) {
  const supabase = serverClient();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id,mission_task_id,client_wallet,chain_job_id,budget")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Job not found");
  if (!wallet || String(job.client_wallet || "").toLowerCase() !== wallet.toLowerCase()) throw new Error("The authenticated wallet does not own this job");
  if (!job.mission_task_id) throw new Error("Job is not attached to a mission task");

  const { data: task, error: taskError } = await supabase
    .from("mission_tasks")
    .select("id,mission_id,agent_id")
    .eq("id", job.mission_task_id)
    .maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task?.agent_id || !task.mission_id) throw new Error("Job does not identify a provider agent or mission");

  const { data: mission, error: missionError } = await supabase
    .from("missions")
    .select("id,user_id")
    .eq("id", task.mission_id)
    .maybeSingle();
  if (missionError) throw new Error(missionError.message);
  if (!mission || mission.user_id !== userId) throw new Error("You do not own this mission");

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id,agent_id,metadata")
    .eq("id", task.agent_id)
    .maybeSingle();
  if (agentError) throw new Error(agentError.message);
  if (!agent) throw new Error("Provider agent not found");

  const { data: endpoints, error: endpointError } = await supabase
    .from("agent_endpoints")
    .select("id,endpoint_url,status,metadata")
    .eq("agent_id", agent.id)
    .limit(20);
  if (endpointError) throw new Error(endpointError.message);

  const { capability, source } = await loadCapability(agent as Record<string, unknown>, (endpoints || []) as Array<Record<string, unknown>>);
  const storedRequests = await loadStoredRequests(supabase, jobId);

  const detected = await detectAgentCapitalRequest({
    agent: agent as Record<string, unknown>,
    endpoints: (endpoints || []) as Array<Record<string, unknown>>,
    capability,
    jobId,
    storedRequests,
    readToken: async (token) => {
      const [decimals, symbol] = await Promise.all([
        publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
        publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }).catch(() => "TOKEN"),
      ]);
      return { decimals: Number(decimals), symbol: String(symbol) };
    },
  });

  if (detected.chain_id !== null && detected.chain_id !== 97) throw new Error("Agent capital request is not for BSC Testnet");
  if (detected.network && detected.network !== "bsc-testnet") throw new Error("Agent capital request is not for BSC Testnet");
  if (detected.amount_raw === "0") throw new Error("Agent capital request amount is zero");
  if (BigInt(detected.amount_raw) > 1_000_000_000_000_000_000n) throw new Error("Testnet execution capital request exceeds the marketplace safety cap of 1 whole token");

  const market = executionObject(capability.execution_market);
  if (isAddress(market.token_in) && detected.token.toLowerCase() !== String(market.token_in).toLowerCase()) {
    throw new Error("Agent capital request token does not match its declared execution-capability token");
  }

  return {
    network: "bsc-testnet",
    chain_id: 97,
    provider_agent_id: agent.agent_id,
    capability_source_url: source,
    request_source: detected.source,
    request_url: detected.request_url,
    execution: capability.execution,
    wallet_provider: capability.wallet_provider,
    authorization_model: capability.authorization_model,
    execution_market: {
      token_in: detected.token,
      token_out: detected.token_out,
      token_in_symbol: detected.symbol,
      token_out_symbol: detected.token_out_symbol,
      fee: detected.fee,
      protocol: detected.protocol,
      target: detected.target,
      selector: detected.selector,
      recipient: detected.recipient,
      preflight_path: detected.preflight_path,
    },
    execution_capital: {
      token: detected.token,
      symbol: detected.symbol,
      decimals: detected.decimals,
      required_amount: detected.amount,
      required_amount_raw: detected.amount_raw,
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    const jobId = typeof req.query?.job === "string" ? req.query.job.trim() : "";
    if (!jobId) return res.status(400).json({ error: "job is required" });
    return res.status(200).json({ ok: true, ...(await resolveRequirement(jobId, auth.user.id, auth.user.wallet_address)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve execution capital requirement";
    return res.status(409).json({ error: message });
  }
}
