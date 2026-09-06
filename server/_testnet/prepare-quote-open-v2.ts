import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, encodeFunctionData, formatUnits, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const ROUTER = "0x6d948b47614dbfbbf97a5e3fd9b410deeab44f17" as Address;
const POLICY = "0xc4f85d602235e14a45fd1d9794c4092af762b1a6" as Address;
const CHAIN_ID = 97;
const JOB_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_SESSION_SECONDS = 24 * 60 * 60;
const MAX_CAPABILITY_BYTES = 64 * 1024;

const COMMERCE_ABI = [
  { type: "function", name: "createJob", stateMutability: "nonpayable", inputs: [
    { name: "provider", type: "address" }, { name: "evaluator", type: "address" },
    { name: "expiredAt", type: "uint256" }, { name: "description", type: "string" }, { name: "hook", type: "address" },
  ], outputs: [{ name: "jobId", type: "uint256" }] },
  { type: "function", name: "paymentToken", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;
const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;
const ROUTER_ABI = [
  { type: "function", name: "registerJob", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "policy", type: "address" }], outputs: [] },
  { type: "function", name: "policyWhitelist", stateMutability: "view", inputs: [{ name: "policy", type: "address" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const client = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });

type JsonRecord = Record<string, unknown>;

function validAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}
function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function capabilityUrls(agent: JsonRecord): string[] {
  const metadata = object(agent.metadata);
  const execution = object(metadata.execution);
  return [
    metadata.execution_capabilities_url,
    metadata.execution_capability_url,
    execution.execution_capabilities_url,
    execution.execution_capability_url,
    execution.capabilities_url,
    execution.capability_url,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim());
}
function endpointCandidates(agentEndpoints: JsonRecord[], agent: JsonRecord): string[] {
  return [...new Set([
    ...capabilityUrls(agent),
    ...agentEndpoints.map((entry) => {
      const endpoint = text(entry.endpoint_url);
      return endpoint ? `${endpoint.replace(/\/+$/, "")}/execution-capabilities` : "";
    }).filter(Boolean),
  ])];
}

async function discoverExecutionCapability(agent: JsonRecord, endpoints: JsonRecord[], chainJobId?: number): Promise<JsonRecord | null> {
  for (const candidate of endpointCandidates(endpoints, agent)) {
    for (const withJobId of [false, true]) {
      try {
        const url = new URL(candidate);
        if (withJobId && Number(chainJobId || 0) > 0) url.searchParams.set("job_id", String(chainJobId));
        if (withJobId && Number(chainJobId || 0) <= 0) continue;
        const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
        if (!response.ok) continue;
        const raw = await response.text();
        if (new TextEncoder().encode(raw).byteLength > MAX_CAPABILITY_BYTES) continue;
        const value = object(raw ? JSON.parse(raw) : null);
        if (String(value.network || "").toLowerCase() !== "bsc-testnet" || Number(value.chain_id ?? value.chainId) !== CHAIN_ID) continue;
        return { ...value, source_url: url.toString() };
      } catch {
        // Try the next provider-declared capability endpoint.
      }
    }
  }
  return null;
}

function executionContract(agent: JsonRecord, capability: JsonRecord | null) {
  const metadata = object(agent.metadata);
  const metadataExecution = object(metadata.execution);
  const capabilityExecution = object(capability?.execution);
  const walletProvider = text(capability?.wallet_provider) || text(metadataExecution.wallet_provider);
  const authorizationModel = text(capability?.authorization_model) || text(metadataExecution.authorization_model);
  const stateChanging = capability?.state_changing === true || capability?.stateChanging === true || metadataExecution.state_changing === true || metadataExecution.stateChanging === true;
  const userApprovalRequired = capability?.user_approval_required === true || capability?.userApprovalRequired === true || metadataExecution.user_approval_required === true || metadataExecution.userApprovalRequired === true;
  const execution = text(capability?.execution) || text(metadataExecution.mode) || text(metadataExecution.execution);
  return { walletProvider, authorizationModel, stateChanging, userApprovalRequired, execution, capabilityExecution };
}

function validActiveAltanaWallet(value: JsonRecord | null): value is JsonRecord & { wallet_address: Address } {
  return Boolean(value && value.status === "active" && Number(value.chain_id) === CHAIN_ID && text(value.wallet_provider).toLowerCase() === "altana" && text(value.authorization_model).toLowerCase() === "passkey" && validAddress(value.wallet_address));
}

async function loadExecutionBinding(agent: JsonRecord, endpoints: JsonRecord[], userId: string, chainJobId: number): Promise<JsonRecord | null> {
  const capability = await discoverExecutionCapability(agent, endpoints, chainJobId);
  const contract = executionContract(agent, capability);
  const requiresUserApproval = contract.userApprovalRequired || contract.authorizationModel === "scoped_session" || contract.stateChanging;
  if (!requiresUserApproval) return capability;

  if (contract.walletProvider.toLowerCase() !== "altana") {
    if (capability) return capability;
    if (contract.stateChanging || contract.userApprovalRequired) {
      throw new Error(`${text(agent.name) || text(agent.agent_id) || "Provider"} declares state-changing execution, but no provider authorization document is available before job creation.`);
    }
    return null;
  }

  const supabase = serverClient();
  const { data: executionWallet, error } = await supabase
    .from("altana_execution_wallets")
    .select("wallet_address,status,chain_id,wallet_provider,authorization_model")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!capability) {
    throw new Error("This provider requires Altana execution authorization, but its provider-declared execution capability could not be verified before creating the ERC-8183 job.");
  }

  const now = Math.floor(Date.now() / 1000);
  const rawExpiry = Number(capability.session_expiry || 0);
  const sessionExpiry = Number.isSafeInteger(rawExpiry) && rawExpiry > now ? rawExpiry : now + DEFAULT_SESSION_SECONDS;
  const walletIsActive = validActiveAltanaWallet(executionWallet as JsonRecord | null);
  if (!walletIsActive) {
    return {
      version: 1,
      wallet_provider: "altana",
      authorization_model: "scoped_session",
      execution_wallet: null,
      wallet_status: "not_provisioned",
      authorization_pending: true,
      chain_id: CHAIN_ID,
      allowed_targets: Array.isArray(capability.allowed_targets) ? capability.allowed_targets : [],
      allowed_selectors: Array.isArray(capability.allowed_selectors) ? capability.allowed_selectors : [],
      session_binding: "erc8183_job_id",
      session_expiry: sessionExpiry,
      ...(text(capability.protocol) ? { protocol: text(capability.protocol).toLowerCase() } : {}),
      ...(text(capability.preflight_path).startsWith("/") ? { preflight_path: text(capability.preflight_path) } : {}),
      ...(capability.execution_market && typeof capability.execution_market === "object" ? { execution_market: capability.execution_market } : {}),
      capability_source_url: text(capability.source_url),
    };
  }

  return {
    version: 1,
    wallet_provider: "altana",
    authorization_model: "scoped_session",
    execution_wallet: executionWallet.wallet_address,
    chain_id: CHAIN_ID,
    allowed_targets: Array.isArray(capability.allowed_targets) ? capability.allowed_targets : [],
    allowed_selectors: Array.isArray(capability.allowed_selectors) ? capability.allowed_selectors : [],
    session_binding: "erc8183_job_id",
    session_expiry: sessionExpiry,
    ...(text(capability.protocol) ? { protocol: text(capability.protocol).toLowerCase() } : {}),
    ...(text(capability.preflight_path).startsWith("/") ? { preflight_path: text(capability.preflight_path) } : {}),
    ...(capability.execution_market && typeof capability.execution_market === "object" ? { execution_market: capability.execution_market } : {}),
    capability_source_url: text(capability.source_url),
  };
}

