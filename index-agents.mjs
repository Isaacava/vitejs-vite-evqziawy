import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const IDENTITY_REGISTRY_ADDRESS = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

const IDENTITY_REGISTRY_ABI = [
  { inputs: [], name: "totalSupply", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }], name: "tokenURI", outputs: [{ internalType: "string", name: "", type: "string" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }], name: "ownerOf", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
];

const client = createPublicClient({
  chain: bsc,
  transport: http("https://bsc.publicnode.com"),
  batch: { multicall: true },
});

function resolveUri(uri) {
  if (uri.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  }
  return uri;
}

async function fetchAgentMetadata(uri) {
  if (uri.startsWith("data:application/json")) {
    const commaIndex = uri.indexOf(",");
    const payload = uri.slice(commaIndex + 1);
    const isBase64 = uri.slice(0, commaIndex).includes("base64");
    const jsonText = isBase64 ? Buffer.from(payload, "base64").toString("utf-8") : decodeURIComponent(payload);
    const parsed = JSON.parse(jsonText);
    return { name: parsed.name, description: parsed.description, image: parsed.image };
  }
  const resolved = resolveUri(uri);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(resolved, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = await res.json();
    return {
      name: parsed.name,
      description: parsed.description,
      image: parsed.image ? resolveUri(parsed.image) : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function withRetry(fn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
}

async function processAgent(id) {
  try {
    const owner = await withRetry(() =>
      client.readContract({
        address: IDENTITY_REGISTRY_ADDRESS,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "ownerOf",
        args: [BigInt(id)],
      })
    );

    const uri = await withRetry(() =>
      client.readContract({
        address: IDENTITY_REGISTRY_ADDRESS,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "tokenURI",
        args: [BigInt(id)],
      })
    );

    let meta = {};
    try {
      meta = await fetchAgentMetadata(uri);
    } catch (e) {
      console.warn(`  metadata fetch failed for agent ${id}: ${e.message}`);
    }

    const { error } = await supabase.from("agents").upsert({
      agent_id: id.toString(),
      owner,
      uri,
      name: meta.name || null,
      description: meta.description || null,
      image: meta.image || null,
      chain: "bsc",
    });

    if (error) {
      console.error(`  DB upsert failed for agent ${id}:`, error.message);
      return false;
    }

    console.log(`  ✓ agent ${id} — ${meta.name || "(no name)"}`);
    return true;
  } catch (e) {
    return null;
  }
}

async function main() {
  const startId = parseInt(process.env.START_ID || "1", 10);
  const endId = parseInt(process.env.END_ID || "2000", 10);
  const concurrency = parseInt(process.env.CONCURRENCY || "8", 10);

  console.log(`Indexing agent IDs ${startId}–${endId} (concurrency: ${concurrency})`);
  console.log(`Registry: ${IDENTITY_REGISTRY_ADDRESS}`);

  let indexed = 0;
  let notFound = 0;
  let failed = 0;

  const ids = Array.from({ length: endId - startId + 1 }, (_, i) => startId + i);

  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((id) => processAgent(id)));
    for (const r of results) {
      if (r === true) indexed++;
      else if (r === null) notFound++;
      else failed++;
    }
    if (i % 100 === 0) {
      console.log(`Progress: ${i + batch.length}/${ids.length} checked — ${indexed} indexed, ${notFound} not found, ${failed} failed`);
    }
  }

  console.log(`\nDone. Indexed: ${indexed}, Not found: ${notFound}, Failed: ${failed}`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
