import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
import { discoverUniversalAgentInterop, pickOperation } from "./universal-agent-interop.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const COMMERCE_ABI = [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" }] }] }] as const;
const client = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });

type JsonRecord = Record<string, unknown>;
function object(value: unknown): JsonRecord { return value && typeof value === "object" ? value as JsonRecord : {}; }
function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function boolValue(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function unwrapProviderContent(value: unknown): JsonRecord {
  const root = object(value);
  const response = object(root.response);
  const content = response.content ?? root.content ?? root.result;
  const parsed = parseJson(content);
  const direct = object(parsed);
  if (Object.keys(direct).length) return direct;
  return root;
}

function classifyExecution(root: JsonRecord) {
  const explicit = stringValue(root.execution_mode || root.executionMode || root.execution);
  const status = stringValue(root.execution_status || root.executionStatus || root.status).toLowerCase();
  const auth = object(root.authorization);
  const authRequired = boolValue(auth.required);
  const authStatus = stringValue(auth.status) || null;
  const normalized = explicit.toLowerCase().replace(/[ -]+/g, "_");

  if (/^(observation_only|read_only|analysis_only|preview_only|simulation_only)$/.test(normalized) || /not[_-]?required/.test(authStatus || "")) {
    return { mode: "observation_only" as const, status: status || "observed", authorization_required: false, authorization_status: authStatus || "not_required" };
  }
  if (authRequired === true || /^(state_changing|stateful|transactional|execute|execution|trade|swap|rebalance|write)$/.test(normalized)) {
    return { mode: "state_changing" as const, status: status || null, authorization_required: authRequired, authorization_status: authStatus };
  }
  if (/executed|submitted|broadcast|transaction/.test(status)) {
    return { mode: "state_changing" as const, status, authorization_required: authRequired, authorization_status: authStatus };
  }
  return { mode: "unknown" as const, status: status || null, authorization_required: authRequired, authorization_status: authStatus };
}

async function loadArchive(supabase: ReturnType<typeof serverClient>, jobId: string) {
  const { data, error } = await supabase.from("erc8183_deliverable_archives").select("verified,captured_at,content_json,content_text,provider_endpoint").eq("job_id", jobId).order("captured_at", { ascending: false }).limit(1);
  if (error) return { archive: null, error: error.message };
  const row = data?.[0];
  if (!row) return { archive: null, error: null };
  return { archive: { ...row, parsed: unwrapProviderContent(row.content_json || row.content_text || null) }, error: null };
}

async function loadRequest(supabase: ReturnType<typeof serverClient>, jobId: string) {
  const { data, error } = await supabase.from("execution_capital_requests").select("*").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1);
  if (error) return { request: null, error: error.message };
  return { request: data?.[0] || null, error: null };
}

