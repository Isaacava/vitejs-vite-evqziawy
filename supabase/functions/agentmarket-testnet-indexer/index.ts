import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createPublicClient, http } from "npm:viem";
import { bscTestnet } from "npm:viem/chains";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_TOKEN = Deno.env.get("AGENTMARKET_SUPABASE_CRON_TOKEN") || "am-supabase-worker-97-v1";
const RPC_URL = Deno.env.get("BSC_TESTNET_RPC_URL") || "https://bsc-testnet-rpc.publicnode.com";
const EIGHT004SCAN_BASE = "https://api.8004scan.io/api/v1";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const client = createPublicClient({ chain: bscTestnet, transport: http(RPC_URL) });

const REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as `0x${string}`;
const NETWORK = "bsc-testnet";
const CHAIN_ID = 97;
const AGENT_BLOCKS_PER_RUN = BigInt(Math.max(100, Number(Deno.env.get("ERC8004_INDEX_BLOCKS_PER_RUN") || "5000")));
const EIGHT004SCAN_PAGES = Math.max(1, Math.min(5, Number(Deno.env.get("EIGHT004SCAN_TESTNET_PAGES") || "2")));
const EIGHT004SCAN_PAGE_SIZE = Math.max(10, Math.min(100, Number(Deno.env.get("EIGHT004SCAN_TESTNET_PAGE_SIZE") || "100")));
const MAX_URI_BYTES = 512_000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const TRANSFER_ABI = [{ type: "event", name: "Transfer", anonymous: false, inputs: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "tokenId", type: "uint256", indexed: true }] }] as const;
const OWNER_OF_ABI = [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] }] as const;
const TOKEN_URI_ABI = [{ type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "string" }] }] as const;

type JsonRecord = Record<string, unknown>;
type RegistrationFile = { name?: string; description?: string; image?: string; category?: string; capabilities?: unknown; skills?: unknown; services?: unknown; endpoints?: unknown; metadata?: JsonRecord };
type Endpoint = { url: string; protocol: string; version?: string; metadata?: JsonRecord };

type ExternalAgent = { agentId: string; owner: string | null; uri: string | null; name: string | null; description: string | null; image: string | null; category: string; services: unknown[]; registrations: unknown[]; reputationScore: number | null; feedbackCount: number | null; raw: JsonRecord };

function record(value: unknown): JsonRecord { return value && typeof value === "object" ? value as JsonRecord : {}; }
function cleanString(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function numberValue(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) ? n : null; }
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    const r = record(item);
    return [r.name, r.id, r.capability, r.skill, r.description].filter((v): v is string => typeof v === "string");
  });
}
function inferCategory(registration: RegistrationFile, extraText = "") {
  if (cleanString(registration.category)) return cleanString(registration.category);
  const text = `${registration.name || ""} ${registration.description || ""} ${strings(registration.capabilities).join(" ")} ${strings(registration.skills).join(" ")} ${extraText}`.toLowerCase();
  if (/grid/.test(text)) return "grid_trading";
  if (/yield|apy|staking|farming|vault|liquidity mining|auto.?compound|lending pool/.test(text)) return "yield";
  if (/risk|health factor|liquidation|collateral|ltv|loan monitor|margin call/.test(text)) return "health_factor";
  if (/rebalance|rebalancing|portfolio|asset allocation|reallocation/.test(text)) return "rebalancing";
  return "other";
}
function normalizeIpfs(uri: string) {
  if (!uri.startsWith("ipfs://")) return uri;
  const gateway = (Deno.env.get("IPFS_GATEWAY_URL") || "https://ipfs.io/ipfs/").replace(/\/$/, "");
  return `${gateway}/${uri.slice(7)}`;
}
async function resolveRegistration(uri: string): Promise<RegistrationFile> {
  if (uri.startsWith("data:")) {
    const comma = uri.indexOf(",");
    if (comma < 0) throw new Error("invalid data URI");
    const header = uri.slice(0, comma);
    const payload = uri.slice(comma + 1);
    const bytes = header.includes(";base64") ? Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(payload));
    if (bytes.byteLength > MAX_URI_BYTES) throw new Error("registration file exceeds size limit");
    return JSON.parse(new TextDecoder().decode(bytes)) as RegistrationFile;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(normalizeIpfs(uri), { signal: controller.signal, headers: { accept: "application/json,text/plain;q=0.9,*/*;q=0.8" } });
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_URI_BYTES) throw new Error("registration file exceeds size limit");
    if (!response.ok) throw new Error(`registration HTTP ${response.status}`);
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_URI_BYTES) throw new Error("registration file exceeds size limit");
    return JSON.parse(text) as RegistrationFile;
  } finally { clearTimeout(timer); }
}

