import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const KEYSTORE_ABI = [{ type: "function", name: "isValidKey", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }, { name: "keyId", type: "bytes32" }], outputs: [{ name: "valid", type: "bool" }] }] as const;
const COMMERCE_ABI = [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" }] }] }] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });

function address(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function positiveNumber(value: unknown) { const numeric = Number(value); return Number.isFinite(numeric) && numeric > 0; }
function integerBetween(value: unknown, min: number, max: number) { const numeric = Number(value); return Number.isInteger(numeric) && numeric >= min && numeric <= max; }
function walletProviderFromAgent(agent: Record<string, unknown>) {
  const metadata = agent.metadata && typeof agent.metadata === "object" ? agent.metadata as Record<string, unknown> : {};
  const execution = metadata.execution && typeof metadata.execution === "object" ? executionObject(metadata.execution) : {};
  const declared = typeof execution.wallet_provider === "string" ? execution.wallet_provider.toLowerCase() : "";
  const text = JSON.stringify(metadata).toLowerCase();
  if (declared === "altana" || text.includes("altana")) return "altana";
  if (declared === "twak" || text.includes("twak")) return "twak";
  if (declared === "evm" || text.includes("evmwalletprovider")) return "evm";
  return "unknown";
}
function executionObject(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }

async function loadOwnedFundedJob(supabase: ReturnType<typeof serverClient>, jobId: string, userId: string, userWallet: string | null) {
  const { data: job, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,client_wallet,chain_job_id,budget").eq("id", jobId).maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Job not found");
  if (!job.mission_task_id) throw new Error("Job is not attached to a mission task");
  if (!userWallet || String(job.client_wallet || "").toLowerCase() !== userWallet.toLowerCase()) throw new Error("The authenticated wallet does not own this job");
  const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,mission_id,agent_id").eq("id", job.mission_task_id).maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task?.mission_id || !task.agent_id) throw new Error("Job does not identify a provider agent");
  const { data: mission, error: missionError } = await supabase.from("missions").select("id,user_id,client_wallet").eq("id", task.mission_id).maybeSingle();
  if (missionError) throw new Error(missionError.message);
  if (!mission || mission.user_id !== userId) throw new Error("You do not own this mission");
  const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,owner,metadata").eq("id", task.agent_id).maybeSingle();
  if (agentError) throw new Error(agentError.message);
  if (!agent) throw new Error("Provider agent not found");
  if (!job.chain_job_id) throw new Error("The ERC-8183 chain job has not been created yet");
  const chainJob = await publicClient.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "getJob", args: [BigInt(job.chain_job_id)] });
  if (Number(chainJob.status) !== 1) throw new Error(`Execution capital can only be requested for a funded job; live status is ${Number(chainJob.status)}`);
  if (String(chainJob.client).toLowerCase() !== userWallet.toLowerCase()) throw new Error("The live ERC-8183 client is not the authenticated wallet");
  if (walletProviderFromAgent(agent as Record<string, unknown>) !== "altana") throw new Error("This provider has not explicitly declared Altana scoped-session execution support");
  return { job, task, mission, agent, chainJob };
}

