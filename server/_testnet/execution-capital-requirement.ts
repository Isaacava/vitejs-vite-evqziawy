import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
import { discoverUniversalAgentInterop, pickOperation } from "./universal-agent-interop.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const KEYSTORE_ABI = [{ type: "function", name: "isValidKey", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }, { name: "keyId", type: "bytes32" }], outputs: [{ name: "valid", type: "bool" }] }] as const;
const COMMERCE_ABI = [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" }] }] }] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });
const CAPABILITY_TIMEOUT_MS = 8_000;
const MAX_CAPABILITY_BYTES = 64 * 1024;

function address(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function hex(value: unknown): value is Hex { return typeof value === "string" && /^0x[a-fA-F0-9]*$/.test(value); }
function selector(value: unknown): value is Hex { return typeof value === "string" && /^0x[a-fA-F0-9]{8}$/.test(value); }
function object(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }

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
  execution_market?: {
    token_in?: Address | null;
    token_out?: Address | null;
    token_in_symbol?: string | null;
    token_out_symbol?: string | null;
    fee?: number | null;
  };
};

function validateCapability(body: unknown): PublicExecutionCapability {
  const value = object(body);
  if (value.network !== "bsc-testnet" || Number(value.chainId) !== 97) throw new Error("Provider execution capability is not for BSC Testnet");
  if (value.execution !== "altana-scoped-session") throw new Error("Provider does not advertise Altana scoped-session execution");
  if (value.wallet_provider !== "altana" || value.authorization_model !== "scoped_session") throw new Error("Provider did not advertise the required Altana scoped-session model");
  if (value.private_key_exposed !== false) throw new Error("Execution capability response must not expose a private key");
  if (value.selectors_required !== true) throw new Error("Execution capability must require an explicit selector allowlist");
  if (!address(value.session_key_address)) throw new Error("Execution capability has an invalid session key address");
  if (!hex(value.session_key_public_key) || value.session_key_public_key.length < 100) throw new Error("Execution capability has an invalid session public key");
  if (publicKeyToAddress(value.session_key_public_key).toLowerCase() !== value.session_key_address.toLowerCase()) throw new Error("Execution session address does not match its public key");
  if (!Array.isArray(value.allowed_targets) || value.allowed_targets.length === 0 || !value.allowed_targets.every(address)) throw new Error("Execution capability has no valid contract target allowlist");
  if (!Array.isArray(value.allowed_selectors) || value.allowed_selectors.length === 0 || !value.allowed_selectors.every(selector)) throw new Error("Execution capability has no valid function selector allowlist");
  const market = object(value.execution_market);
  return {
    network: "bsc-testnet", chainId: 97, execution: "altana-scoped-session", wallet_provider: "altana", authorization_model: "scoped_session",
    session_key_address: value.session_key_address, session_key_public_key: value.session_key_public_key, allowed_targets: value.allowed_targets, allowed_selectors: value.allowed_selectors,
    selectors_required: true, private_key_exposed: false,
    ...(typeof value.protocol === "string" && value.protocol.trim() ? { protocol: value.protocol.trim().toLowerCase() } : {}),
    ...(typeof value.preflight_path === "string" && value.preflight_path.trim().startsWith("/") ? { preflight_path: value.preflight_path.trim() } : {}),
    execution_market: {
      token_in: address(market.token_in) ? market.token_in : null, token_out: address(market.token_out) ? market.token_out : null,
      token_in_symbol: typeof market.token_in_symbol === "string" && market.token_in_symbol.trim() ? market.token_in_symbol.trim() : null,
      token_out_symbol: typeof market.token_out_symbol === "string" && market.token_out_symbol.trim() ? market.token_out_symbol.trim() : null,
      fee: Number.isInteger(Number(market.fee)) ? Number(market.fee) : null,
    },
  };
}

async function fetchCapability(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Provider capability URL is invalid"); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Provider execution endpoint must use HTTP(S)");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), CAPABILITY_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Execution capability endpoint returned HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") || 0); if (Number.isFinite(length) && length > MAX_CAPABILITY_BYTES) throw new Error("Execution capability response is too large");
    const raw = await response.text(); if (new TextEncoder().encode(raw).byteLength > MAX_CAPABILITY_BYTES) throw new Error("Execution capability response is too large");
    return validateCapability(raw ? JSON.parse(raw) : null);
  } catch (error) { if (error instanceof Error && error.name === "AbortError") throw new Error("Execution capability endpoint timed out"); throw error instanceof Error ? error : new Error("Execution capability endpoint failed"); }
  finally { clearTimeout(timeout); }
}

