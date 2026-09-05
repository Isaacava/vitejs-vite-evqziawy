import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, encodeFunctionData, formatUnits, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const ROUTER = "0x6d948b47614dbfbbf97a5e3fd9b410deeab44f17" as Address;
const POLICY = "0xc4f85d602235e14a45fd1d9794c4092af762b1a6" as Address;
const CHAIN_ID = 97;
const JOB_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const ALTANA_SESSION_FALLBACK_SECONDS = 24 * 60 * 60;
const TESTNET_RPC_URL = "https://bsc-testnet-rpc.publicnode.com";
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

const client = createPublicClient({ chain: bscTestnet, transport: http(TESTNET_RPC_URL) });

function validAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function formatRaw(raw: bigint, decimals: number) {
  return formatUnits(raw, decimals);
}
function capabilityUrls(agent: Record<string, unknown>): string[] {
  const metadata = object(agent.metadata);
  const execution = object(metadata.execution);
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

async function discoverExecutionCapability(agent: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const supabase = serverClient();
  const { data: endpoints, error } = await supabase
    .from("agent_endpoints")
    .select("endpoint_url")
    .eq("agent_id", String(agent.id || ""))
    .limit(20);
  if (error) return null;

  const endpointDerived = (endpoints || [])
    .map((entry) => typeof entry.endpoint_url === "string" ? `${entry.endpoint_url.replace(/\/+$/, "")}/execution-capabilities` : "")
    .filter(Boolean);
  const candidates = [...new Set([...capabilityUrls(agent), ...endpointDerived])];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { headers: { Accept: "application/json" } });
      if (!response.ok) continue;
      const raw = await response.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_CAPABILITY_BYTES) continue;
      const value = object(raw ? JSON.parse(raw) : null);
      const targets = Array.isArray(value.allowed_targets)
        ? value.allowed_targets.filter(validAddress)
        : [];
      const selectors = Array.isArray(value.allowed_selectors)
        ? value.allowed_selectors.filter((entry): entry is string => typeof entry === "string" && /^0x[a-fA-F0-9]{8}$/.test(entry))
        : [];
      if (
        value.execution !== "altana-scoped-session" ||
        String(value.wallet_provider || "").toLowerCase() !== "altana" ||
        String(value.authorization_model || "").toLowerCase() !== "scoped_session" ||
        String(value.network || "").toLowerCase() !== "bsc-testnet" ||
        Number(value.chain_id) !== CHAIN_ID ||
        targets.length === 0 ||
        selectors.length === 0
      ) continue;
      return { ...value, allowed_targets: targets, allowed_selectors: selectors, source_url: candidate };
    } catch {
      // Optional best-effort discovery: try the next provider-declared endpoint.
    }
  }
  return null;
}

function validActiveAltanaWallet(value: Record<string, unknown> | null): value is Record<string, unknown> & { wallet_address: Address } {
  return Boolean(
    value &&
    value.status === "active" &&
    Number(value.chain_id) === CHAIN_ID &&
    String(value.wallet_provider || "").toLowerCase() === "altana" &&
    String(value.authorization_model || "").toLowerCase() === "passkey" &&
    validAddress(value.wallet_address),
  );
}

async function livePolicy(): Promise<Address> {
  const allowed = await client.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "policyWhitelist", args: [POLICY] });
  if (!allowed) throw new Error(`Configured Testnet policy ${POLICY} is not whitelisted by EvaluatorRouter ${ROUTER}`);
  return POLICY;
}

