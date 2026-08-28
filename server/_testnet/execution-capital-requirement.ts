import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
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
  const metadata = agent.metadata && typeof agent.metadata === "object" ? agent.metadata as Record<string, unknown> : {};
  const execution = metadata.execution && typeof metadata.execution === "object" ? executionObject(metadata.execution) : {};
  return [
    metadata.execution_capabilities_url,
    metadata.execution_capability_url,
    execution.execution_capabilities_url,
    execution.execution_capability_url,
    execution.capabilities_url,
    execution.capability_url,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim());
}

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Execution capability endpoint returned HTTP ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function resolveRequirement(jobId: string, userId: string, wallet: string | null) {
  const supabase = serverClient();
  const { data: job, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,client_wallet,chain_job_id,budget").eq("id", jobId).maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Job not found");
  if (!wallet || String(job.client_wallet || "").toLowerCase() !== wallet.toLowerCase()) throw new Error("The authenticated wallet does not own this job");
  if (!job.mission_task_id) throw new Error("Job is not attached to a mission task");

  const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,agent_id").eq("id", job.mission_task_id).maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task?.agent_id) throw new Error("Job does not identify a provider agent");

  const { data: mission, error: missionError } = await supabase.from("missions").select("id,user_id").eq("id", task.mission_id || "").maybeSingle();
  if (missionError) throw new Error(missionError.message);
  if (!mission || mission.user_id !== userId) throw new Error("You do not own this mission");

  const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,metadata").eq("id", task.agent_id).maybeSingle();
  if (agentError) throw new Error(agentError.message);
  if (!agent) throw new Error("Provider agent not found");

  const { data: endpoints, error: endpointError } = await supabase.from("agent_endpoints").select("id,endpoint_url,status").eq("agent_id", agent.id).limit(20);
  if (endpointError) throw new Error(endpointError.message);

  const candidates = [
    ...metadataCapabilityUrls(agent as Record<string, unknown>),
    ...(endpoints || []).map((endpoint) => `${String(endpoint.endpoint_url).replace(/\/+$/, "")}/execution-capabilities`),
  ];
  const unique = [...new Set(candidates)];
  if (unique.length === 0) throw new Error("Provider has no execution capability endpoint");

  let capability: Record<string, unknown> | null = null;
  let source = "";
  for (const candidate of unique) {
    try {
      const value = await fetchJson(candidate);
      if (value.network === "bsc-testnet" && Number(value.chainId) === 97 && value.execution === "altana-scoped-session" && value.wallet_provider === "altana" && value.authorization_model === "scoped_session") {
        capability = value;
        source = candidate;
        break;
      }
    } catch {
      // Try the next declared provider endpoint.
    }
  }
  if (!capability) throw new Error("Provider execution capability could not be verified");

  const market = executionObject(capability.execution_market);
  const token = market.token_in;
  if (!isAddress(token)) throw new Error("Provider execution capability did not declare a valid execution token");

  const [decimals, chainSymbol] = await Promise.all([
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }).catch(() => "TOKEN"),
  ]);

  const symbol = typeof market.token_in_symbol === "string" && market.token_in_symbol.trim() ? market.token_in_symbol.trim() : String(chainSymbol);
  const requestedAmount = "1";

  return {
    network: "bsc-testnet",
    chain_id: 97,
    provider_agent_id: agent.agent_id,
    source_url: source,
    execution: "altana-scoped-session",
    execution_market: {
      token_in: token,
      token_out: isAddress(market.token_out) ? market.token_out : null,
      token_in_symbol: symbol,
      token_out_symbol: typeof market.token_out_symbol === "string" ? market.token_out_symbol : null,
      fee: Number.isInteger(Number(market.fee)) ? Number(market.fee) : null,
    },
    execution_capital: {
      token: token,
      symbol,
      decimals: Number(decimals),
      required_amount: requestedAmount,
      required_amount_raw: (BigInt(requestedAmount) * 10n ** BigInt(Number(decimals))).toString(),
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    const jobId = typeof req.query?.job === "string" ? req.query.job.trim() : "";
    if (!jobId) return res.status(400).json({ error: "job is required" });
    const result = await resolveRequirement(jobId, auth.user.id, auth.user.wallet_address);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve execution capital requirement";
    return res.status(409).json({ error: message });
  }
}
