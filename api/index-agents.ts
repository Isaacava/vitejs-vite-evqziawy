import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { decodeEventLog, parseAbiItem, type Address, type Hex } from "viem";
import { ERC8004_REGISTRY_ADDRESS, publicClient } from "../src/lib/erc8183.js";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const BLOCKS_PER_RUN = BigInt(process.env.ERC8004_INDEX_BLOCKS_PER_RUN || "5000");
const MAX_URI_BYTES = 512_000;

type RegistrationFile = {
  name?: string;
  description?: string;
  image?: string;
  category?: string;
  capabilities?: unknown;
  skills?: unknown;
  services?: unknown;
  endpoints?: unknown;
  metadata?: Record<string, unknown>;
};

type Endpoint = { url: string; protocol: string; version?: string; metadata?: Record<string, unknown> };

function supabaseServer() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function normalizeUri(uri: string) {
  if (uri.startsWith("ipfs://")) {
    const gateway = (process.env.IPFS_GATEWAY_URL || "https://ipfs.io/ipfs/").replace(/\/$/, "");
    return `${gateway}/${uri.slice("ipfs://".length)}`;
  }
  return uri;
}

async function resolveRegistration(uri: string): Promise<RegistrationFile> {
  if (uri.startsWith("data:")) {
    const [, payload = ""] = uri.split(",", 2);
    const text = uri.includes(";base64")
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
    return JSON.parse(text) as RegistrationFile;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(normalizeUri(uri), {
      signal: controller.signal,
      headers: { accept: "application/json,text/plain;q=0.9,*/*;q=0.8" },
    });
    if (!response.ok) throw new Error(`registration fetch returned ${response.status}`);

    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_URI_BYTES) throw new Error("registration file exceeds size limit");

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_URI_BYTES) throw new Error("registration file exceeds size limit");
    return JSON.parse(text) as RegistrationFile;
  } finally {
    clearTimeout(timer);
  }
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return [record.name, record.id, record.capability, record.skill, record.description]
        .filter((part): part is string => typeof part === "string");
    }
    return [];
  });
}

function extractEndpoints(registration: RegistrationFile): Endpoint[] {
  const raw = [
    ...strings(registration.endpoints),
    ...strings(registration.services),
  ];

  const objects = [registration.services, registration.endpoints].flatMap((value) =>
    Array.isArray(value) ? value : [],
  );

  const objectEndpoints = objects.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const url = [record.serviceEndpoint, record.endpoint, record.url, record.uri]
      .find((candidate): candidate is string => typeof candidate === "string" && candidate.startsWith("http"));
    if (!url) return [];
    return [{
      url,
      protocol: typeof record.protocol === "string" ? record.protocol : typeof record.name === "string" ? record.name : "erc8183",
      version: typeof record.version === "string" ? record.version : undefined,
      metadata: record,
    }];
  });

  const stringEndpoints = raw
    .filter((value) => /^https?:\/\//i.test(value))
    .map((url) => ({ url, protocol: "erc8183" }));

  const unique = new Map<string, Endpoint>();
  [...objectEndpoints, ...stringEndpoints].forEach((endpoint) => unique.set(`${endpoint.protocol}:${endpoint.url}`, endpoint));
  return [...unique.values()];
}

function inferCategory(registration: RegistrationFile, capabilityStrings: string[]) {
  if (registration.category) return registration.category;
  const text = `${registration.name || ""} ${registration.description || ""} ${capabilityStrings.join(" ")}`.toLowerCase();
  if (/grid/.test(text)) return "grid_trading";
  if (/yield|lending|staking|liquidity/.test(text)) return "yield";
  if (/risk|health factor|liquidation|monitor/.test(text)) return "health_factor";
  if (/rebalance|portfolio|allocation/.test(text)) return "rebalancing";
  return "other";
}

