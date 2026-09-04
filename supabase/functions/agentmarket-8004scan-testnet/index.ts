import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_TOKEN = Deno.env.get("AGENTMARKET_SUPABASE_CRON_TOKEN") || "am-supabase-worker-97-v1";
const API_BASE = "https://api.8004scan.io/api/v1";
const CHAIN_ID = 97;
const NETWORK = "bsc-testnet";
const PAGE_SIZE = Math.max(10, Math.min(100, Number(Deno.env.get("EIGHT004SCAN_TESTNET_PAGE_SIZE") || "100")));
const PAGES = Math.max(1, Math.min(5, Number(Deno.env.get("EIGHT004SCAN_TESTNET_PAGES") || "2")));
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type Json = Record<string, unknown>;
function object(value: unknown): Json { return value && typeof value === "object" ? value as Json : {}; }
function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function numberValue(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function unwrap(body: unknown): Json[] {
  const root = object(body);
  const data = root.data;
  if (Array.isArray(data)) return data.map(object);
  if (data && typeof data === "object") {
    const nested = object(data);
    for (const key of ["agents", "items", "results"]) if (Array.isArray(nested[key])) return nested[key].map(object);
  }
  for (const key of ["agents", "items", "results"]) if (Array.isArray(root[key])) return (root[key] as unknown[]).map(object);
  return [];
}
function chainIdOf(agent: Json) { const chain = object(agent.chain); return numberValue(agent.chain_id ?? agent.chainId ?? chain.chain_id ?? chain.chainId); }
function servicesOf(agent: Json) {
  return list(agent.services).map(object).filter((service) => stringValue(service.endpoint || service.serviceEndpoint || service.url || service.uri));
}
function makeAgentId(agent: Json) {
  return stringValue(agent.agent_id ?? agent.agentId ?? agent.token_id ?? agent.tokenId ?? agent.id);
}
function metadata(agent: Json) {
  return {
    source: "8004scan",
    network: NETWORK,
    chain_id: CHAIN_ID,
    indexed_at: new Date().toISOString(),
    reputation_score: numberValue(agent.total_score ?? agent.reputation_score ?? agent.reputationScore),
    feedback_count: numberValue(agent.total_feedbacks ?? agent.feedback_count ?? agent.feedbackCount),
    stars: numberValue(agent.star_count ?? agent.stars),
    supported_protocols: list(agent.supported_protocols),
    services: servicesOf(agent),
    raw: agent,
  };
}

async function indexPage(page: number, apiKey: string) {
  const url = new URL(`${API_BASE}/agents`);
  url.searchParams.set("chainId", String(CHAIN_ID));
  url.searchParams.set("isTestnet", "true");
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(PAGE_SIZE));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;
  const response = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(12000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`8004scan HTTP ${response.status}`);
  return { agents: unwrap(body), body };
}

async function upsert(agent: Json) {
  const id = makeAgentId(agent);
  if (!id || chainIdOf(agent) !== CHAIN_ID) return "ignored";
  const owner = stringValue(agent.owner_address ?? agent.owner ?? agent.ownerAddress) || null;
  const name = stringValue(agent.name) || `ERC-8004 Agent #${id}`;
  const description = stringValue(agent.description) || null;
  const image = stringValue(agent.image_url ?? agent.image) || null;
  const existing = await supabase.from("agents").select("id,is_first_party,source,metadata").eq("agent_id", id).eq("chain", NETWORK).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.is_first_party) return "first_party";
  const existingMetadata = object(existing.data?.metadata);
  const row = {
    agent_id: id,
    owner,
    uri: stringValue(agent.agent_uri ?? agent.agentURI ?? agent.uri),
    name,
    description,
    image,
    chain: NETWORK,
    category: "other",
    status: "indexed",
    verification_status: "indexed",
    source: existing.data?.source && existing.data.source !== "indexed" ? existing.data.source : "indexed",
    is_first_party: false,
    indexed_at: existing.data?.metadata ? existing.data?.metadata && existing.data.metadata.indexed_at ? existing.data.metadata.indexed_at : new Date().toISOString() : new Date().toISOString(),
    last_indexed_at: new Date().toISOString(),
    metadata: { ...existingMetadata, ...metadata(agent) },
  };
  if (existing.data) {
    const result = await supabase.from("agents").update(row).eq("id", existing.data.id);
    if (result.error) throw new Error(result.error.message);
  } else {
    const result = await supabase.from("agents").insert(row);
    if (result.error) throw new Error(result.error.message);
  }
  return "upserted";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "POST required" }, { status: 405 });
  if (req.headers.get("x-agentmarket-cron-token") !== CRON_TOKEN) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const apiKey = Deno.env.get("EIGHT004SCAN_API_KEY") || Deno.env.get("ERC8004SCAN_API_KEY") || "";
  let pages = 0, fetched = 0, upserted = 0, skippedFirstParty = 0, ignored = 0, failed = 0;
  const errors: string[] = [];
  try {
    for (let page = 1; page <= PAGES; page += 1) {
      const { agents } = await indexPage(page, apiKey);
      pages += 1;
      if (!agents.length) break;
      for (const agent of agents) {
        fetched += 1;
        try {
          const result = await upsert(agent);
          if (result === "upserted") upserted += 1;
          else if (result === "first_party") skippedFirstParty += 1;
          else ignored += 1;
        } catch (error) {
          failed += 1;
          errors.push(`${makeAgentId(agent) || "unknown"}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (agents.length < PAGE_SIZE) break;
    }
    return Response.json({ ok: true, network: NETWORK, chain_id: CHAIN_ID, testnet: true, pages, fetched, upserted, skipped_first_party: skippedFirstParty, ignored, failed, errors: errors.slice(0, 25) });
  } catch (error) {
    return Response.json({ ok: false, network: NETWORK, chain_id: CHAIN_ID, testnet: true, pages, fetched, upserted, skipped_first_party: skippedFirstParty, failed: failed + 1, errors: [...errors, error instanceof Error ? error.message : String(error)].slice(0, 25) }, { status: 500 });
  }
});