function operationSummary(interop: Awaited<ReturnType<typeof discoverUniversalAgentInterop>>) {
  return interop.operations.map((operation) => ({ kind: operation.kind, protocol: operation.protocol, endpoint: operation.endpoint, method: operation.method, name: operation.name, evidence: operation.evidence }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    const jobId = typeof req.query?.job === "string" ? req.query.job.trim() : "";
    if (!jobId) return res.status(400).json({ error: "job is required" });
    const supabase = serverClient();
    const { data: job, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,client_wallet,chain_job_id,budget,status").eq("id", jobId).maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (!auth.user.wallet_address || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "The authenticated wallet does not own this job" });
    if (!job.mission_task_id) throw new Error("Job is not attached to a mission task");

    const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,mission_id,agent_id").eq("id", job.mission_task_id).maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task?.mission_id || !task.agent_id) throw new Error("Job does not identify a provider agent");
    const { data: mission, error: missionError } = await supabase.from("missions").select("id,user_id").eq("id", task.mission_id).maybeSingle();
    if (missionError) throw new Error(missionError.message);
    if (!mission || mission.user_id !== auth.user.id) return res.status(403).json({ error: "You do not own this mission" });
    const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,name,owner,chain,status,verification_status,is_first_party,metadata").eq("id", task.agent_id).maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) throw new Error("Provider agent not found");

    let chain: any = null;
    if (job.chain_job_id != null) chain = await client.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "getJob", args: [BigInt(job.chain_job_id)] });
    const archiveResult = await loadArchive(supabase, job.id);
    const requestResult = await loadRequest(supabase, job.id);
    const registered = await supabase.from("agent_endpoints").select("endpoint_url,protocol,version,metadata").eq("agent_id", String(agent.id)).limit(50);
    const interop = await discoverUniversalAgentInterop(agent as Record<string, unknown>, registered.data || []);
    const providerResult = archiveResult.archive?.parsed || null;
    const execution = classifyExecution(providerResult || {});
    const metadata = object(agent.metadata);
    const executionMeta = object(metadata.execution);
    const advertisedCapabilityUrl = stringValue(metadata.execution_capability_url || metadata.execution_capabilities_url || executionMeta.execution_capability_url || executionMeta.execution_capabilities_url || executionMeta.capability_endpoint);
    const explicitExecutionCapital = object(providerResult?.execution_capital);
    const capitalRequired = execution.mode === "observation_only" ? false : execution.authorization_required === true || Object.keys(explicitExecutionCapital).length > 0 || Boolean(requestResult.request);
    const funded = Boolean(chain && Number(chain.status) === 1);
    const submitted = Boolean(chain && Number(chain.status) >= 2) || String(job.status).toLowerCase() === "submitted";
    const capabilityOperation = pickOperation(interop, "capability");
    const executeOperation = pickOperation(interop, "execute");

    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: 97,
      provider_agent_id: agent.agent_id,
      provider_name: agent.name,
      provider: { id: agent.id, owner: agent.owner, chain: agent.chain, status: agent.status, verification_status: agent.verification_status, is_first_party: agent.is_first_party },
      erc8183: { job_id: job.chain_job_id, status: chain ? Number(chain.status) : null, funded, submitted, client: chain?.client || null, provider: chain?.provider || null },
      execution_mode: execution.mode,
      execution_status: execution.status,
      authorization_required: capitalRequired,
      authorization_status: requestResult.request ? String((requestResult.request as Record<string, unknown>).status || "requested") : execution.authorization_status,
      evidence_source: archiveResult.archive ? "provider_deliverable" : "declared_agent_services",
      provider_evidence: archiveResult.archive ? { verified: Boolean(archiveResult.archive.verified), captured_at: archiveResult.archive.captured_at, provider_endpoint: archiveResult.archive.provider_endpoint } : null,
      execution_capital: {
        status: requestResult.request ? String((requestResult.request as Record<string, unknown>).status || "requested") : execution.mode === "observation_only" ? "not_required" : capitalRequired ? "required_not_requested" : "not_advertised",
        requested_amount: requestResult.request ? (requestResult.request as Record<string, unknown>).capital_requested || null : (explicitExecutionCapital.required_amount || null),
        requested_amount_raw: requestResult.request ? (requestResult.request as Record<string, unknown>).capital_requested || null : (explicitExecutionCapital.required_amount_raw || null),
        token: requestResult.request ? (requestResult.request as Record<string, unknown>).capital_token || null : (explicitExecutionCapital.token || null),
        symbol: requestResult.request ? (requestResult.request as Record<string, unknown>).capital_token_symbol || null : (explicitExecutionCapital.symbol || null),
        discovery: advertisedCapabilityUrl || capabilityOperation?.endpoint || executeOperation?.endpoint || null,
      },
      capability_discovery: { advertised_url: advertisedCapabilityUrl || null, capability_operation: capabilityOperation || null, execution_operation: executeOperation || null, operations: operationSummary(interop), errors: interop.discovery_errors },
      request: requestResult.request,
      notes: execution.mode === "observation_only"
        ? "Provider result explicitly declares observation-only execution. AgentMarket must not request an execution session or present an execution-capital requirement for this job."
        : advertisedCapabilityUrl
          ? "A provider-specific capability mechanism is advertised. AgentMarket treats it as provider-specific authorization evidence and does not require a fixed /execution-capabilities route."
          : "No provider-specific execution authorization mechanism was independently published. AgentMarket will not invent one or infer a capital requirement from an arbitrary execute endpoint.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve universal execution state";
    return res.status(409).json({ error: message });
  }
}
