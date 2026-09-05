import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
import { invokeProviderOperation, resolveProviderOperation } from "./provider-operation.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const COMMERCE_ABI = [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" }] }], }] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });

function address(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function hex(value: unknown): value is Hex { return typeof value === "string" && /^0x[a-fA-F0-9]*$/.test(value); }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function findExecutionDescriptor(value: unknown): Record<string, unknown> | null {
  const root = object(value);
  const candidates = [root, object(root.execution_capability), object(root.executionCapability), object(root.authorization), object(root.capability), object(root.data)];
  for (const candidate of candidates) {
    const market = object(candidate.execution_market ?? candidate.executionMarket);
    if (
      candidate.network === "bsc-testnet" &&
      Number(candidate.chainId) === 97 &&
      candidate.execution === "altana-scoped-session" &&
      candidate.wallet_provider === "altana" &&
      candidate.authorization_model === "scoped_session" &&
      candidate.private_key_exposed === false &&
      address(candidate.session_key_address) &&
      hex(candidate.session_key_public_key) &&
      Array.isArray(candidate.allowed_targets) && candidate.allowed_targets.length > 0 &&
      Array.isArray(candidate.allowed_selectors) && candidate.allowed_selectors.length > 0 &&
      address(market.token_in)
    ) {
      return candidate;
    }
  }
  return null;
}

async function capability(agent: Record<string, unknown>, jobContext: Record<string, unknown>) {
  const { data: endpoints, error } = await serverClient()
    .from("agent_endpoints")
    .select("endpoint_url,protocol,status,metadata")
    .eq("agent_id", String(agent.id || ""))
    .order("last_checked_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);

  for (const endpoint of (endpoints || []) as Array<Record<string, unknown>>) {
    try {
      const operation = await resolveProviderOperation(endpoint as {
        endpoint_url: string;
        protocol: string;
        status: string;
        metadata?: unknown;
        version?: string | null;
      }, "authorization");
      if (!operation) continue;

      const result = await invokeProviderOperation(operation, jobContext);
      const descriptor = findExecutionDescriptor(result.body);
      if (descriptor) {
        return {
          descriptor,
          source_url: result.endpoint,
          operation: {
            action: operation.action,
            endpoint: result.endpoint,
            method: operation.method,
            transport: operation.transport,
            name: operation.name,
          },
        };
      }
    } catch {
      // Continue to the next declared authorization operation.
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
    const duration = Number(req.body?.duration_seconds ?? 86400);
    const amount = Number(req.body?.capital_requested ?? 1);
    if (!jobId || !/^\d+$/.test(chainJobId) || amount !== 1 || !Number.isInteger(duration) || duration < 300 || duration > 604800) {
      return res.status(400).json({ error: "job_id, chain_job_id, exactly 1 U, and a valid duration are required" });
    }

    const supabase = serverClient();
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id,mission_task_id,client_wallet,chain_job_id")
      .eq("id", jobId)
      .maybeSingle();
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

    const cap = await capability(agent as Record<string, unknown>, {
      chain_job_id: Number(chainJobId),
      job_id: job.id,
      agent_id: agent.agent_id,
      client_wallet: auth.user.wallet_address,
      provider_wallet: chainJob.provider,
      evaluator_wallet: chainJob.evaluator,
      network: "bsc-testnet",
      environment: "testnet",
      purpose,
      duration_seconds: duration,
      capital_requested: 1,
    });

    if (!cap) return res.status(200).json({ ok: true, required: false, created: false, chain_job_id: Number(chainJobId), note: "Provider does not currently advertise a verified execution-authorization capability." });

    const market = object(cap.descriptor.execution_market);
    const { data: existing, error: existingError } = await supabase
      .from("execution_capital_requests")
      .select("*")
      .eq("job_id", job.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) return res.status(200).json({ ok: true, required: true, created: false, request: existing, chain_job_id: Number(chainJobId) });

    const fetchedAt = new Date().toISOString();
    const { data: request, error: insertError } = await supabase.from("execution_capital_requests").insert({
      job_id: job.id,
      requester_wallet: auth.user.wallet_address,
      user_execution_wallet: null,
      agent_session_key: cap.descriptor.session_key_address,
      capital_requested: "1",
      capital_token: market.token_in,
      purpose,
      duration_seconds: duration,
      wallet_provider: "altana",
      authorization_model: "scoped_session",
      status: "requested",
      evidence: {
        source: "agentmarket_execution_authorization_prepare",
        chain_id: 97,
        chain_job_id: Number(chainJobId),
        provider_agent_id: agent.agent_id,
        execution_capability: {
          ...cap.descriptor,
          source_url: cap.source_url,
          operation: cap.operation,
          fetched_at: fetchedAt,
          independently_authorized: false,
        },
      },
    }).select("*").single();
    if (insertError) throw new Error(insertError.message);

    return res.status(201).json({ ok: true, required: true, created: true, request, chain_job_id: Number(chainJobId) });
  } catch (error) {
    return res.status(409).json({ ok: false, error: error instanceof Error ? error.message : "Unable to prepare execution authorization" });
  }
}
