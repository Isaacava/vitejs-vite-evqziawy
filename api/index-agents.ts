import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { serverClient } from "../src/server/supabase.js";

const NETWORK = "bsc-testnet";
const REGISTRY = "0x3F5bB5f0D5A3d9cE6B1A2a4A7E0aB5C9D8eF6a1B" as Address;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });

type RegistrationFile = {
  name?: string;
  description?: string;
  image?: string;
  category?: string;
  capabilities?: unknown;
  skills?: unknown;
  services?: unknown;
  endpoints?: unknown;
  [key: string]: unknown;
};

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(strings);
  return [];
}

async function resolveRegistration(uri: string): Promise<RegistrationFile> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`registration fetch failed: HTTP ${response.status}`);
  return await response.json() as RegistrationFile;
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

async function syncAgent(supabase: ReturnType<typeof serverClient>, agentId: string, owner: string, uri: string) {
  let registration: RegistrationFile = {};
  let resolveError: string | null = null;
  try { registration = await resolveRegistration(uri); } catch (error) { resolveError = error instanceof Error ? error.message : "unable to resolve registration file"; }
  const capabilityStrings = [...strings(registration.capabilities), ...strings(registration.skills), ...strings(registration.services)].map((value) => value.trim()).filter(Boolean);
  const category = inferCategory(registration, capabilityStrings);
  const { data: existing, error: existingError } = await supabase.from("agents").select("id,agent_id,source,verification_status,category,is_first_party,status,indexed_at,last_indexed_at,metadata").eq("agent_id", agentId).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  const now = new Date().toISOString();
  const identityPatch = {
    owner,
    uri,
    name: registration.name || null,
    description: registration.description || null,
    image: registration.image || null,
    chain: NETWORK,
    indexed_at: existing?.indexed_at || now,
    last_indexed_at: now,
    ...(existing?.source && existing.source !== "indexed" ? {} : { source: "indexed", verification_status: existing?.verification_status || "indexed" }),
    ...(!existing || existing.category === "other" || existing.source === "indexed" ? { category } : {}),
    metadata: {
      ...(existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
      registration,
      indexer: "agentmarket",
      environment: "testnet",
      chain_id: 97,
      resolution_error: resolveError,
    },
  };
  let dbAgent: { id: string } | null = existing ? { id: existing.id } : null;
  if (existing) {
    const { data, error } = await supabase.from("agents").update(identityPatch as never).eq("id", existing.id).select("id").single();
    if (error) throw new Error(error.message);
    dbAgent = data as { id: string };
  } else {
    const { data, error } = await supabase.from("agents").insert({
      agent_id: agentId,
      owner,
      uri,
      name: registration.name || `Agent #${agentId}`,
      description: registration.description || null,
      image: registration.image || null,
      chain: NETWORK,
      source: "indexed",
      verification_status: "indexed",
      category,
      is_first_party: owner.toLowerCase() === process.env.FIRST_PARTY_OWNER?.toLowerCase(),
      status: "active",
      indexed_at: now,
      last_indexed_at: now,
      metadata: {
        registration,
        indexer: "agentmarket",
        environment: "testnet",
        chain_id: 97,
        resolution_error: resolveError,
      },
    }).select("id").single();
    if (error) throw new Error(error.message);
    dbAgent = data as { id: string };
  }
  if (!dbAgent) throw new Error("Agent database record was not created");

  const { error: capabilityError } = await supabase.from("agent_capabilities").delete().eq("agent_id", dbAgent.id);
  if (capabilityError) throw new Error(capabilityError.message);
  if (capabilityStrings.length) {
    const rows = unique(capabilityStrings).map((capability) => ({ agent_id: dbAgent!.id, capability, source: "registration", confidence: 0.9, metadata: { chain_id: 97 } }));
    const { error } = await supabase.from("agent_capabilities").insert(rows);
    if (error) throw new Error(error.message);
  }
  return { id: dbAgent.id, agentId, owner, category, resolveError };
}

function unique(values: string[]) { return [...new Set(values)]; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const supabase = serverClient();
    const address = typeof req.query?.owner === "string" ? req.query.owner : "";
    if (!address) return res.status(400).json({ error: "owner is required" });
    const logs = await syncAgent(supabase, String(req.query?.agent_id || "0"), address, String(req.query?.uri || ""));
    return res.status(200).json({ ok: true, network: NETWORK, ...logs });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Agent indexing failed" });
  }
}