function metadataCapabilityUrls(agent: Record<string, unknown>) {
  const metadata = object(agent.metadata); const execution = object(metadata.execution);
  return [metadata.execution_capabilities_url, metadata.execution_capability_url, execution.execution_capabilities_url, execution.execution_capability_url, execution.capabilities_url, execution.capability_url]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim());
}

function capabilityUrlCandidates(base: string) {
  const clean = base.replace(/\/+$/, "");
  try {
    const parsed = new URL(clean);
    const path = parsed.pathname.replace(/\/+$/, "");
    if (/\/execution-capabilit(?:y|ies)$/.test(path)) return [clean];
    parsed.pathname = `${path}/execution-capabilities`;
    parsed.search = "";
    return [parsed.toString()];
  } catch {
    return [`${clean}/execution-capabilities`];
  }
}

async function loadCapability(supabase: ReturnType<typeof serverClient>, agent: Record<string, unknown>, chainJobId: string) {
  const { data: endpoints, error } = await supabase.from("agent_endpoints").select("endpoint_url,protocol,version,metadata").eq("agent_id", String(agent.id || "")).limit(20);
  if (error) throw new Error(error.message);
  const interop = await discoverUniversalAgentInterop(agent, endpoints || []);
  const explicitCapabilityUrls = metadataCapabilityUrls(agent);
  const capabilityOperation = pickOperation(interop, "capability");
  const registeredCapabilityUrls = (endpoints || []).flatMap((endpoint) => capabilityUrlCandidates(String(endpoint.endpoint_url || "")));
  const discoveredCapabilityUrls = capabilityOperation?.endpoint ? capabilityUrlCandidates(capabilityOperation.endpoint) : [];
  const candidates = [...new Set([...explicitCapabilityUrls, ...registeredCapabilityUrls, ...discoveredCapabilityUrls].filter(Boolean))];
  const failures: string[] = [];
  for (const base of candidates) {
    try {
      const url = new URL(base);
      url.searchParams.set("job_id", chainJobId);
      const resolvedUrl = url.toString();
      return { capability: await fetchCapability(resolvedUrl), endpointUrl: resolvedUrl, interop };
    } catch (error) {
      failures.push(`${base}: ${error instanceof Error ? error.message : "capability fetch failed"}`);
    }
  }
  const executionOperation = pickOperation(interop, "execute");
  const documentedAsAltana = executionOperation && [executionOperation.protocol, executionOperation.name, executionOperation.description, executionOperation.evidence].filter(Boolean).join(" ").toLowerCase().includes("altana");
  if (executionOperation && documentedAsAltana) throw new Error(`Provider execution operation discovered at ${executionOperation.endpoint}, but no independently verifiable Altana execution-authorization document was exposed. ${failures.join(" | ")}`);
  return { capability: null, endpointUrl: null, interop, note: "No independently verifiable Altana execution-capability document is published for this provider. AgentMarket will not infer an execution-token requirement from a generic execute route." };
}