async function verifySession(req: VercelRequest, res: VercelResponse, auth: Awaited<ReturnType<typeof getAuthenticatedUser>>) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  const keyStore = (process.env.ALTANA_KEYSTORE_ADDRESS || "") as Address;
  if (!address(keyStore)) return res.status(503).json({ error: "ALTANA_KEYSTORE_ADDRESS is not configured on the server; onchain authorization cannot be verified yet" });
  const requestId = typeof req.body?.request_id === "string" ? req.body.request_id.trim() : "";
  const wallet = req.body?.user_execution_wallet;
  const sessionKeyId = req.body?.session_key_id;
  const signerAddress = req.body?.signer_address;
  const expiry = Number(req.body?.session_expiry);
  if (!requestId || !address(wallet) || !/^0x[a-fA-F0-9]{64}$/.test(String(sessionKeyId || "")) || !address(signerAddress) || !Number.isInteger(expiry)) return res.status(400).json({ error: "request_id, user_execution_wallet, signer_address, 32-byte session_key_id, and session_expiry are required" });
  if (!auth?.user.wallet_address || auth.user.wallet_address.toLowerCase() !== signerAddress.toLowerCase()) return res.status(403).json({ error: "The Altana wallet signer does not match the authenticated AgentMarket wallet" });
  if (expiry <= Math.floor(Date.now() / 1000)) return res.status(400).json({ error: "Session expiry is already in the past" });
  const supabase = serverClient();
  const { data: request, error: requestError } = await supabase.from("execution_capital_requests").select("*").eq("id", requestId).maybeSingle();
  if (requestError) return res.status(500).json({ error: requestError.message });
  if (!request) return res.status(404).json({ error: "Execution capital request not found" });
  const { data: job, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,client_wallet,chain_job_id").eq("id", request.job_id).maybeSingle();
  if (jobError) return res.status(500).json({ error: jobError.message });
  if (!job || !auth.user.wallet_address || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "You do not own this execution-capital request" });
  const valid = await publicClient.readContract({ address: keyStore, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [wallet, sessionKeyId] });
  if (!valid) return res.status(409).json({ error: "Altana KeyStore does not currently report this session key as valid", authorized: false });
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase.from("execution_capital_requests").update({ user_execution_wallet: wallet, session_key_id: sessionKeyId, capital_authorized: request.capital_requested, authorization_verified_at: now, authorized_at: now, status: "authorized", evidence: { ...(request.evidence || {}), authorization_source: "altana_keystore_isValidKey", authorization_chain_id: 97, session_expiry: expiry, verified_at: now }, updated_at: now }).eq("id", requestId).eq("status", "requested").select("*").maybeSingle();
  if (updateError) return res.status(500).json({ error: updateError.message });
  if (!updated) { const { data: current } = await supabase.from("execution_capital_requests").select("*").eq("id", requestId).maybeSingle(); return res.status(200).json({ ok: true, authorized: current?.status === "authorized", request: current }); }
  return res.status(200).json({ ok: true, authorized: true, request: updated });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    const supabase = serverClient();
    const action = typeof req.query?.action === "string" ? req.query.action.trim().toLowerCase() : "";
    if (action === "verify" || req.body?.action === "verify") return await verifySession(req, res, auth);
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
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "Method not allowed" }); }
    const jobId = typeof req.body?.job_id === "string" ? req.body.job_id.trim() : "";
    const capitalRequested = req.body?.capital_requested;
    const purpose = typeof req.body?.purpose === "string" ? req.body.purpose.trim() : "";
    const duration = req.body?.requested_duration_seconds ?? req.body?.duration_seconds;
    const walletProvider = typeof req.body?.wallet_provider === "string" ? req.body.wallet_provider.toLowerCase().trim() : "";
    const authorizationModel = typeof req.body?.authorization_model === "string" ? req.body.authorization_model.toLowerCase().trim() : "";
    if (!jobId || !positiveNumber(capitalRequested) || !purpose) return res.status(400).json({ error: "job_id, positive capital_requested, and purpose are required" });
    if (!integerBetween(duration, 300, 7 * 24 * 60 * 60)) return res.status(400).json({ error: "requested duration must be an integer between 300 and 604800 seconds" });
    if (walletProvider !== "altana" || authorizationModel !== "scoped_session") return res.status(400).json({ error: "Execution capital is currently available only through Altana scoped sessions" });
    const owned = await loadOwnedFundedJob(supabase, jobId, auth.user.id, auth.user.wallet_address);
    const { data: existing, error: existingError } = await supabase.from("execution_capital_requests").select("*").eq("job_id", jobId).maybeSingle();
    if (existingError) return res.status(500).json({ error: existingError.message });
    if (existing) return res.status(409).json({ error: "An execution capital request already exists for this job", request: existing });
    const { data: request, error: insertError } = await supabase.from("execution_capital_requests").insert({ job_id: jobId, requester_wallet: auth.user.wallet_address, capital_requested: String(capitalRequested), purpose, duration_seconds: Number(duration), wallet_provider: "altana", authorization_model: "scoped_session", status: "requested", evidence: { source: "agentmarket_execution_capital_request", chain_id: 97, chain_job_id: Number(owned.job.chain_job_id), provider_agent_id: owned.agent.agent_id } }).select("*").single();
    if (insertError) return res.status(500).json({ error: insertError.message });
    return res.status(201).json({ ok: true, request });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    const status = /not found|does not|only|cannot|not attached|not the authenticated|not created|live status|own this|declared/i.test(message) ? 409 : 500;
    return res.status(status).json({ error: message });
  }
}
