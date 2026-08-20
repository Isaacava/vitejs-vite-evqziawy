import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { keccak256, stringToHex } from "viem";
import { getAuthenticatedUser } from "../../src/server/authHandlers.js";

const TESTNET_CHAIN_ID = 97;
const TESTNET_ENVIRONMENT = "testnet";
const REQUEST_TIMEOUT_MS = 12_000;
const QUOTE_TTL_MS = 5 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AgentRow = {
  id: string;
  agent_id: string;
  owner: string;
  name: string | null;
  status: string | null;
  verification_status: string | null;
};

type ProviderQuote = {
  accepted?: boolean;
  price?: string | number;
  currency?: string;
  provider_sig?: string;
  provider_signature?: string;
  quote_expires_at?: string | number;
  chain_id?: number;
  [key: string]: unknown;
};

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function canonicalQuotePayload(input: {
  quoteId: string;
  agentId: string;
  requesterWallet: string;
  goal: string;
  price: string;
  currency: string;
  expiresAt: string;
  requestMetadata: Record<string, unknown>;
}) {
  return JSON.stringify({
    network: "bsc-testnet",
    chain_id: TESTNET_CHAIN_ID,
    environment: TESTNET_ENVIRONMENT,
    quote_id: input.quoteId,
    agent_id: input.agentId,
    requester_wallet: input.requesterWallet.toLowerCase(),
    goal: input.goal,
    price: input.price,
    currency: input.currency,
    expires_at: input.expiresAt,
    request_metadata: input.requestMetadata,
  });
}

async function postJson(url: string, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    return { response, body: parsed };
  } finally {
    clearTimeout(timeout);
  }
}