function protocolFromService(value: JsonRecord) {
  const explicit = cleanString(value.protocol || value.transport || value.type || value.protocol_version);
  if (explicit) return explicit.toLowerCase();
  const name = cleanString(value.name || value.id || value.capability || value.skill).toLowerCase();
  if (/erc.?8183/.test(name)) return "erc8183";
  if (/a2a|agent.?card/.test(name)) return "a2a";
  if (/mcp|model.?context/.test(name)) return "mcp";
  if (/health|status/.test(name)) return "http-health";
  return "http";
}

function extractEndpoints(registration: RegistrationFile): Endpoint[] {
  const objects = [registration.services, registration.endpoints].flatMap((value) => Array.isArray(value) ? value : []);
  const result: Endpoint[] = [];
  for (const item of objects) {
    const r = record(item);
    const url = [r.serviceEndpoint, r.endpoint, r.url, r.uri].find((v): v is string => typeof v === "string" && /^https?:\/\//i.test(v));
    if (!url) continue;
    result.push({ url, protocol: protocolFromService(r), ...(cleanString(r.version) ? { version: cleanString(r.version) } : {}), metadata: r });
  }
  for (const value of strings(registration.services)) if (/^https?:\/\//i.test(value)) result.push({ url: value, protocol: "http" });
  for (const value of strings(registration.endpoints)) if (/^https?:\/\//i.test(value)) result.push({ url: value, protocol: "http" });
  return [...new Map(result.map((e) => [`${e.protocol}:${e.url}`, e])).values()];
}

function unwrapList(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.map(record);
  const root = record(value);
  for (const key of ["agents", "items", "results", "data"]) {
    const nested = root[key];
    if (Array.isArray(nested)) return nested.map(record);
    if (nested && typeof nested === "object") {
      const n = record(nested);
      for (const child of ["agents", "items", "results"]) if (Array.isArray(n[child])) return (n[child] as unknown[]).map(record);
    }
  }
  return [];
}
function isBscTestnetAgent(a: JsonRecord) {
  const chain = record(a.chain);
  const chainId = numberValue(a.chainId ?? a.chain_id ?? chain.chainId ?? chain.chain_id);
  if (chainId === CHAIN_ID) return true;
  const registrations = Array.isArray(a.registrations) ? a.registrations : [];
  return registrations.some((entry) => cleanString(record(entry).agentRegistry).toLowerCase().includes(`eip155:${CHAIN_ID}:`));
}
function normalize8004(a: JsonRecord): ExternalAgent | null {
  if (!isBscTestnetAgent(a)) return null;
  const registrations = Array.isArray(a.registrations) ? a.registrations : [];
  const services = Array.isArray(a.services) ? a.services : [];
  const agentId = cleanString(a.agent_id ?? a.agentId ?? a.tokenId ?? a.id);
  if (!agentId) return null;
  const category = inferCategory({ name: cleanString(a.name), description: cleanString(a.description), capabilities: a.capabilities, skills: a.skills, services });
  return { agentId, owner: cleanString(a.owner ?? a.owner_address ?? a.ownerAddress) || null, uri: cleanString(a.agentURI ?? a.agent_uri ?? a.uri) || null, name: cleanString(a.name) || null, description: cleanString(a.description) || null, image: cleanString(a.image) || null, category, services, registrations, reputationScore: numberValue(a.reputationScore ?? a.reputation_score ?? a.score), feedbackCount: numberValue(a.feedbackCount ?? a.feedback_count ?? a.feedbacks), raw: a };
}

function mergeRegistrationServices(registration: RegistrationFile, services: unknown[]): RegistrationFile {
  const existingServices = Array.isArray(registration.services) ? registration.services : [];
  return {
    ...registration,
    services: [...existingServices, ...services],
  };
}

async function upsertAgent(input: { agentId: string; owner: string | null; uri: string | null; name?: string | null; description?: string | null; image?: string | null; category?: string; source: string; metadata?: JsonRecord; registration?: RegistrationFile }) {
  const now = new Date().toISOString();
  const { data: existing, error } = await supabase
    .from("agents")
    .select("id,metadata,is_first_party,source,category,indexed_at")
    .eq("agent_id", input.agentId)
    .eq("chain", NETWORK)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (existing?.is_first_party) return { skippedFirstParty: true, id: existing.id };
  const registration = input.registration || {};
  const capabilityStrings = [...new Set([input.category || inferCategory(registration), ...strings(registration.capabilities), ...strings(registration.skills), ...strings(registration.services)].map((v) => v.trim()).filter(Boolean))];
  const row: Record<string, unknown> = {
    agent_id: input.agentId,
    owner: input.owner || null,
    uri: input.uri || "",
    name: input.name || null,
    description: input.description || null,
    image: input.image || null,
    chain: NETWORK,
    category: input.category || inferCategory(registration),
    source: existing?.source && existing.source !== "indexed" ? existing.source : "indexed",
    status: "unknown",
    is_first_party: false,
    indexed_at: existing?.indexed_at || now,
    last_indexed_at: now,
    metadata: { ...(existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {}), ...(input.metadata || {}), indexer: "agentmarket-testnet-indexer", network: NETWORK, chain_id: CHAIN_ID, last_source: input.source, last_indexed_at: now, ...(Object.keys(registration).length ? { registration } : {}) },
  };
  if (!existing || existing.source === "indexed") row.verification_status = "indexed";
  let dbId: string;
  if (existing) {
    const { data, error: updateError } = await supabase.from("agents").update(row).eq("id", existing.id).select("id").single();
    if (updateError) throw new Error(updateError.message);
    dbId = data.id;
  } else {
    const { data, error: insertError } = await supabase.from("agents").insert(row).select("id").single();
    if (insertError) throw new Error(insertError.message);
    dbId = data.id;
  }
  for (const capability of capabilityStrings) {
    const { error: capabilityError } = await supabase.from("agent_capabilities").upsert({ agent_id: dbId, capability, source: input.source === "8004scan" ? "8004scan" : "registration", confidence: capability === (input.category || inferCategory(registration)) ? 1 : 0.8, metadata: { network: NETWORK, chain_id: CHAIN_ID }, updated_at: now }, { onConflict: "agent_id,capability,source" });
    if (capabilityError) throw new Error(capabilityError.message);
  }
  for (const endpoint of extractEndpoints(registration)) {
    const { error: endpointError } = await supabase.from("agent_endpoints").upsert({ agent_id: dbId, endpoint_url: endpoint.url, protocol: endpoint.protocol, version: endpoint.version || null, status: "unknown", metadata: { ...(endpoint.metadata || {}), network: NETWORK, chain_id: CHAIN_ID }, updated_at: now }, { onConflict: "agent_id,endpoint_url,protocol" });
    if (endpointError) throw new Error(endpointError.message);
  }
  return { skippedFirstParty: false, id: dbId, capabilities: capabilityStrings.length };
}

async function enrichExternalAgent(agent: ExternalAgent) {
  let registration: RegistrationFile = {};
  if (agent.uri) {
    try { registration = await resolveRegistration(agent.uri); } catch (error) { registration = { metadata: { resolution_error: error instanceof Error ? error.message : String(error) } }; }
  }
  const merged = mergeRegistrationServices(registration, agent.services);
  const inferred = inferCategory(merged, `${agent.name || ""} ${agent.description || ""}`);
  const category = inferred === "other" ? agent.category : inferred;
  return await upsertAgent({
    agentId: agent.agentId,
    owner: agent.owner,
    uri: agent.uri,
    name: agent.name || cleanString(merged.name) || null,
    description: agent.description || cleanString(merged.description) || null,
    image: agent.image || cleanString(merged.image) || null,
    category,
    source: "8004scan",
    metadata: {
      "8004scan": {
        reputation_score: agent.reputationScore,
        feedback_count: agent.feedbackCount,
        registrations: agent.registrations,
        services: agent.services,
        raw: agent.raw,
      },
    },
    registration: merged,
  });
}

async function sync8004scan() {
  const apiKey = Deno.env.get("EIGHT004SCAN_API_KEY") || Deno.env.get("ERC8004SCAN_API_KEY") || "";
  let requests = 0, accepted = 0, upserted = 0, skipped = 0, failed = 0;
  const errors: string[] = [];
  for (let page = 1; page <= EIGHT004SCAN_PAGES; page += 1) {
    const url = new URL(`${EIGHT004SCAN_BASE}/agents`);
    url.searchParams.set("chainId", String(CHAIN_ID));
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(EIGHT004SCAN_PAGE_SIZE));
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["X-API-Key"] = apiKey;
    try {
      const response = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(10000) });
      requests += 1;
      const body = JSON.parse(await response.text());
      if (!response.ok) throw new Error(`8004scan HTTP ${response.status}`);
      const agents = unwrapList(body);
      if (!agents.length) break;
      for (const raw of agents) {
        const agent = normalize8004(raw);
        if (!agent) continue;
        accepted += 1;
        try { const result = await enrichExternalAgent(agent); result.skippedFirstParty ? skipped += 1 : upserted += 1; } catch (error) { failed += 1; errors.push(`${agent.agentId}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (agents.length < EIGHT004SCAN_PAGE_SIZE) break;
    } catch (error) { failed += 1; errors.push(`page ${page}: ${error instanceof Error ? error.message : String(error)}`); break; }
  }
  return { requests, accepted, upserted, skipped_first_party: skipped, failed, errors: errors.slice(0, 25) };
}

async function syncChain() {
  const latest = await client.getBlockNumber();
  const { data: last, error } = await supabase.from("agent_registry_syncs").select("to_block").eq("network", NETWORK).eq("status", "completed").order("completed_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const start = last?.to_block != null ? BigInt(last.to_block) + 1n : latest > AGENT_BLOCKS_PER_RUN ? latest - AGENT_BLOCKS_PER_RUN + 1n : 0n;
  const end = start + AGENT_BLOCKS_PER_RUN - 1n > latest ? latest : start + AGENT_BLOCKS_PER_RUN - 1n;
  if (start > end) return { indexed: 0, errors: 0, from: start.toString(), to: end.toString(), logs: 0 };
  const logs = await client.getLogs({ address: REGISTRY, abi: TRANSFER_ABI, fromBlock: start, toBlock: end });
  let indexed = 0, errors = 0;
  const startedAt = new Date().toISOString();
  for (const log of logs) {
    if (String((log as any).args?.from || "").toLowerCase() !== ZERO_ADDRESS) continue;
    const agentId = String((log as any).args?.tokenId || "");
    if (!agentId) continue;
    try {
      const owner = await client.readContract({ address: REGISTRY, abi: OWNER_OF_ABI, functionName: "ownerOf", args: [BigInt(agentId)] });
      const uri = await client.readContract({ address: REGISTRY, abi: TOKEN_URI_ABI, functionName: "tokenURI", args: [BigInt(agentId)] });
      let registration: RegistrationFile = {};
      try { registration = await resolveRegistration(String(uri)); } catch { /* keep URI if metadata is temporarily unreachable */ }
      await upsertAgent({ agentId, owner: String(owner), uri: String(uri), name: cleanString(registration.name) || null, description: cleanString(registration.description) || null, image: cleanString(registration.image) || null, category: inferCategory(registration), source: "onchain", registration });
      indexed += 1;
    } catch { errors += 1; }
  }
  const { error: syncError } = await supabase.from("agent_registry_syncs").insert({ network: NETWORK, from_block: start.toString(), to_block: end.toString(), agents_seen: logs.length, agents_upserted: indexed, errors, status: errors ? "completed_with_errors" : "completed", started_at: startedAt, completed_at: new Date().toISOString(), metadata: { source: "agentmarket-testnet-indexer", chain_id: CHAIN_ID } });
  if (syncError) throw new Error(syncError.message);
  return { indexed, errors, from: start.toString(), to: end.toString(), logs: logs.length };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "POST required" }, { status: 405 });
  if (req.headers.get("x-agentmarket-cron-token") !== CRON_TOKEN) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const chain = await syncChain();
    const eight004scan = await sync8004scan();
    return Response.json({ ok: true, network: NETWORK, chain_id: CHAIN_ID, source_of_truth: "bsc_testnet_erc8004_identity_registry", chain, eight004scan });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
