import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
import { invokeProviderOperation, resolveProviderOperation } from "./provider-operation.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const COMMERCE_ABI = [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" }] }], }] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });
const MAX_TESTNET_EXECUTION_CAPITAL = 1;
const DEFAULT_DURATION_SECONDS = 86400;
const MIN_DURATION_SECONDS = 300;
const MAX_DURATION_SECONDS = 604800;

type JsonRecord = Record<string, unknown>;
function address(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function hex(value: unknown): value is Hex { return typeof value === "string" && /^0x[a-fA-F0-9]*$/.test(value); }
function object(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function finitePositiveNumber(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; }

function findExecutionDescriptor(value: unknown): JsonRecord | null {
  const root = object(value);
  const candidates = [root, object(root.execution_capability), object(root.executionCapability), object(root.authorization), object(root.capability), object(root.data)];
  for (const candidate of candidates) {
    if (String(candidate.network || "").toLowerCase() !== "bsc-testnet" || Number(candidate.chainId ?? candidate.chain_id) !== 97) continue;
    if (typeof candidate.execution !== "string" && typeof candidate.execution_mode !== "string" && typeof candidate.mode !== "string") continue;
    if (candidate.private_key_exposed === true) continue;
    if (candidate.allowed_targets !== undefined && (!Array.isArray(candidate.allowed_targets) || candidate.allowed_targets.some((item) => !address(item)))) continue;
    if (candidate.allowed_selectors !== undefined && (!Array.isArray(candidate.allowed_selectors) || candidate.allowed_selectors.some((item) => !/^0x[a-fA-F0-9]{8}$/.test(String(item))))) continue;
    return candidate;
  }
  return null;
}

function findAuthorizationRequest(value: JsonRecord, fallback: { amount: number; duration: number; purpose: string }) {
  const candidates = [value, object(value.authorization_request), object(value.authorizationRequest), object(value.execution_capital), object(value.executionCapital), object(value.authorization), object(value.request)];
  for (const candidate of candidates) {
    const amount = finitePositiveNumber(candidate.capital_requested ?? candidate.capitalRequested ?? candidate.required_amount ?? candidate.requiredAmount ?? candidate.amount);
    const duration = Number(candidate.duration_seconds ?? candidate.durationSeconds ?? candidate.duration ?? 0);
    const purpose = typeof candidate.purpose === "string" && candidate.purpose.trim() ? candidate.purpose.trim() : "";
    if (amount || Number.isInteger(duration) || purpose) return { amount: amount ?? fallback.amount, duration: Number.isInteger(duration) && duration >= MIN_DURATION_SECONDS && duration <= MAX_DURATION_SECONDS ? duration : fallback.duration, purpose: purpose || fallback.purpose };
  }
  return fallback;
}

async function capability(agent: JsonRecord, jobContext: JsonRecord) {
  const { data: endpoints, error } = await serverClient().from("agent_endpoints").select("endpoint_url,protocol,status,metadata").eq("agent_id", String(agent.id || "")).order("last_checked_at", { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  for (const endpoint of (endpoints || []) as JsonRecord[]) {
    try {
      const operation = await resolveProviderOperation(endpoint as { endpoint_url: string; protocol: string; status: string; metadata?: unknown }, "authorization");
      if (!operation) continue;
      const result = await invokeProviderOperation(operation, jobContext);
      const descriptor = findExecutionDescriptor(result.body);
      if (descriptor) return { descriptor, source_url: result.endpoint, operation: { action: operation.action, endpoint: result.endpoint, method: operation.method, transport: operation.transport, name: operation.name } };
    } catch {
      // Continue to the next declared provider authorization operation.
    }
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    const jobId = typeof req.body?.job_id === "string" ? req.body.job_id.trim() : "";
    const chainJobId = String(req.body?.chain_job_id ?? "").trim();
    const purpose = typeof req.body?.purpose === "string" && req.body.purpose.trim() ? req.body.purpose.trim() : "Agent execution";
    const requestedDuration = Number(req.body?.duration_seconds ?? DEFAULT_DURATION_SECONDS);
    const requestedAmount = finitePositiveNumber(req.body?.capital_requested ?? null);
    if (!jobId || !/^\d+$/.test(chainJobId) || !Number.isInteger(requestedDuration) || requestedDuration < MIN_DURATION_SECONDS || requestedDuration > MAX_DURATION_SECONDS) return res.status(400).json({ error: "job_id, chain_job_id, and a valid execution duration are required" });
    if (requestedAmount !== null && requestedAmount > MAX_TESTNET_EXECUTION_CAPITAL) return res.status(400).json({ error: `Requested Testnet execution capital exceeds the global ${MAX_TESTNET_EXECUTION_CAPITAL} unit safety ceiling` });

    const supabase = serverClient();
    const jobQuery = /^\d+$/.test(jobId)
      ? supabase.from("jobs").select("id,mission_task_id,client_wallet,chain_job_id").eq("chain_job_id", Number(jobId)).maybeSingle()
      : supabase.from("jobs").select("id,mission_task_id,client_wallet,chain_job_id").eq("id", jobId).maybeSingle();
    const { data: job, error: jobError } = await jobQuery;
    if (jobError) throw new Error(jobError.message);
    if (!job || !job.mission_task_id) return res.status(404).json({ error: "Marketplace job not found" });
    if (!auth.user.wallet_address || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "The authenticated wallet does not own this job" });
    if (job.chain_job_id && String(job.chain_job_id) !== chainJobId) return res.status(409).json({ error: "Marketplace and on-chain job IDs do not match" });

    const chainJob = await publicClient.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "getJob", args: [BigInt(chainJobId)] });
    if (!chainJob || chainJob.id === 0n) return res.status(404).json({ error: "ERC-8183 job not found" });
    if (chainJob.client.toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "ERC-8183 job client does not match the authenticated wallet" });
    if (![0, 1].includes(Number(chainJob.status))) return res.status(409).json({ error: `Execution authorization can only be prepared for an open or funded job; live status is ${Number(chainJob.status)}` });

    const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,mission_id,agent_id").eq("id", job.mission_task_id).maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task?.mission_id || !task.agent_id) return res.status(409).json({ error: "Job does not identify a provider agent" });
    const { data: mission, error: missionError } = await supabase.from("missions").select("id,user_id").eq("id", task.mission_id).maybeSingle();
    if (missionError) throw new Error(missionError.message);
    if (!mission || mission.user_id !== auth.user.id) return res.status(403).json({ error: "You do not own this mission" });
    const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,owner,metadata").eq("id", task.agent_id).maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ error: "Provider agent not found" });

    const fallbackRequest = { amount: requestedAmount ?? MAX_TESTNET_EXECUTION_CAPITAL, duration: requestedDuration, purpose };
    const cap = await capability(agent as JsonRecord, { chain_job_id: Number(chainJobId), job_id: job.id, agent_id: agent.agent_id, client_wallet: auth.user.wallet_address, provider_wallet: chainJob.provider, evaluator_wallet: chainJob.evaluator, network: "bsc-testnet", environment: "testnet", purpose, duration_seconds: requestedDuration, capital_requested: requestedAmount ?? null });
    if (!cap) return res.status(200).json({ ok: true, required: false, created: false, chain_job_id: Number(chainJobId), note: "Provider does not currently advertise a verified execution-authorization capability." });

    const requested = findAuthorizationRequest(cap.descriptor, fallbackRequest);
    if (requested.amount <= 0 || requested.amount > MAX_TESTNET_EXECUTION_CAPITAL) return res.status(409).json({ error: `Provider-declared Testnet execution capital is outside the global ${MAX_TESTNET_EXECUTION_CAPITAL} unit safety ceiling`, requested_amount: requested.amount });

    const walletProvider = text(cap.descriptor.wallet_provider) || "provider-declared";
    const authorizationModel = text(cap.descriptor.authorization_model) || "provider-declared";
    const market = object(cap.descriptor.execution_market);
    const token = address(market.token_in) ? market.token_in : null;
    const existingQuery = await supabase.from("execution_capital_requests").select("*").eq("job_id", job.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existingQuery.error) throw new Error(existingQuery.error.message);
    if (existingQuery.data) return res.status(200).json({ ok: true, required: true, created: false, request: existingQuery.data, chain_job_id: Number(chainJobId) });

    const fetchedAt = new Date().toISOString();
    const requestRow: JsonRecord = {
      job_id: job.id,
      requester_wallet: auth.user.wallet_address,
      user_execution_wallet: address(cap.descriptor.execution_wallet) ? cap.descriptor.execution_wallet : null,
      agent_session_key: address(cap.descriptor.session_key_address) ? cap.descriptor.session_key_address : null,
      capital_requested: String(requested.amount),
      capital_token: token || (typeof cap.descriptor.capital_token === "string" ? cap.descriptor.capital_token : "0000000000000000000000000000000000000000"),
      purpose: requested.purpose,
      duration_seconds: requested.duration,
      wallet_provider: walletProvider,
      authorization_model: authorizationModel,
      status: "requested",
      evidence: {
        source: "provider_declared_authorization_operation",
        chain_id: 97,
        chain_job_id: Number(chainJobId),
        provider_agent_id: agent.agent_id,
        execution_capability: { ...cap.descriptor, source_url: cap.source_url, endpoint_id: "provider_operation", operation: cap.operation, fetched_at: fetchedAt, independently_authorized: false },
        authorization_request: { capital_requested: requested.amount, duration_seconds: requested.duration, purpose: requested.purpose, derived_from_provider: true },
      },
    };
    const { data: request, error: insertError } = await supabase.from("execution_capital_requests").insert(requestRow).select("*").single();
    if (insertError) throw new Error(insertError.message);
    return res.status(201).json({ ok: true, required: true, created: true, request, chain_job_id: Number(chainJobId) });
  } catch (error) { return res.status(409).json({ ok: false, error: error instanceof Error ? error.message : "Unable to prepare execution authorization" }); }
}

function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