async function negotiate(endpointUrl: string, taskDescription: string, terms: Record<string, unknown>) {
  const normalized = endpointUrl.replace(/\/+$/, "");
  const candidates = normalized.toLowerCase().endsWith("/erc8183")
    ? [`${normalized}/negotiate`, `${normalized}/apex/negotiate`]
    : [`${normalized}/negotiate`, `${normalized}/erc8183/negotiate`, `${normalized}/apex/negotiate`];
  let lastError = "Provider negotiation failed";

  for (const url of candidates) {
    try {
      const { response, body } = await postJson(url, {
        task_description: taskDescription,
        terms,
      });
      if (response.ok) return body as ProviderQuote;
      lastError = `Provider returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }

  throw new Error(`${lastError}; tried ${candidates.join(", ")}`);
}

function normalizedPrice(value: unknown) {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new Error("Provider quote did not contain a valid integer price in raw settlement-token units");
}

function normalizedExpiry(value: unknown, fallback: string) {
  if (typeof value === "string" && value) return new Date(value).toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }
  return fallback;
}

async function resolveTestnetAgent(supabase: ReturnType<typeof serverClient>, agentIdentifier: string) {
  const query = supabase
    .from("agents")
    .select("id,agent_id,owner,name,status,verification_status")
    .eq("chain", "bsc-testnet");

  const result = UUID_RE.test(agentIdentifier)
    ? await query.eq("id", agentIdentifier).maybeSingle()
    : await query.eq("agent_id", agentIdentifier).maybeSingle();

  if (result.error) throw new Error(result.error.message);
  return result.data as AgentRow | null;
}

async function requestQuote(req: VercelRequest, res: VercelResponse, user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>) {
  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  const agentIdentifier = typeof req.body?.agent_id === "string" ? req.body.agent_id.trim() : "";
  const requestMetadata = typeof req.body?.parameters === "object" && req.body.parameters !== null ? req.body.parameters : {};
  if (!goal || !agentIdentifier) return res.status(400).json({ error: "goal and agent_id are required" });

  const supabase = serverClient();
  const agent = await resolveTestnetAgent(supabase, agentIdentifier);
  if (!agent) return res.status(404).json({ error: "Testnet agent not found" });
  if (agent.verification_status === "revoked") return res.status(409).json({ error: "Agent identity is revoked" });

  const { data: endpoint, error: endpointError } = await supabase
    .from("agent_endpoints")
    .select("endpoint_url,status,last_checked_at")
    .eq("agent_id", agent.id)
    .order("last_checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (endpointError) throw new Error(endpointError.message);
  if (!endpoint?.endpoint_url || endpoint.status !== "online") {
    return res.status(409).json({ error: "Testnet provider endpoint is not healthy", readiness: endpoint?.status ?? "missing" });
  }

  const providerQuote = await negotiate(endpoint.endpoint_url, goal, {
    ...requestMetadata,
    chain_id: TESTNET_CHAIN_ID,
    environment: TESTNET_ENVIRONMENT,
  });

  if (providerQuote.accepted === false) {
    return res.status(409).json({ error: "Provider declined the requested terms", provider_quote: providerQuote });
  }

  const price = normalizedPrice(providerQuote.price);
  const currency = typeof providerQuote.currency === "string" ? providerQuote.currency : "testnet-settlement-token";
  const expiresAt = normalizedExpiry(providerQuote.quote_expires_at, new Date(Date.now() + QUOTE_TTL_MS).toISOString());
  if (new Date(expiresAt).getTime() <= Date.now()) return res.status(409).json({ error: "Provider returned an already-expired quote" });

  const quoteId = crypto.randomUUID();
  const requesterWallet = user.user.wallet_address;
  const quoteHash = keccak256(stringToHex(canonicalQuotePayload({
    quoteId,
    agentId: agent.id,
    requesterWallet,
    goal,
    price,
    currency,
    expiresAt,
    requestMetadata: requestMetadata as Record<string, unknown>,
  })));

  const { data: quote, error: quoteError } = await supabase
    .from("marketplace_quotes")
    .insert({
      quote_id: quoteId,
      agent_id: agent.id,
      requester_wallet: requesterWallet,
      goal,
      request_metadata: requestMetadata,
      price,
      currency,
      provider_quote: providerQuote,
      quote_hash: quoteHash,
      chain_id: TESTNET_CHAIN_ID,
      environment: TESTNET_ENVIRONMENT,
      status: "offered",
      provider_status_code: 200,
      expires_at: expiresAt,
    })
    .select("quote_id,agent_id,requester_wallet,goal,request_metadata,price,currency,provider_quote,quote_hash,status,expires_at")
    .single();
  if (quoteError) throw new Error(quoteError.message);

  return res.status(200).json({
    ok: true,
    network: "bsc-testnet",
    chain_id: TESTNET_CHAIN_ID,
    environment: TESTNET_ENVIRONMENT,
    quote,
    provider: {
      agent_id: agent.agent_id,
      name: agent.name,
      status: agent.status,
      verification_status: agent.verification_status,
      endpoint: endpoint.endpoint_url,
    },
    signature_present: Boolean(providerQuote.provider_sig || providerQuote.provider_signature),
    next: "Accept this quote, then call the Testnet ERC-8183 prepare endpoint with quote_id.",
  });
}

async function acceptQuote(req: VercelRequest, res: VercelResponse, user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>) {
  const quoteId = typeof req.body?.quote_id === "string" ? req.body.quote_id.trim() : "";
  if (!quoteId) return res.status(400).json({ error: "quote_id is required" });

  const supabase = serverClient();
  const { data: quote, error } = await supabase
    .from("marketplace_quotes")
    .select("quote_id,requester_wallet,status,expires_at,quote_hash,chain_id,environment")
    .eq("quote_id", quoteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!quote) return res.status(404).json({ error: "Quote not found" });
  if (quote.chain_id !== TESTNET_CHAIN_ID || quote.environment !== TESTNET_ENVIRONMENT) return res.status(409).json({ error: "Quote is not a Testnet quote" });
  if (quote.requester_wallet.toLowerCase() !== user.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "Quote belongs to another wallet" });
  if (quote.status !== "offered") return res.status(409).json({ error: `Quote is ${quote.status}` });
  if (new Date(quote.expires_at).getTime() <= Date.now()) {
    await supabase.from("marketplace_quotes").update({ status: "expired" }).eq("quote_id", quoteId);
    return res.status(409).json({ error: "Quote has expired" });
  }

  const { data: accepted, error: updateError } = await supabase
    .from("marketplace_quotes")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("quote_id", quoteId)
    .eq("status", "offered")
    .select("quote_id,agent_id,requester_wallet,goal,request_metadata,price,currency,provider_quote,quote_hash,status,expires_at,accepted_at")
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);
  if (!accepted) return res.status(409).json({ error: "Quote could not be accepted; it may have changed state" });

  return res.status(200).json({
    ok: true,
    network: "bsc-testnet",
    chain_id: TESTNET_CHAIN_ID,
    environment: TESTNET_ENVIRONMENT,
    quote: accepted,
    next: "Use quote_id with /api/testnet/erc8183 to prepare the accepted Testnet job.",
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  try {
    const action = typeof req.body?.action === "string" ? req.body.action : "request";
    if (action === "accept") return await acceptQuote(req, res, auth);
    if (action !== "request") return res.status(400).json({ error: "action must be request or accept" });
    return await requestQuote(req, res, auth);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to process Testnet quote" });
  }
}
