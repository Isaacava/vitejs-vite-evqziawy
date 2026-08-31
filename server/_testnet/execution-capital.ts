import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, keccak256, type Address, type Hex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const KEYSTORE_ABI = [{ type: "function", name: "isValidKey", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }, { name: "keyId", type: "bytes32" }], outputs: [{ name: "valid", type: "bool" }] }] as const;
const COMMERCE_ABI = [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" }] }] }] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });
const CAPABILITY_TIMEOUT_MS = 8_000;
const MAX_CAPABILITY_BYTES = 64 * 1024;
const TESTNET_EXECUTION_CAPITAL_MAX = 1;

function address(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function hex(value: unknown): value is Hex { return typeof value === "string" && /^0x[a-fA-F0-9]*$/.test(value); }
function selector(value: unknown): value is Hex { return typeof value === "string" && /^0x[a-fA-F0-9]{8}$/.test(value); }
function positiveNumber(value: unknown) { const numeric = Number(value); return Number.isFinite(numeric) && numeric > 0; }
function integerBetween(value: unknown, min: number, max: number) { const numeric = Number(value); return Number.isInteger(numeric) && numeric >= min && numeric <= max; }
function executionObject(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
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

export type PublicExecutionCapability = {
  network: "bsc-testnet";
  chainId: 97;
  execution: "altana-scoped-session";
  wallet_provider: "altana";
  authorization_model: "scoped_session";
  session_key_address: Address;
  session_key_public_key: Hex;
  allowed_targets: Address[];
  allowed_selectors: Hex[];
  selectors_required: boolean;
  private_key_exposed: false;
  protocol?: string;
  preflight_path?: string;
  session_scope?: string;
  job_id?: number | null;
};

function validateCapability(body: unknown, expectedJobId?: number): PublicExecutionCapability {
  if (!body || typeof body !== "object") throw new Error("Grid execution capability response is not an object");
  const value = body as Record<string, unknown>;
  if (value.network !== "bsc-testnet" || Number(value.chainId) !== 97) throw new Error("Grid execution capability is not for BSC Testnet");
  if (value.execution !== "altana-scoped-session") throw new Error("Grid execution service does not advertise Altana scoped-session execution");
  if (value.wallet_provider !== "altana" || value.authorization_model !== "scoped_session") throw new Error("Grid execution service did not advertise the required Altana scoped-session model");
  if (value.private_key_exposed !== false) throw new Error("Grid execution capability response must not expose a private key");
  if (value.selectors_required !== true) throw new Error("Grid execution service must require an explicit selector allowlist");
  if (!address(value.session_key_address)) throw new Error("Grid execution capability has an invalid session key address");
  if (!hex(value.session_key_public_key) || value.session_key_public_key.length < 100) throw new Error("Grid execution capability has an invalid session public key");
  const derivedAddress = publicKeyToAddress(value.session_key_public_key);
  if (derivedAddress.toLowerCase() !== value.session_key_address.toLowerCase()) throw new Error("Grid execution session address does not match its public key");
  if (!Array.isArray(value.allowed_targets) || value.allowed_targets.length === 0 || !value.allowed_targets.every(address)) throw new Error("Grid execution capability has no valid contract target allowlist");
  if (!Array.isArray(value.allowed_selectors) || value.allowed_selectors.length === 0 || !value.allowed_selectors.every(selector)) throw new Error("Grid execution capability has no valid function selector allowlist");

  if (expectedJobId !== undefined) {
    if (value.session_scope !== "request-scoped") throw new Error(`Grid execution capability for job ${expectedJobId} is not request-scoped`);
    const returnedJobId = Number(value.job_id);
    if (!Number.isSafeInteger(returnedJobId) || returnedJobId !== expectedJobId) {
      throw new Error(`Grid execution capability returned job_id ${value.job_id ?? "null"}, expected ${expectedJobId}`);
    }
  }

  return {
    network: "bsc-testnet",
    chainId: 97,
    execution: "altana-scoped-session",
    wallet_provider: "altana",
    authorization_model: "scoped_session",
    session_key_address: value.session_key_address,
    session_key_public_key: value.session_key_public_key,
    allowed_targets: value.allowed_targets,
    allowed_selectors: value.allowed_selectors,
    selectors_required: true,
    private_key_exposed: false,
    ...(typeof value.protocol === "string" && value.protocol.trim() ? { protocol: value.protocol.trim().toLowerCase() } : {}),
    ...(typeof value.preflight_path === "string" && value.preflight_path.trim().startsWith("/") ? { preflight_path: value.preflight_path.trim() } : {}),
    ...(typeof value.session_scope === "string" && value.session_scope.trim() ? { session_scope: value.session_scope.trim() } : {}),
    ...(value.job_id === null ? { job_id: null } : Number.isSafeInteger(Number(value.job_id)) ? { job_id: Number(value.job_id) } : {}),
  };
}

async function fetchExecutionCapability(capabilityUrl: string, expectedJobId?: number) {
  let parsed: URL;
  try { parsed = new URL(capabilityUrl); } catch { throw new Error("Provider capability URL is invalid"); }
  if (expectedJobId !== undefined) parsed.searchParams.set("job_id", String(expectedJobId));
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Provider execution endpoint must use HTTP(S)");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CAPABILITY_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Execution capability endpoint returned HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_CAPABILITY_BYTES) throw new Error("Execution capability response is too large");
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_CAPABILITY_BYTES) throw new Error("Execution capability response is too large");
    const parsedBody = raw ? JSON.parse(raw) : null;
    const capability = validateCapability(parsedBody, expectedJobId);
    const market = executionObject(executionObject(parsedBody).execution_market);
    if (!address(market.token_in)) throw new Error("Provider execution capability did not declare a valid execution token");
    return {
      ...capability,
      execution_market: {
        token_in: market.token_in,
        token_out: address(market.token_out) ? market.token_out : null,
        token_in_symbol: typeof market.token_in_symbol === "string" && market.token_in_symbol.trim() ? market.token_in_symbol.trim() : null,
        token_out_symbol: typeof market.token_out_symbol === "string" && market.token_out_symbol.trim() ? market.token_out_symbol.trim() : null,
        fee: Number.isInteger(Number(market.fee)) ? Number(market.fee) : null,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Execution capability endpoint timed out");
    throw error instanceof Error ? error : new Error("Execution capability endpoint failed");
  } finally {
    clearTimeout(timeout);
  }
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

async function loadExecutionCapability(supabase: ReturnType<typeof serverClient>, agent: Record<string, unknown>, chainJobId: number) {
  const agentId = String(agent.id || "");
  const { data: endpoints, error } = await supabase
    .from("agent_endpoints")
    .select("id,endpoint_url,protocol,status,metadata")
    .eq("agent_id", agentId)
    .limit(20);
  if (error) throw new Error(error.message);

  const candidates = [
    ...metadataCapabilityUrls(agent),
    ...(endpoints ?? []).map((endpoint) => `${String(endpoint.endpoint_url).replace(/\/+$/, "")}/execution-capabilities`),
  ];
  const uniqueCandidates = [...new Set(candidates)];
  if (uniqueCandidates.length === 0) throw new Error("Provider has no registered or declared execution capability endpoint");

  const failures: string[] = [];
  for (const candidate of uniqueCandidates) {
    try {
      const capability = await fetchExecutionCapability(candidate, chainJobId);
      const endpoint = (endpoints ?? []).find((row) => candidate.startsWith(`${String(row.endpoint_url).replace(/\/+$/, "")}/`));
      return {
        capability,
        endpointId: endpoint?.id || "declared_metadata",
        endpointUrl: candidate,
        endpointStatus: endpoint?.status || null,
      };
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : "capability fetch failed"}`);
    }
  }
  throw new Error(`Provider execution capability could not be verified from any declared or registered endpoint. ${failures.join(" | ")}`);
}

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
  const grantTxHash = req.body?.session_grant_tx_hash;
  if (!requestId || !address(wallet) || !/^0x[a-fA-F0-9]{64}$/.test(String(sessionKeyId || "")) || !address(signerAddress) || !Number.isInteger(expiry)) return res.status(400).json({ error: "request_id, user_execution_wallet, signer_address, 32-byte session_key_id, and session_expiry are required" });
  if (grantTxHash !== undefined && grantTxHash !== null && (!hex(grantTxHash) || String(grantTxHash).length < 10)) return res.status(400).json({ error: "session_grant_tx_hash is invalid" });
  if (expiry <= Math.floor(Date.now() / 1000)) return res.status(400).json({ error: "Session expiry is already in the past" });
  const supabase = serverClient();
  const { data: request, error: requestError } = await supabase.from("execution_capital_requests").select("*").eq("id", requestId).maybeSingle();
  if (requestError) return res.status(500).json({ error: requestError.message });
  if (!request) return res.status(404).json({ error: "Execution capital request not found" });
  if (request.status === "authorized") return res.status(200).json({ ok: true, authorized: true, request });
  if (request.status !== "requested") return res.status(409).json({ error: `Execution capital request is already ${request.status}` });
  const { data: job, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,client_wallet,chain_job_id").eq("id", request.job_id).maybeSingle();
  if (jobError) return res.status(500).json({ error: jobError.message });
  if (!job || !auth.user.wallet_address || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "You do not own this execution-capital request" });

  const { data: persistentWallet, error: persistentWalletError } = await supabase
    .from("altana_execution_wallets")
    .select("wallet_address,signer_address,chain_id,wallet_provider,authorization_model,rp_id,status")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (persistentWalletError) return res.status(500).json({ error: persistentWalletError.message });
  if (!persistentWallet) return res.status(409).json({ error: "No persistent Altana execution wallet is registered for this AgentMarket account" });
  if (persistentWallet.status !== "active") return res.status(409).json({ error: `The persistent Altana execution wallet is ${persistentWallet.status} and cannot authorize a new session` });
  if (String(persistentWallet.wallet_address).toLowerCase() !== String(wallet).toLowerCase()) return res.status(403).json({ error: "The Altana execution wallet does not belong to the authenticated AgentMarket account" });
  if (!persistentWallet.signer_address || String(persistentWallet.signer_address).toLowerCase() !== String(signerAddress).toLowerCase()) return res.status(403).json({ error: "The Altana Passkey signer does not match the signer registered for this AgentMarket account" });
  if (Number(persistentWallet.chain_id) !== 97 || String(persistentWallet.wallet_provider).toLowerCase() !== "altana" || String(persistentWallet.authorization_model).toLowerCase() !== "passkey") return res.status(409).json({ error: "The registered execution wallet is not a valid BSC Testnet Altana Passkey wallet" });

  const capability = executionObject(request.evidence).execution_capability;
  if (!capability || typeof capability !== "object") return res.status(409).json({ error: "The execution-capital request has no stored public execution capability descriptor" });
  const capabilityObject = capability as Record<string, unknown>;
  const sessionPublicKey = capabilityObject.session_key_public_key;
  const sessionAddress = capabilityObject.session_key_address;
  if (!address(sessionAddress) || !hex(sessionPublicKey)) return res.status(409).json({ error: "The stored execution capability descriptor is invalid" });
  if (String(request.agent_session_key || "").toLowerCase() !== sessionAddress.toLowerCase()) return res.status(409).json({ error: "The stored provider session key does not match the capability descriptor" });
  const expectedSessionKeyId = keccak256(sessionPublicKey);
  if (String(sessionKeyId).toLowerCase() !== expectedSessionKeyId.toLowerCase()) return res.status(409).json({ error: "The granted session key ID does not match the provider's public session key descriptor" });

  const valid = await publicClient.readContract({ address: keyStore, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [wallet, sessionKeyId] });
  if (!valid) return res.status(409).json({ error: "Altana KeyStore does not currently report this session key as valid", authorized: false });
  const now = new Date().toISOString();
  const evidence = { ...(request.evidence || {}), authorization_source: "altana_keystore_isValidKey", authorization_chain_id: 97, session_expiry: expiry, verified_at: now, signer_address: signerAddress, session_grant_tx_hash: grantTxHash || request.session_grant_tx_hash || null };
  const { data: updated, error: updateError } = await supabase.from("execution_capital_requests").update({ user_execution_wallet: wallet, agent_session_key: sessionAddress, session_key_id: sessionKeyId, capital_authorized: request.capital_requested, authorization_verified_at: now, authorized_at: now, session_grant_tx_hash: grantTxHash || null, status: "authorized", evidence, updated_at: now }).eq("id", requestId).eq("status", "requested").select("*").maybeSingle();
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
    const capitalRequested = Number(req.body?.capital_requested);
    const purpose = typeof req.body?.purpose === "string" ? req.body.purpose.trim() : "";
    const duration = req.body?.requested_duration_seconds ?? req.body?.duration_seconds;
    const walletProvider = typeof req.body?.wallet_provider === "string" ? req.body.wallet_provider.toLowerCase().trim() : "";
    const authorizationModel = typeof req.body?.authorization_model === "string" ? req.body.authorization_model.toLowerCase().trim() : "";
    if (!jobId || !positiveNumber(capitalRequested) || !purpose) return res.status(400).json({ error: "job_id, positive capital_requested, and purpose are required" });
    if (capitalRequested !== TESTNET_EXECUTION_CAPITAL_MAX) return res.status(400).json({ error: "Controlled BSC Testnet execution-capital proof is limited to exactly 1 U" });
    if (!integerBetween(duration, 300, 7 * 24 * 60 * 60)) return res.status(400).json({ error: "requested duration must be an integer between 300 and 604800 seconds" });
    if (walletProvider !== "altana" || authorizationModel !== "scoped_session") return res.status(400).json({ error: "Execution capital is currently available only through Altana scoped sessions" });
    const owned = await loadOwnedFundedJob(supabase, jobId, auth.user.id, auth.user.wallet_address);
    const capability = await loadExecutionCapability(supabase, owned.agent as Record<string, unknown>, Number(owned.job.chain_job_id));
    if (!address(capability.capability.execution_market.token_in)) return res.status(409).json({ error: "Provider execution capability did not declare a valid execution-capital token" });
    const { data: existing, error: existingError } = await supabase.from("execution_capital_requests").select("*").eq("job_id", jobId).maybeSingle();
    if (existingError) return res.status(500).json({ error: existingError.message });
    if (existing) return res.status(409).json({ error: "An execution capital request already exists for this job", request: existing });
    const fetchedAt = new Date().toISOString();
    const capabilityEvidence = {
      ...capability.capability,
      source_url: capability.endpointUrl,
      endpoint_id: capability.endpointId,
      endpoint_status: capability.endpointStatus,
      fetched_at: fetchedAt,
      independently_authorized: false,
    };
    const { data: request, error: insertError } = await supabase.from("execution_capital_requests").insert({
      job_id: jobId,
      requester_wallet: auth.user.wallet_address,
      user_execution_wallet: null,
      agent_session_key: capability.capability.session_key_address,
      capital_requested: String(TESTNET_EXECUTION_CAPITAL_MAX),
      capital_token: capability.capability.execution_market.token_in,
      purpose,
      duration_seconds: Number(duration),
      wallet_provider: "altana",
      authorization_model: "scoped_session",
      status: "requested",
      evidence: {
        source: "agentmarket_execution_capital_request",
        chain_id: 97,
        chain_job_id: Number(owned.job.chain_job_id),
        provider_agent_id: owned.agent.agent_id,
        execution_capability: capabilityEvidence,
      },
    }).select("*").single();
    if (insertError) return res.status(500).json({ error: insertError.message });
    return res.status(201).json({ ok: true, request });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = /not found|does not|only|cannot|not attached|not the authenticated|not created|live status|own this|declared|capability|endpoint|exactly 1 U/i.test(message) ? 409 : 500;
    return res.status(status).json({ error: message });
  }
}