async function loadOwnedFundedJob(supabase: ReturnType<typeof serverClient>, jobId: string, userId: string, wallet: string | null) {
  const { data: job, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,client_wallet,chain_job_id,budget").eq("id", jobId).maybeSingle();
  if (jobError) throw new Error(jobError.message); if (!job) throw new Error("Job not found"); if (!job.mission_task_id) throw new Error("Job is not attached to a mission task");
  if (!wallet || String(job.client_wallet || "").toLowerCase() !== wallet.toLowerCase()) throw new Error("The authenticated wallet does not own this job");
  const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,mission_id,agent_id").eq("id", job.mission_task_id).maybeSingle();
  if (taskError) throw new Error(taskError.message); if (!task?.mission_id || !task.agent_id) throw new Error("Job does not identify a provider agent");
  const { data: mission, error: missionError } = await supabase.from("missions").select("id,user_id").eq("id", task.mission_id).maybeSingle();
  if (missionError) throw new Error(missionError.message); if (!mission || mission.user_id !== userId) throw new Error("You do not own this mission");
  const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,owner,metadata").eq("id", task.agent_id).maybeSingle();
  if (agentError) throw new Error(agentError.message); if (!agent) throw new Error("Provider agent not found"); if (!job.chain_job_id) throw new Error("The ERC-8183 chain job has not been created yet");
  const chainJob = await publicClient.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "getJob", args: [BigInt(job.chain_job_id)] });
  if (Number(chainJob.status) !== 1) throw new Error(`Execution authorization requires a funded job; live status is ${Number(chainJob.status)}`);
  if (String(chainJob.client).toLowerCase() !== wallet.toLowerCase()) throw new Error("The live ERC-8183 client is not the authenticated wallet");
  return { job, task, mission, agent, chainJob };
}

