import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
import { discoverUniversalExecutionProfile } from "./execution-capability-discovery.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const KEYSTORE_ABI = [{ type: "function", name: "isValidKey", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }, { name: "keyId", type: "bytes32" }], outputs: [{ name: "valid", type: "bool" }] }] as const;
const COMMERCE_ABI = [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" }] }] }] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });

function address(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function stringValue(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function object(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }

async function loadOwnedFundedJob(supabase: ReturnType<typeof serverClient>, jobId: string, userId: string, wallet: string | null) {
  const { data: job, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,client_wallet,chain_job_id,budget").eq("id", jobId).maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Job not found");
  if (!job.mission_task_id) throw new Error("Job is not attached to a mission task");
  if (!wallet || String(job.client_wallet || "").toLowerCase() !== wallet.toLowerCase()) throw new Error("The authenticated wallet does not own this job");

  const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,mission_id,agent_id").eq("id", job.mission_task_id).maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task?.mission_id || !task.agent_id) throw new Error("Job does not identify a provider agent");

  const { data: mission, error: missionError } = await supabase.from("missions").select("id,user_id").eq("id", task.mission_id).maybeSingle();
  if (missionError) throw new Error(missionError.message);
  if (!mission || mission.user_id !== userId) throw new Error("You do not own this mission");

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id,agent_id,owner,uri,name,chain,status,verification_status,metadata")
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
  if (Number(chainJob.status) !== 1) throw new Error(`Execution authorization requires a funded job; live status is ${Number(chainJob.status)}`);
  if (String(chainJob.client).toLowerCase() !== wallet.toLowerCase()) throw new Error("The live ERC-8183 client is not the authenticated wallet");

  return { job, task, mission, agent, chainJob };
}

async function loadRegisteredEndpoints(supabase: ReturnType<typeof serverClient>, agentId: string) {
  const { data, error } = await supabase
    .from("agent_endpoints")
    .select("endpoint_url,protocol,status,metadata")
    .eq("agent_id", agentId)
    .limit(25);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function verifyOptionalSessionAuthorization(request: Record<string, unknown> | null, profile: Awaited<ReturnType<typeof discoverUniversalExecutionProfile>>) {
  const result = {
    verified: false,
    source: profile.authorization_model || profile.wallet_provider ? "provider_declaration" : "not_observed",
    session_key_id: null as Hex | null,
    session_key_address: profile.session_key_address,
    execution_wallet: null as Address | null,
    expiry: null as number | null,
  };

  if (!request || profile.wallet_provider !== "altana" || profile.authorization_model !== "scoped_session") return result;

  const key = stringValue(request.session_key_id ?? request.sessionKeyId);
  const executionWallet = address(request.user_execution_wallet) ? request.user_execution_wallet as Address : null;
  const expiry = Number(request.session_expiry ?? request.sessionExpiry);
  if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key) || !executionWallet || !Number.isSafeInteger(expiry)) return result;

  const keyStore = process.env.ALTANA_KEYSTORE_ADDRESS as Address | undefined;
  if (!address(keyStore)) return { ...result, session_key_id: key as Hex, execution_wallet: executionWallet, expiry };

  const verified = await publicClient.readContract({
    address: keyStore,
    abi: KEYSTORE_ABI,
    functionName: "isValidKey",
    args: [executionWallet, key as Hex],
  }).catch(() => false);

  return {
    ...result,
    verified: Boolean(verified && expiry > Math.floor(Date.now() / 1000)),
    session_key_id: key as Hex,
    execution_wallet: executionWallet,
    expiry,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });

    const jobId = typeof req.query?.job === "string" ? req.query.job.trim() : "";
    if (!jobId) return res.status(400).json({ error: "job is required" });

    const supabase = serverClient();
    const { job, task, agent, chainJob } = await loadOwnedFundedJob(supabase, jobId, auth.user.id, auth.user.wallet_address);
    const endpoints = await loadRegisteredEndpoints(supabase, String(agent.id));
    const profile = await discoverUniversalExecutionProfile(agent as Record<string, unknown>, endpoints);

    const { data: authorizationRows, error: authorizationError } = await supabase
      .from("execution_capital_requests")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1);
    const authorizationRequest = authorizationError ? null : (authorizationRows?.[0] || null) as Record<string, unknown> | null;
    const authorization = await verifyOptionalSessionAuthorization(authorizationRequest, profile);

    const metadata = object(agent.metadata);
    const taskMetadata = object(task);
    const explicitlyRequired = [
      taskMetadata.requires_execution_capital,
      taskMetadata.requiresExecutionCapital,
      taskMetadata.capital_required,
      taskMetadata.capitalRequired,
      metadata.requires_execution_capital,
      object(metadata.execution).requires_client_capital,
    ].find((value) => typeof value === "boolean");
    const required = explicitlyRequired === true || profile.requires_client_capital === true;

    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: 97,
      provider_agent_id: agent.agent_id,
      provider_name: agent.name,
      erc8183: { job_id: job.chain_job_id, status: Number(chainJob.status), client: chainJob.client, provider: chainJob.provider },
      execution: {
        detected: profile.detected,
        required,
        capital_required: profile.requires_client_capital,
        capital_requirement_confidence: profile.capital_requirement_confidence,
        protocol: profile.protocol,
        authorization_model: profile.authorization_model,
        wallet_provider: profile.wallet_provider,
        capability_url: profile.capability_url,
        preflight_url: profile.preflight_url,
        source_url: profile.source_url,
        source_kind: profile.source_kind,
        reasons: profile.reasons,
      },
      authorization: {
        verified: authorization.verified,
        source: authorization.source,
        session_key_id: authorization.session_key_id,
        session_key_address: authorization.session_key_address,
        execution_wallet: authorization.execution_wallet,
        expiry: authorization.expiry,
        scope: {
          allowed_targets: profile.allowed_targets,
          allowed_selectors: profile.allowed_selectors,
          selectors_required: profile.selectors_required,
          private_key_exposed: profile.private_key_exposed,
        },
      },
      execution_market: profile.execution_market,
      execution_capital: {
        status: required ? (authorization.verified ? "authorization_verified" : profile.detected ? "authorization_required" : "execution_declaration_missing") : "not_required",
        detection_source: profile.source_kind,
        warning: !profile.detected
          ? "No provider-specific execution authorization was declared. This is not a hire blocker: ERC-8183 does not require an execution-token endpoint."
          : profile.capital_requirement_confidence === "unknown"
            ? "The agent advertises execution-related behavior, but did not explicitly state that AgentMarket client capital is required."
            : null,
        note: "AgentMarket discovers execution capabilities from provider-declared metadata, ERC-8004 registration services, A2A cards, or registered endpoints. Provider-specific execution plugins are only invoked when the agent declares that capability; a missing plugin route is not treated as a protocol failure.",
      },
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to resolve the provider execution requirement" });
  }
}
