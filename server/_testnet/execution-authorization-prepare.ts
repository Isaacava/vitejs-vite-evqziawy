import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const COMMERCE_ABI = [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" }] }], }] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });
const MAX_CAPABILITY_BYTES = 64 * 1024;
function address(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function hex(value: unknown): value is Hex { return typeof value === "string" && /^0x[a-fA-F0-9]*$/.test(value); }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function normalizeUrl(value: unknown): string | null { if (typeof value !== "string" || !value.trim()) return null; try { const url = new URL(value.trim()); url.hash = ""; return url.toString().replace(/\/$/, ""); } catch { return null; } }
function capabilityUrls(agent: Record<string, unknown>): string[] {
  const metadata = object(agent.metadata), execution = object(metadata.execution);
  const declared = [
    metadata.execution_capabilities_url,
    metadata.execution_capability_url,
    execution.execution_capabilities_url,
    execution.execution_capability_url,
    execution.capabilities_url,
    execution.capability_url,
  ];
  const endpoints = Array.isArray(agent.__endpoint_urls) ? agent.__endpoint_urls : [];
  const generated = endpoints.flatMap((value) => {
    const base = normalizeUrl(value);
    if (!base) return [];
    const candidates = new Set<string>();
    candidates.add(`${base}/execution-capabilities`);
    candidates.add(`${base}/erc8183/execution-capabilities`);
    if (base.endsWith("/erc8183")) candidates.add(`${base}/execution-capabilities`);
    return [...candidates];
  });
  return [...new Set([...declared.map(normalizeUrl).filter((value): value is string => Boolean(value)), ...generated])];
}
function unwrapCapability(value: Record<string, unknown>): Record<string, unknown> {
  const nested = [value.capability, value.execution_capability, value.execution_capabilities].map(object);
  for (const candidate of nested) {
    if (Object.keys(candidate).length) return candidate;
  }
  return value;
}
async function capability(agent: Record<string, unknown>): Promise<{ descriptor: Record<string, unknown>; source_url: string; capital_token: Address } | null> {
  const { data: endpoints, error } = await serverClient().from("agent_endpoints").select("endpoint_url").eq("agent_id", String(agent.id || "")).limit(20);
  if (error) throw new Error(error.message);
  const agentWithEndpoints = { ...agent, __endpoint_urls: (endpoints || []).map((e) => e.endpoint_url) };
  const candidates = capabilityUrls(agentWithEndpoints);
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { headers: { Accept: "application/json" } });
      if (!response.ok) continue;
      const raw = await response.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_CAPABILITY_BYTES) continue;
      const value = unwrapCapability(object(raw ? JSON.parse(raw) : null));
      const market = object(value.execution_market);
      const marketToken = market.token_in;
      const spendToken = value.spend_token;
      const token = address(marketToken) ? marketToken : address(spendToken) ? spendToken : null;
      const chainId = Number(value.chainId ?? value.chain_id);
      if (value.network !== "bsc-testnet" || chainId !== 97 || value.execution !== "altana-scoped-session" || value.wallet_provider !== "altana" || value.authorization_model !== "scoped_session" || value.private_key_exposed !== false || !address(value.session_key_address) || !hex(value.session_key_public_key) || value.session_key_public_key.length < 4 || !Array.isArray(value.allowed_targets) || !Array.isArray(value.allowed_selectors) || !value.allowed_targets.length || !value.allowed_selectors.length || !token) continue;
      if (!value.allowed_targets.every(address) || !value.allowed_selectors.every(hex)) continue;
      return { descriptor: value, source_url: candidate, capital_token: token };
    } catch { /* Try every declared and convention-based capability endpoint. */ }
  }
  return null;
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    const jobId = typeof req.body?.job_id === "string" ? req.body.job_id.trim() : "", chainJobId = String(req.body?.chain_job_id ?? "").trim();
    const purpose = typeof req.body?.purpose === "string" && req.body.purpose.trim() ? req.body.purpose.trim() : "Agent execution", duration = Number(req.body?.duration_seconds ?? 86400), amount = Number(req.body?.capital_requested ?? 1);
    if (!jobId || !/^\d+$/.test(chainJobId) || amount !== 1 || !Number.isInteger(duration) || duration < 300 || duration > 604800) return res.status(400).json({ error: "job_id, chain_job_id, exactly 1 U, and a valid duration are required" });
    const supabase = serverClient();
    const { data: job, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,client_wallet,chain_job_id").eq("id", jobId).maybeSingle();
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
    const cap = await capability(agent as Record<string, unknown>);
    if (!cap) return res.status(200).json({ ok: true, required: false, created: false, chain_job_id: Number(chainJobId), note: "Provider does not currently advertise a verified execution-authorization capability." });
    const market = object(cap.descriptor.execution_market);
    const { data: existing, error: existingError } = await supabase.from("execution_capital_requests").select("*").eq("job_id", job.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) return res.status(200).json({ ok: true, required: true, created: false, request: existing, chain_job_id: Number(chainJobId) });
    const fetchedAt = new Date().toISOString();
    const { data: request, error: insertError } = await supabase.from("execution_capital_requests").insert({
      job_id: job.id,
      requester_wallet: auth.user.wallet_address,
      user_execution_wallet: null,
      agent_session_key: cap.descriptor.session_key_address,
      capital_requested: "1",
      capital_token: cap.capital_token,
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
        execution_capability: { ...cap.descriptor, execution_market: { ...market, token_in: cap.capital_token }, source_url: cap.source_url, fetched_at: fetchedAt, independently_authorized: false },
      },
    }).select("*").single();
    if (insertError) throw new Error(insertError.message);
    return res.status(201).json({ ok: true, required: true, created: true, request, chain_job_id: Number(chainJobId) });
  } catch (error) {
    return res.status(409).json({ ok: false, error: error instanceof Error ? error.message : "Unable to prepare execution authorization" });
  }
}