async function syncAgent(supabase: ReturnType<typeof supabaseServer>, agentId: string, owner: string, uri: string) {
  let registration: RegistrationFile = {};
  let resolveError: string | null = null;
  try {
    registration = await resolveRegistration(uri);
  } catch (error) {
    resolveError = error instanceof Error ? error.message : "unable to resolve registration file";
  }

  const capabilityStrings = [
    ...strings(registration.capabilities),
    ...strings(registration.skills),
    ...strings(registration.services),
  ].map((value) => value.trim()).filter(Boolean);
  const category = inferCategory(registration, capabilityStrings);

  const { data: existing, error: existingError } = await supabase
    .from("agents")
    .select("id,agent_id,source,verification_status,category,is_first_party,status")
    .eq("agent_id", agentId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  const identityPatch = {
    owner,
    uri,
    name: registration.name || null,
    description: registration.description || null,
    image: registration.image || null,
    chain: "bsc",
    indexed_at: new Date().toISOString(),
    last_indexed_at: new Date().toISOString(),
    ...(existing?.source && existing.source !== "indexed"
      ? {}
      : { source: "indexed", verification_status: existing?.verification_status || "indexed" }),
    ...(!existing || existing.category === "other" || existing.source === "indexed" ? { category } : {}),
    metadata: {
      ...(existing ? {} : {}),
      registration,
      indexer: "agentmarket",
      resolution_error: resolveError,
    },
  };

  let dbAgent: { id: string } | null = existing ? { id: existing.id } : null;
  if (existing) {
    const { data, error } = await supabase.from("agents").update(identityPatch).eq("id", existing.id).select("id").single();
    if (error) throw new Error(error.message);
    dbAgent = data;
  } else {
    const { data, error } = await supabase.from("agents").insert({
      agent_id: agentId,
      owner,
      uri,
      name: registration.name || `Agent #${agentId}`,
      description: registration.description || null,
      image: registration.image || null,
      chain: "bsc",
      category,
      source: "indexed",
      verification_status: "indexed",
      status: "unknown",
      is_first_party: false,
      indexed_at: new Date().toISOString(),
      last_indexed_at: new Date().toISOString(),
      metadata: { registration, indexer: "agentmarket", resolution_error: resolveError },
    }).select("id").single();
    if (error) throw new Error(error.message);
    dbAgent = data;
  }

  if (!dbAgent) throw new Error("agent row missing after sync");

  for (const capability of [...new Set([category, ...capabilityStrings])]) {
    await supabase.from("agent_capabilities").upsert({
      agent_id: dbAgent.id,
      capability,
      source: "registration",
      confidence: capability === category ? 1 : 0.8,
      metadata: { agentId },
      updated_at: new Date().toISOString(),
    }, { onConflict: "agent_id,capability,source" });
  }

  for (const endpoint of extractEndpoints(registration)) {
    await supabase.from("agent_endpoints").upsert({
      agent_id: dbAgent.id,
      endpoint_url: endpoint.url,
      protocol: endpoint.protocol,
      version: endpoint.version || null,
      status: "unknown",
      metadata: endpoint.metadata || {},
      updated_at: new Date().toISOString(),
    }, { onConflict: "agent_id,endpoint_url,protocol" });
  }

  return { resolved: !resolveError, endpointCount: extractEndpoints(registration).length, category };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authorization = req.headers.authorization;
  if (cronSecret && authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (process.env.NODE_ENV === "production" && !cronSecret) {
    return res.status(503).json({ error: "CRON_SECRET must be configured before production indexing is enabled" });
  }

  try {
    const supabase = supabaseServer();
    const latest = await publicClient.getBlockNumber();

    const { data: previous } = await supabase
      .from("agent_registry_syncs")
      .select("to_block")
      .eq("network", "bsc")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const configuredStart = process.env.ERC8004_INDEX_START_BLOCK;
    const start = previous?.to_block != null
      ? BigInt(previous.to_block) + 1n
      : configuredStart
        ? BigInt(configuredStart)
        : latest > 50_000n ? latest - 50_000n : 0n;
    const end = start + BLOCKS_PER_RUN - 1n > latest ? latest : start + BLOCKS_PER_RUN - 1n;

    if (start > latest) {
      return res.status(200).json({ ok: true, message: "Indexer already caught up", latest: latest.toString() });
    }

    const { data: sync, error: syncError } = await supabase.from("agent_registry_syncs").insert({
      network: "bsc",
      from_block: start.toString(),
      to_block: end.toString(),
      status: "running",
    }).select("id").single();
    if (syncError) throw new Error(syncError.message);

    const logs = await publicClient.getLogs({
      address: ERC8004_REGISTRY_ADDRESS,
      event: TRANSFER_EVENT,
      fromBlock: start,
      toBlock: end,
    });

    const mintedIds = [...new Set(logs
      .map((log) => {
        try {
          const decoded = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics });
          if (decoded.eventName !== "Transfer") return null;
          const args = decoded.args as { from: Address; tokenId: bigint };
          return args.from.toLowerCase() === ZERO_ADDRESS.toLowerCase() ? args.tokenId : null;
        } catch {
          return null;
        }
      })
      .filter((id): id is bigint => id !== null)
      .map((id) => id.toString()))];

    let upserted = 0;
    let errors = 0;
    for (const agentId of mintedIds) {
      try {
        const tokenId = BigInt(agentId);
        const [owner, uri] = await Promise.all([
          publicClient.readContract({ address: ERC8004_REGISTRY_ADDRESS, abi: [
            { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
          ], functionName: "ownerOf", args: [tokenId] }),
          publicClient.readContract({ address: ERC8004_REGISTRY_ADDRESS, abi: [
            { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "string" }] },
          ], functionName: "tokenURI", args: [tokenId] }),
        ]);
        await syncAgent(supabase, agentId, owner, uri);
        upserted += 1;
      } catch {
        errors += 1;
      }
    }

    await supabase.from("agent_registry_syncs").update({
      completed_at: new Date().toISOString(),
      agents_seen: mintedIds.length,
      agents_upserted: upserted,
      errors,
      status: errors ? "completed_with_errors" : "completed",
    }).eq("id", sync.id);

    return res.status(200).json({
      ok: true,
      network: "bsc",
      from_block: start.toString(),
      to_block: end.toString(),
      latest_block: latest.toString(),
      agents_seen: mintedIds.length,
      agents_upserted: upserted,
      errors,
      next_run_from_block: end < latest ? (end + 1n).toString() : null,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Indexer failed" });
  }
}