async function loadAuthorizationRecord(supabase: ReturnType<typeof serverClient>, jobId: string) {
  const { data, error } = await supabase.from("execution_capital_requests").select("*").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1);
  if (error) return { request: null, warning: "No AgentMarket execution-capital authorization record could be loaded." };
  return { request: data?.[0] || null, warning: null };
}
function getString(record: Record<string, unknown>, ...keys: string[]) { for (const key of keys) if (typeof record[key] === "string" && String(record[key]).trim()) return String(record[key]).trim(); return null; }
function storedCapabilityIsComplete(request: Record<string, unknown> | null) {
  const evidence = object(request?.evidence); const capability = object(evidence.execution_capability);
  return address(capability.session_key_address) && typeof capability.session_key_public_key === "string" && capability.session_key_public_key.trim().length > 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
    const auth = await getAuthenticatedUser(req); if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    const jobId = typeof req.query?.job === "string" ? req.query.job.trim() : ""; if (!jobId) return res.status(400).json({ error: "job is required" });
    const supabase = serverClient(); const { job, agent, chainJob } = await loadOwnedFundedJob(supabase, jobId, auth.user.id, auth.user.wallet_address);
    const loaded = await loadCapability(supabase, agent as Record<string, unknown>, String(job.chain_job_id));
    const { capability, endpointUrl, interop } = loaded;
    const { request, warning } = await loadAuthorizationRecord(supabase, jobId);
    if (!capability) return res.status(200).json({ ok: true, required: false, network: "bsc-testnet", chain_id: 97, provider_agent_id: agent.agent_id, capability_source_url: endpointUrl, erc8183: { job_id: job.chain_job_id, status: Number(chainJob.status), client: chainJob.client, provider: chainJob.provider }, execution: null, wallet_provider: null, authorization_model: null, execution_capital: { status: "not_advertised", requested_amount: null, requested_amount_raw: null, token: null, symbol: null, detection_source: "published_agent_capabilities", warning: loaded.note || warning, discovered_operations: interop.operations.map((operation) => ({ kind: operation.kind, protocol: operation.protocol, endpoint: operation.endpoint, method: operation.method, name: operation.name, evidence: operation.evidence })) }, note: loaded.note || "No execution-token requirement was declared by the provider." });

    let effectiveRequest = request as Record<string, unknown> | null;
    if (effectiveRequest && effectiveRequest.status === "requested" && !storedCapabilityIsComplete(effectiveRequest)) {
      const evidence = object(effectiveRequest.evidence);
      const refreshedEvidence = {
        ...evidence,
        source: "provider_execution_capability",
        chain_id: 97,
        chain_job_id: Number(job.chain_job_id),
        provider_agent_id: agent.agent_id,
        execution_capability: {
          ...capability,
          source_url: endpointUrl,
          endpoint_id: "provider_operation",
          fetched_at: new Date().toISOString(),
          independently_authorized: false,
        },
      };
      const { data: refreshed, error: refreshError } = await supabase.from("execution_capital_requests").update({
        user_execution_wallet: address(capability.session_key_address) ? capability.session_key_address : effectiveRequest.user_execution_wallet,
        agent_session_key: capability.session_key_address,
        wallet_provider: capability.wallet_provider,
        authorization_model: capability.authorization_model,
        capital_token: address(capability.execution_market?.token_in) ? capability.execution_market?.token_in : effectiveRequest.capital_token,
        evidence: refreshedEvidence,
      }).eq("id", effectiveRequest.id).eq("status", "requested").select("*").single();
      if (!refreshError && refreshed) effectiveRequest = refreshed as Record<string, unknown>;
    }

    let sessionVerified = false; let sessionKeyId: Hex | null = null; let sessionExpiry: number | null = null; let executionWallet: Address | null = null;
    if (effectiveRequest) {
      const requestRecord = effectiveRequest; const key = getString(requestRecord, "session_key_id", "sessionKeyId"); executionWallet = address(requestRecord.user_execution_wallet) ? requestRecord.user_execution_wallet as Address : null; sessionExpiry = Number(requestRecord.session_expiry || requestRecord.sessionExpiry);
      if (key && /^0x[a-fA-F0-9]{64}$/.test(key) && executionWallet) { sessionKeyId = key as Hex; const now = Math.floor(Date.now() / 1000); sessionVerified = Boolean(sessionExpiry && sessionExpiry > now) && await publicClient.readContract({ address: process.env.ALTANA_KEYSTORE_ADDRESS as Address, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [executionWallet, sessionKeyId] }).catch(() => false); }
    }
    const market = capability.execution_market || {};
    const storedAmount = effectiveRequest ? getString(effectiveRequest, "requested_amount", "required_amount", "amount", "capital_requested") : null;
    const storedAmountRaw = effectiveRequest ? getString(effectiveRequest, "requested_amount_raw", "required_amount_raw", "amount_raw") : null;
    const storedToken = effectiveRequest && address(effectiveRequest.capital_token) ? effectiveRequest.capital_token as Address : address(market.token_in) ? market.token_in : null;
    return res.status(200).json({
      ok: true, required: true, network: "bsc-testnet", chain_id: 97, provider_agent_id: agent.agent_id, capability_source_url: endpointUrl,
      erc8183: { job_id: job.chain_job_id, status: Number(chainJob.status), client: chainJob.client, provider: chainJob.provider }, execution: capability.execution, wallet_provider: capability.wallet_provider, authorization_model: capability.authorization_model,
      authorization: { source: "altana_keystore_session", verified: sessionVerified, session_key_id: sessionKeyId, session_key_address: capability.session_key_address, session_key_public_key: capability.session_key_public_key, execution_wallet: executionWallet, expiry: sessionExpiry, allowed_targets: capability.allowed_targets, allowed_selectors: capability.allowed_selectors, selectors_required: capability.selectors_required, spend_limit: effectiveRequest ? effectiveRequest.spend_limit ?? effectiveRequest.capital_limit ?? null : null, note: "AgentMarket verifies Altana session authorization independently. ERC-8183 is the job/commerce layer. No Grid-specific capital-request format is required." },
      execution_market: { token_in: address(market.token_in) ? market.token_in : null, token_out: address(market.token_out) ? market.token_out : null, token_in_symbol: market.token_in_symbol || null, token_out_symbol: market.token_out_symbol || null, fee: Number.isInteger(Number(market.fee)) ? Number(market.fee) : null, protocol: capability.protocol || null },
      execution_capital: { status: sessionVerified ? "authorization_verified" : effectiveRequest ? "authorization_record_present" : "authorization_not_observed", requested_amount: storedAmount, requested_amount_raw: storedAmountRaw, token: storedToken, symbol: market.token_in_symbol || null, detection_source: "altana_session_authorization", exact_trade_amount: storedAmount ? "marketplace_recorded" : "not_observed", warning, discovered_operations: interop.operations.map((operation) => ({ kind: operation.kind, protocol: operation.protocol, endpoint: operation.endpoint, method: operation.method, name: operation.name, evidence: operation.evidence })), note: "Execution authorization is verified independently of the provider implementation. Quote and execution endpoints may differ and are discovered from registered/protocol-described services; no single AgentMarket endpoint is required." },
    });
  } catch (error) { const message = error instanceof Error ? error.message : "Unable to resolve execution authorization"; return res.status(409).json({ error: message }); }
}