async function bestEffortExecutionAuthorization(agent: Record<string, unknown>, userId: string): Promise<Record<string, unknown> | null> {
  try {
    const supabase = serverClient();
    const { data: executionWallet } = await supabase
      .from("altana_execution_wallets")
      .select("wallet_address,status,chain_id,wallet_provider,authorization_model")
      .eq("user_id", userId)
      .maybeSingle();
    if (!validActiveAltanaWallet(executionWallet as Record<string, unknown> | null)) return null;

    const capability = await discoverExecutionCapability(agent);
    if (!capability) return null;

    const now = Math.floor(Date.now() / 1000);
    const rawExpiry = Number(capability.session_expiry || 0);
    const expiry = Number.isSafeInteger(rawExpiry) && rawExpiry > now
      ? rawExpiry
      : now + ALTANA_SESSION_FALLBACK_SECONDS;

    return {
      version: 1,
      wallet_provider: "altana",
      authorization_model: "scoped_session",
      execution_wallet: executionWallet!.wallet_address,
      chain_id: CHAIN_ID,
      allowed_targets: capability.allowed_targets,
      allowed_selectors: capability.allowed_selectors,
      session_binding: "erc8183_job_id",
      session_expiry: expiry,
      ...(typeof capability.protocol === "string" && capability.protocol.trim() ? { protocol: capability.protocol.trim() } : {}),
      ...(typeof capability.preflight_path === "string" && capability.preflight_path.trim().startsWith("/") ? { preflight_path: capability.preflight_path.trim() } : {}),
      ...(capability.execution_market && typeof capability.execution_market === "object" ? { execution_market: capability.execution_market } : {}),
      capability_source_url: capability.source_url,
    };
  } catch {
    // Never make an ERC-8183 hire fail because Altana discovery is unavailable.
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  try {
    const quoteId = typeof req.body?.quote_id === "string" ? req.body.quote_id.trim() : "";
    const missionId = typeof req.body?.mission_id === "string" ? req.body.mission_id.trim() : "";
    const clientAddress = req.body?.client_address;
    if (!quoteId || !missionId || !validAddress(clientAddress)) return res.status(400).json({ error: "quote_id, mission_id and client_address are required" });
    if (clientAddress.toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "client_address does not match the authenticated wallet" });

    const supabase = serverClient();
    const { data: mission, error: missionError } = await supabase
      .from("missions")
      .select("id,user_id,goal,status")
      .eq("id", missionId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (missionError) throw new Error(missionError.message);
    if (!mission) return res.status(404).json({ error: "Mission not found" });

    const { data: quote, error: quoteError } = await supabase
      .from("marketplace_quotes")
      .select("quote_id,agent_id,requester_wallet,goal,request_metadata,price,currency,provider_quote,quote_hash,status,expires_at,chain_id,environment")
      .eq("quote_id", quoteId)
      .maybeSingle();
    if (quoteError) throw new Error(quoteError.message);
    if (!quote) return res.status(404).json({ error: "Quote not found" });
    if (quote.status !== "accepted") return res.status(409).json({ error: `Quote is ${quote.status}; accept it before preparing the job` });
    if (quote.chain_id !== CHAIN_ID || quote.environment !== "testnet") return res.status(409).json({ error: "Quote is not a BSC Testnet quote" });
    if (!quote.quote_hash) return res.status(409).json({ error: "Accepted quote is missing its integrity hash" });
    if (quote.requester_wallet.toLowerCase() !== clientAddress.toLowerCase()) return res.status(403).json({ error: "Quote belongs to another wallet" });
    if (new Date(quote.expires_at).getTime() <= Date.now()) return res.status(409).json({ error: "Accepted quote has expired" });

    const { data: task, error: taskError } = await supabase
      .from("mission_tasks")
      .select("id,agent_id")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task?.agent_id || task.agent_id !== quote.agent_id) return res.status(409).json({ error: "Accepted quote does not match the mission's selected agent" });

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id,agent_id,owner,name,status,verification_status,chain,metadata")
      .eq("id", task.agent_id)
      .maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent || agent.chain !== "bsc-testnet" || !validAddress(agent.owner)) return res.status(409).json({ error: "Selected provider is not a valid Testnet agent" });
    if (agent.verification_status === "revoked") return res.status(409).json({ error: "Selected provider identity is revoked" });

    const { data: endpoint, error: endpointError } = await supabase
      .from("agent_endpoints")
      .select("status,last_checked_at,endpoint_url,protocol")
      .eq("agent_id", agent.id)
      .order("last_checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (endpointError) throw new Error(endpointError.message);

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
    if (BigInt(balance) < rawBudget) return res.status(409).json({ error: `Insufficient Testnet settlement-token balance. Required ${formatRaw(rawBudget, Number(decimals))} ${symbol}.`, required_raw: rawBudget.toString(), balance_raw: String(balance) });

    const providerEndpoint = typeof endpoint?.endpoint_url === "string" && endpoint.endpoint_url.trim() ? endpoint.endpoint_url.trim() : null;
    const providerProtocol = typeof endpoint?.protocol === "string" && endpoint.protocol.trim() ? endpoint.protocol.trim() : null;
    const executionAuthorization = await bestEffortExecutionAuthorization(agent as Record<string, unknown>, auth.user.id);

    const descriptionPayload: Record<string, unknown> = {
      marketplace: "AgentMarket",
      network: "bsc-testnet",
      chain_id: CHAIN_ID,
      hiring_protocol: "erc-8183",
      mission_id: missionId,
      quote_id: quote.quote_id,
      quote_hash: quote.quote_hash,
      price: formatRaw(rawBudget, Number(decimals)),
      price_raw: rawBudget.toString(),
      currency: quote.currency,
      goal: quote.goal,
      params: quote.request_metadata,
      provider_endpoint: providerEndpoint,
      provider_protocol: providerProtocol,
      execution: {
        authorization_mode: executionAuthorization ? "job-scoped-altana" : "deferred",
        capability_discovery_before_hire_required: false,
      },
      ...(executionAuthorization ? { execution_authorization: executionAuthorization } : {}),
    };

    const description = JSON.stringify(descriptionPayload);
    const expiryUnix = Math.floor(Date.now() / 1000) + JOB_LIFETIME_SECONDS;
    const createJobData = encodeFunctionData({ abi: COMMERCE_ABI, functionName: "createJob", args: [agent.owner, ROUTER, BigInt(expiryUnix), description, ROUTER] });
    const registerTemplate = encodeFunctionData({ abi: ROUTER_ABI, functionName: "registerJob", args: [0n, policy] });

    const metadata = object(agent.metadata);
    const executionMetadata = object(metadata.execution);
    const altanaAdvertised = String(executionMetadata.wallet_provider || "").toLowerCase() === "altana";

    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: CHAIN_ID,
      environment: "testnet",
      mission: { id: mission.id, status: mission.status, goal: mission.goal },
      quote: {
        quote_id: quote.quote_id,
        price_raw: rawBudget.toString(),
        price: formatRaw(rawBudget, Number(decimals)),
        currency: quote.currency,
        quote_hash: quote.quote_hash,
        expires_at: quote.expires_at,
        status: quote.status,
      },
      agent: {
        agent_id: agent.agent_id,
        name: agent.name,
        provider: agent.owner,
        status: agent.status,
        verification_status: agent.verification_status,
      },
      commerce: { address: COMMERCE, evaluator: ROUTER, hook: ROUTER, default_policy: policy },
      payment: {
        token,
        symbol,
        decimals: Number(decimals),
        balance_raw: String(balance),
        allowance_raw: String(allowance),
        balance_formatted: formatRaw(BigInt(balance), Number(decimals)),
        allowance_formatted: formatRaw(BigInt(allowance), Number(decimals)),
        budget_raw: rawBudget.toString(),
      },
      execution: {
        wallet_address: executionAuthorization?.execution_wallet || null,
        wallet_provider: executionAuthorization ? "altana" : (altanaAdvertised ? "altana" : null),
        authorization_model: executionAuthorization ? "scoped_session" : null,
        chain_id: CHAIN_ID,
        authorization_in_job_context: Boolean(executionAuthorization),
        optional: true,
        provider_endpoint_online: endpoint?.status === "online",
      },
      job_description: description,
      wallet_steps: [
        "createJob",
        "registerJob with confirmed jobId",
        "setBudget with confirmed jobId and quoted budget",
        "approve payment token if allowance is insufficient",
        "fund with the same quoted budget",
      ],
      transactions: {
        create_job: { to: COMMERCE, data: createJobData },
        register_job: { to: ROUTER, data: registerTemplate, data_builder: `Replace placeholder jobId 0 with the confirmed createJob receipt jobId. Policy: ${policy}` },
        set_budget: { to: COMMERCE, data_builder: `encode setBudget(jobId, ${rawBudget.toString()}, 0x)` },
        approve: BigInt(allowance) < rawBudget
          ? { to: token, data_builder: `encode approve(${COMMERCE}, ${rawBudget.toString()})` }
          : { data_builder: "No approval transaction required; current allowance covers the accepted quote." },
        fund: { to: COMMERCE, data_builder: `encode fund(jobId, ${rawBudget.toString()}, 0x)` },
      },
      hiring: {
        open: true,
        protocol: "erc-8183",
        agent_blocker: false,
        execution_capability_discovery_required_before_hire: false,
        endpoint_health_required_before_hire: false,
        execution_authorization_embedded_when_available: Boolean(executionAuthorization),
      },
      note: executionAuthorization
        ? "AgentMarket created an open ERC-8183 hire and embedded the provider-declared Altana scoped authorization because it was available. Capability discovery was opportunistic, not a hiring gate."
        : "AgentMarket created an open ERC-8183 hire without blocking on Altana capability discovery. Execution authorization remains deferred until the provider can safely obtain the required job-scoped authorization.",
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to prepare the accepted Testnet quote" });
  }
}