async function livePolicy(): Promise<Address> {
  const allowed = await client.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "policyWhitelist", args: [POLICY] });
  if (!allowed) throw new Error(`Configured Testnet policy ${POLICY} is not whitelisted by EvaluatorRouter ${ROUTER}`);
  return POLICY;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  try {
    const quoteId = text(req.body?.quote_id);
    const missionId = text(req.body?.mission_id);
    const clientAddress = req.body?.client_address;
    if (!quoteId || !missionId || !validAddress(clientAddress)) return res.status(400).json({ error: "quote_id, mission_id and client_address are required" });
    if (clientAddress.toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "client_address does not match the authenticated wallet" });

    const supabase = serverClient();
    const { data: mission, error: missionError } = await supabase.from("missions").select("id,user_id,goal,status").eq("id", missionId).eq("user_id", auth.user.id).maybeSingle();
    if (missionError) throw new Error(missionError.message);
    if (!mission) return res.status(404).json({ error: "Mission not found" });

    const { data: quote, error: quoteError } = await supabase.from("marketplace_quotes").select("quote_id,agent_id,requester_wallet,goal,request_metadata,price,currency,quote_hash,status,expires_at,chain_id,environment").eq("quote_id", quoteId).maybeSingle();
    if (quoteError) throw new Error(quoteError.message);
    if (!quote) return res.status(404).json({ error: "Quote not found" });
    if (quote.status !== "accepted") return res.status(409).json({ error: `Quote is ${quote.status}; accept it before preparing the job` });
    if (quote.chain_id !== CHAIN_ID || quote.environment !== "testnet") return res.status(409).json({ error: "Quote is not a BSC Testnet quote" });
    if (!quote.quote_hash) return res.status(409).json({ error: "Accepted quote is missing its integrity hash" });
    if (String(quote.requester_wallet).toLowerCase() !== clientAddress.toLowerCase()) return res.status(403).json({ error: "Quote belongs to another wallet" });
    if (new Date(quote.expires_at).getTime() <= Date.now()) return res.status(409).json({ error: "Accepted quote has expired" });

    const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,agent_id").eq("mission_id", missionId).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task?.agent_id || task.agent_id !== quote.agent_id) return res.status(409).json({ error: "Accepted quote does not match the mission's selected agent" });

    const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,owner,name,status,verification_status,chain,metadata").eq("id", task.agent_id).maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent || agent.chain !== "bsc-testnet" || !validAddress(agent.owner)) return res.status(409).json({ error: "Selected provider is not a valid Testnet agent" });
    if (agent.verification_status === "revoked") return res.status(409).json({ error: "Selected provider identity is revoked" });

    const { data: endpointRows, error: endpointError } = await supabase.from("agent_endpoints").select("endpoint_url,protocol,status,metadata").eq("agent_id", agent.id).order("last_checked_at", { ascending: false }).limit(20);
    if (endpointError) throw new Error(endpointError.message);
    const endpoints = (endpointRows || []) as JsonRecord[];

    const token = await client.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "paymentToken" });
    const [decimals, symbol, balance, allowance, policy] = await Promise.all([
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [clientAddress] }),
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [clientAddress, COMMERCE] }),
      livePolicy(),
    ]);

    const rawBudget = BigInt(String(quote.price));
    if (rawBudget <= 0n) return res.status(409).json({ error: "Accepted provider quote has a non-positive price" });
    if (BigInt(balance) < rawBudget) return res.status(409).json({ error: `Insufficient Testnet settlement-token balance. Required ${formatUnits(rawBudget, Number(decimals))} ${symbol}.`, required_raw: rawBudget.toString(), balance_raw: String(balance) });

    const executionBinding = await loadExecutionBinding(agent as JsonRecord, endpoints, auth.user.id, 0);
    const providerEndpoint = text(endpoints[0]?.endpoint_url) || null;
    const providerProtocol = text(endpoints[0]?.protocol) || null;
    const metadata = object(agent.metadata);
    const executionMetadata = object(metadata.execution);
    const capability = executionBinding && Array.isArray(executionBinding.allowed_targets) ? executionBinding : null;
    const executionRequired = executionMetadata.state_changing === true || executionMetadata.stateChanging === true || executionMetadata.user_approval_required === true || executionMetadata.userApprovalRequired === true || Boolean(capability);
    const walletProvider = text(executionBinding?.wallet_provider) || text(capability?.wallet_provider) || text(executionMetadata.wallet_provider);
    const authorizationModel = text(executionBinding?.authorization_model) || text(capability?.authorization_model) || text(executionMetadata.authorization_model);

    const descriptionPayload: JsonRecord = {
      marketplace: "AgentMarket",
      network: "bsc-testnet",
      chain_id: CHAIN_ID,
      hiring_protocol: "erc-8183",
      mission_id: missionId,
      quote_id: quote.quote_id,
      quote_hash: quote.quote_hash,
      price: formatUnits(rawBudget, Number(decimals)),
      price_raw: rawBudget.toString(),
      currency: quote.currency,
      goal: quote.goal,
      params: quote.request_metadata,
      provider_endpoint: providerEndpoint,
      provider_protocol: providerProtocol,
      execution: {
        required: executionRequired,
        authorization_mode: authorizationModel || (executionRequired ? "provider-declared" : "none"),
        wallet_provider: walletProvider || null,
        capability_discovery_before_hire_required: executionRequired,
      },
      ...(executionBinding ? { execution_authorization: executionBinding } : {}),
    };

    const description = JSON.stringify(descriptionPayload);
    const expiryUnix = Math.floor(Date.now() / 1000) + JOB_LIFETIME_SECONDS;
    const createJobData = encodeFunctionData({ abi: COMMERCE_ABI, functionName: "createJob", args: [agent.owner, ROUTER, BigInt(expiryUnix), description, ROUTER] });
    const registerTemplate = encodeFunctionData({ abi: ROUTER_ABI, functionName: "registerJob", args: [0n, policy] });

    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: CHAIN_ID,
      environment: "testnet",
      mission: { id: mission.id, status: mission.status, goal: mission.goal },
      quote: { quote_id: quote.quote_id, price_raw: rawBudget.toString(), price: formatUnits(rawBudget, Number(decimals)), currency: quote.currency, quote_hash: quote.quote_hash, expires_at: quote.expires_at, status: quote.status },
      agent: { agent_id: agent.agent_id, name: agent.name, provider: agent.owner, status: agent.status, verification_status: agent.verification_status },
      commerce: { address: COMMERCE, evaluator: ROUTER, hook: ROUTER, default_policy: policy },
      payment: { token, symbol, decimals: Number(decimals), balance_raw: String(balance), allowance_raw: String(allowance), balance_formatted: formatUnits(BigInt(balance), Number(decimals)), allowance_formatted: formatUnits(BigInt(allowance), Number(decimals)), budget_raw: rawBudget.toString() },
      execution: {
        wallet_address: executionBinding?.execution_wallet || null,
        wallet_provider: walletProvider || null,
        authorization_model: authorizationModel || null,
        chain_id: CHAIN_ID,
        authorization_in_job_context: Boolean(executionBinding?.execution_wallet),
        authorization_pending: executionBinding?.authorization_pending === true,
        required: executionRequired,
        provider_endpoint_online: endpoints[0]?.status === "online",
        capability_source_url: text(executionBinding?.capability_source_url) || null,
        protocol: text(executionBinding?.protocol) || text(capability?.protocol) || null,
        preflight_path: text(executionBinding?.preflight_path) || text(capability?.preflight_path) || null,
      },
      job_description: description,
      wallet_steps: ["createJob", "registerJob with confirmed jobId", "setBudget with confirmed jobId and quoted budget", "approve payment token if allowance is insufficient", "fund with the same quoted budget"],
      transactions: {
        create_job: { to: COMMERCE, data: createJobData },
        register_job: { to: ROUTER, data: registerTemplate, data_builder: `Replace placeholder jobId 0 with the confirmed createJob receipt jobId. Policy: ${policy}` },
        set_budget: { to: COMMERCE, data_builder: `encode setBudget(jobId, ${rawBudget.toString()}, 0x)` },
        approve: BigInt(allowance) < rawBudget ? { to: token, data_builder: `encode approve(${COMMERCE}, ${rawBudget.toString()})` } : { data_builder: "No approval transaction required; current allowance covers the accepted quote." },
        fund: { to: COMMERCE, data_builder: `encode fund(jobId, ${rawBudget.toString()}, 0x)` },
      },
      hiring: {
        open: true,
        protocol: "erc-8183",
        agent_blocker: false,
        execution_capability_discovery_required_before_hire: executionRequired,
        execution_authorization_embedded: Boolean(executionBinding?.execution_wallet),
        execution_authorization_pending: executionBinding?.authorization_pending === true,
      },
      note: executionBinding?.execution_wallet
        ? "AgentMarket created an open ERC-8183 hire and embedded the provider-declared execution authorization before job creation."
        : executionBinding?.authorization_pending
          ? "AgentMarket created an open ERC-8183 hire. Provider-declared execution authorization is pending until the buyer provisions an active Altana execution wallet."
          : executionRequired
            ? "Provider-declared execution is required, but authorization remains provider-controlled and must be established before execution can begin."
            : "AgentMarket created an open ERC-8183 hire using only the provider-declared task contract; no execution-capital semantics were imposed.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare the accepted Testnet quote";
    return res.status(message.includes("must be provisioned") || message.includes("no provider authorization") ? 409 : 400).json({ error: message });
  }
}
