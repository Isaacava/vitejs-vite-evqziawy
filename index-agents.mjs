import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import zlib from "node:zlib";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

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

const CATEGORY_RULES = [
  {
    category: "health_factor",
    keywords: [
      "health factor", "liquidation", "collateral ratio", "loan monitor",
      "borrow position", "safety ratio", "ltv", "loan-to-value", "margin call",
      "lending risk", "position health", "health_factor",
    ],
  },
  {
    category: "grid_trading",
    keywords: [
      "grid trading", "grid bot", "range trading", "grid strategy",
      "price grid", "grid range", "trading grid", "market making",
      "grid_trading", "algorithmic_trading",
    ],
  },
  {
    category: "yield",
    keywords: [
      "yield", "apy", "auto-compound", "autocompound", "vault rotation",
      "vault", "staking reward", "farming", "liquidity mining", "earn",
      "moolah", "lending pool", "stablecoin vault", "yield_optimization",
      "defi/yield",
    ],
  },
  {
    category: "rebalancing",
    keywords: [
      "rebalance", "rebalancing", "portfolio balance", "asset allocation",
      "auto-rotate", "auto rotate", "position rotation", "reallocation",
      "portfolio_management", "portfolio_rebalancing",
    ],
  },
];

function categorizeAgent(name, description, skills, domains) {
  const text = `${name || ""} ${description || ""} ${(skills || []).join(" ")} ${(domains || []).join(" ")}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      return rule.category;
    }
  }
  return "other";
}

const VALID_CATEGORIES = ["rebalancing", "grid_trading", "yield", "health_factor", "other"];

async function classifyWithAI(name, description) {
  if (!GROQ_API_KEY) return null;
  const text = `${name || ""}. ${description || ""}`.trim();
  if (!text || text.length < 3) return null;

  const prompt = `Classify this AI agent into exactly one category based on its name and description.

Categories:
- rebalancing: portfolio rebalancing, asset allocation agents
- grid_trading: grid trading bots, range-bound automated trading strategies
- yield: yield farming, staking, auto-compounding, vault optimization agents
- health_factor: loan health monitoring, liquidation prevention, collateral tracking agents
- other: anything that doesn't clearly fit the above (general chat, unrelated tools, vague/generic agents, non-financial agents)

Agent: "${text}"

Reply with ONLY the category name, nothing else. If it's not clearly one of the first four, reply "other".`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 10,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`  Groq API error: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim().toLowerCase().replace(/[^a-z_]/g, "");
    return VALID_CATEGORIES.includes(raw) ? raw : null;
  } catch (e) {
    console.warn(`  Groq classification failed: ${e.message}`);
    return null;
  }
}

async function fetchAgentMetadata(uri) {
  if (uri.startsWith("data:application/json")) {
    const commaIndex = uri.indexOf(",");
    const header = uri.slice(0, commaIndex);
    const payload = uri.slice(commaIndex + 1);
    const isBase64 = header.includes("base64");
    const isGzip = header.includes("gzip");

    let jsonText;
    if (isGzip) {
      const compressed = Buffer.from(payload, "base64");
      jsonText = zlib.gunzipSync(compressed).toString("utf-8");
    } else if (isBase64) {
      jsonText = Buffer.from(payload, "base64").toString("utf-8");
    } else {
      jsonText = decodeURIComponent(payload);
    }

    const parsed = JSON.parse(jsonText);
    return extractFields(parsed);
  }
  const resolved = resolveUri(uri);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(resolved, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = await res.json();
    return extractFields(parsed);
  } finally {
    clearTimeout(timeout);
  }
}

function extractFields(parsed) {
  const skills = [];
  const domains = [];
  if (Array.isArray(parsed.services)) {
    for (const svc of parsed.services) {
      if (Array.isArray(svc.skills)) skills.push(...svc.skills);
      if (Array.isArray(svc.domains)) domains.push(...svc.domains);
    }
  }
  return {
    name: parsed.name,
    description: parsed.description,
    image: parsed.image ? resolveUri(parsed.image) : undefined,
    skills,
    domains,
  };
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

    let category = categorizeAgent(meta.name, meta.description, meta.skills, meta.domains);
    if (category === "other" && GROQ_API_KEY) {
      const aiCategory = await classifyWithAI(meta.name, meta.description);
      if (aiCategory) category = aiCategory;
    }

    const { error } = await supabase.from("agents").upsert({
      agent_id: id.toString(),
      owner,
      uri,
      name: meta.name || null,
      description: meta.description || null,
      image: meta.image || null,
      chain: "bsc",
      category,
    });

    if (error) {
      console.error(`  DB upsert failed for agent ${id}:`, error.message);
      return false;
    }

    console.log(`  ✓ agent ${id} — ${meta.name || "(no name)"} [${category}]`);
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
