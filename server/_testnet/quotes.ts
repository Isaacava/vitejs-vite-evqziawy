import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, formatUnits, http, keccak256, stringToHex, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser } from "../../src/server/authHandlers.js";
import { invokeProviderOperation, resolveProviderOperation } from "./provider-operation.js";

const TESTNET_CHAIN_ID = 97;
const TESTNET_ENVIRONMENT = "testnet";
const QUOTE_TTL_MS = 5 * 60 * 1000;
const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const COMMERCE_ABI = [{ type: "function", name: "paymentToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
const ERC20_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http() });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CapabilityInput = {
  name?: unknown;
  required?: unknown;
  type?: unknown;
  default?: unknown;
};

type AgentRow = {
  id: string;
  agent_id: string;
  owner: string;
  name?: string | null;
  category?: string | null;
  status: string | null;
  verification_status: string | null;
  metadata: Record<string, unknown> | null;
};

type ProviderQuote = { accepted?: boolean; price?: string | number; price_raw?: string | number; priceRaw?: string | number; raw_price?: string | number; amount_raw?: string | number; amountRaw?: string | number; settlement_amount_raw?: string | number; price_unit?: string; unit?: string; amount_unit?: string; currency?: string; provider_sig?: string; provider_signature?: string; quote_expires_at?: string | number; chain_id?: number; [key: string]: unknown };

type StoredEndpoint = {
  endpoint_url: string;
  protocol: string;
  status: string;
  last_checked_at: string | null;
  metadata: Record<string, unknown> | null;
};

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function validAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function canonicalQuotePayload(input: { quoteId: string; agentId: string; requesterWallet: string; providerWallet: string; goal: string; price: string; currency: string; expiresAt: string; requestMetadata: Record<string, unknown> }) {
  return JSON.stringify({
    network: "bsc-testnet",
    chain_id: TESTNET_CHAIN_ID,
    environment: TESTNET_ENVIRONMENT,
    quote_id: input.quoteId,
    agent_id: input.agentId,
    requester_wallet: input.requesterWallet.toLowerCase(),
    provider_wallet: input.providerWallet.toLowerCase(),
    goal: input.goal,
    price: input.price,
    currency: input.currency,
    expires_at: input.expiresAt,
    request_metadata: input.requestMetadata,
  });
}

function normalizedPrice(quote: ProviderQuote, settlementToken: string, settlementSymbol: string, decimals: number) {
  const rawCandidates = [quote.price_raw, quote.priceRaw, quote.raw_price, quote.amount_raw, quote.amountRaw, quote.settlement_amount_raw];
  for (const candidate of rawCandidates) {
    if (typeof candidate === "string" && /^\d+$/.test(candidate.trim())) return candidate.trim();
    if (typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0) return String(candidate);
  }

  const value = quote.price;
  const unit = typeof quote.price_unit === "string" ? quote.price_unit.trim().toLowerCase() : typeof quote.unit === "string" ? quote.unit.trim().toLowerCase() : typeof quote.amount_unit === "string" ? quote.amount_unit.trim().toLowerCase() : "";
  const currency = typeof quote.currency === "string" ? quote.currency.trim() : "";
  const currencyMatchesSettlement = !currency || currency.toLowerCase() === settlementSymbol.toLowerCase() || currency.toLowerCase() === settlementToken.toLowerCase();

  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    if (unit === "raw" || unit === "base" || unit === "atomic" || unit === "wei") {
      if (!Number.isSafeInteger(value)) throw new Error("Provider raw quote price must be an integer");
      return String(value);
    }
    if (currencyMatchesSettlement) return parseUnitsExact(String(value), decimals);
  }

  if (typeof value === "string" && value.trim()) {
    const text = value.trim();
    if (unit === "raw" || unit === "base" || unit === "atomic" || unit === "wei") {
      if (/^\d+$/.test(text)) return text;
      throw new Error("Provider raw quote price must be an integer");
    }
    if (unit === "token" || unit === "decimal" || unit === "human" || currencyMatchesSettlement && /\./.test(text)) return parseUnitsExact(text, decimals);
    if (/^\d+$/.test(text)) {
      const integer = BigInt(text);
      const tokenScale = 10n ** BigInt(decimals);
      if (currencyMatchesSettlement && integer < tokenScale) return (integer * tokenScale).toString();
      return text;
    }
  }

  throw new Error("Provider quote did not contain a usable price; expected price_raw (recommended) or a price with settlement-token units");
}

function parseUnitsExact(value: string, decimals: number) {
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) throw new Error("Provider decimal quote price is invalid");
  const [whole, fraction = ""] = value.trim().split(".");
  if (fraction.length > decimals) throw new Error(`Provider quote has more than ${decimals} decimal places`);
  return (BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}

function normalizedExpiry(value: unknown, fallback: string) {
  if (typeof value === "string" && value) return new Date(value).toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  return fallback;
}

function normalizedCurrency(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const currency = value.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(currency) ? fallback : currency;
}

function schemaInputs(agent: AgentRow): CapabilityInput[] {
  const metadata = agent.metadata && typeof agent.metadata === "object" ? agent.metadata : {};
  const schema = metadata.capability_schema && typeof metadata.capability_schema === "object" ? metadata.capability_schema as Record<string, unknown> : null;
  return Array.isArray(schema?.inputs) ? schema.inputs.filter((item): item is CapabilityInput => Boolean(item && typeof item === "object")) : [];
}

function matchesType(value: unknown, type: string) {
  const normalized = type.toLowerCase();
  if (normalized === "number" || normalized === "integer" || normalized === "uint" || normalized === "uint256") return (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()));
  if (normalized === "boolean" || normalized === "bool") return typeof value === "boolean";
  if (normalized === "string" || normalized === "text") return typeof value === "string";
  if (normalized === "array" || normalized.endsWith("[]")) return Array.isArray(value);
  if (normalized === "object" || normalized === "json") return Boolean(value && typeof value === "object" && !Array.isArray(value));
  return true;
}

function validateRequestMetadata(agent: AgentRow, input: Record<string, unknown>) {
  const inputs = schemaInputs(agent);
  for (const field of inputs) {
    const name = typeof field.name === "string" ? field.name.trim() : "";
    if (!name) continue;
    const required = field.required !== false;
    const value = input[name];
    if (required && (value === undefined || value === null || (typeof value === "string" && value.trim() === ""))) {
      throw new Error(`Missing required capability input: ${name}`);
    }
    if (value === undefined || value === null) continue;
    if (typeof field.type === "string" && !matchesType(value, field.type)) throw new Error(`Capability input ${name} must be of type ${field.type}`);
    if (Array.isArray(value) && value.length === 0 && required) throw new Error(`Capability input ${name} must contain at least one value`);
  }
}

async function resolveTestnetAgent(supabase: ReturnType<typeof serverClient>, agentIdentifier: string) {
  const query = supabase.from("agents").select("id,agent_id,name,category,owner,status,verification_status,metadata").eq("chain", "bsc-testnet");
  const result = UUID_RE.test(agentIdentifier) ? await query.eq("id", agentIdentifier).maybeSingle() : await query.eq("agent_id", agentIdentifier).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data as AgentRow | null;
}

async function paymentContext(wallet: Address) {
  const token = await publicClient.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "paymentToken" });
  const [decimals, symbol, balance] = await Promise.all([
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] }),
  ]);
  return { token, decimals: Number(decimals), symbol, balance: BigInt(balance) };
}

async function discoverQuoteOperation(endpoint: StoredEndpoint) {
  const operation = await resolveProviderOperation(endpoint, "quote");
  if (!operation) throw new Error(`Provider does not advertise a quote operation for ${endpoint.endpoint_url}. AgentMarket will not guess an execution contract for this provider.`);
  return operation;
}

function providerQuoteFromBody(body: unknown): ProviderQuote {
  const object = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const root = object(body);
  if (!root) throw new Error("Provider quote endpoint returned a non-object JSON response");

  const queue: unknown[] = [root];
  const visited = new Set<object>();
  const priceKeys = ["price_raw", "priceRaw", "raw_price", "amount_raw", "amountRaw", "settlement_amount_raw", "price"];
  const nestedKeys = ["quote", "data", "result", "response", "output", "operation_result"];

  while (queue.length > 0) {
    const candidate = queue.shift();
    const value = object(candidate);
    if (!value || visited.has(value)) continue;
    visited.add(value);

    if (priceKeys.some((key) => key in value)) return value as ProviderQuote;
    for (const key of nestedKeys) {
      const nested = value[key];
      if (nested && typeof nested === "object") queue.push(nested);
    }
  }

  throw new Error("Provider quote response did not expose a quote object with a supported price field");
}

async function requestProviderQuote(endpoint: StoredEndpoint, taskDescription: string, terms: Record<string, unknown>) {
  const operation = await discoverQuoteOperation(endpoint);
  const result = await invokeProviderOperation(operation, {
    task_description: taskDescription,
    goal: taskDescription,
    terms,
    chain_id: TESTNET_CHAIN_ID,
    network: "bsc-testnet",
    environment: TESTNET_ENVIRONMENT,
  });

  if (result.status < 200 || result.status >= 300) {
    const detail = result.body && typeof result.body === "object"
      ? JSON.stringify(result.body).slice(0, 320)
      : result.rawText.slice(0, 320);
    throw new Error(`Provider quote request failed with HTTP ${result.status} at ${operation.method} ${operation.endpoint}${detail ? `: ${detail}` : ""}`);
  }

  return { quote: providerQuoteFromBody(result.body), operation };
}

async function requestQuote(req: VercelRequest, res: VercelResponse, user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>) {
  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  const agentIdentifier = typeof req.body?.agent_id === "string" ? req.body.agent_id.trim() : "";
  const rawParameters = typeof req.body?.parameters === "object" && req.body.parameters !== null ? req.body.parameters : {};
  const requestMetadata = rawParameters as Record<string, unknown>;
  if (!goal || !agentIdentifier) return res.status(400).json({ error: "goal and agent_id are required" });

  const supabase = serverClient();
  const agent = await resolveTestnetAgent(supabase, agentIdentifier);
  if (!agent) return res.status(404).json({ error: "Testnet agent not found" });
  if (agent.verification_status === "revoked") return res.status(409).json({ error: "Agent identity is revoked" });
  if (!validAddress(agent.owner)) return res.status(409).json({ error: "Selected Testnet agent has no valid provider wallet" });
  validateRequestMetadata(agent, requestMetadata);

  const requesterWallet = user.user.wallet_address as Address;
  if (!validAddress(requesterWallet)) return res.status(400).json({ error: "Authenticated wallet address is invalid" });
  const providerWallet = agent.owner as Address;
  const payment = await paymentContext(requesterWallet);
  if (payment.balance <= 0n) return res.status(409).json({ error: `Your Testnet wallet has no ${payment.symbol} balance. Fund the Testnet settlement token before requesting a quote.` });

  const { data: endpoint, error: endpointError } = await supabase
    .from("agent_endpoints")
    .select("endpoint_url,protocol,status,last_checked_at,metadata")
    .eq("agent_id", agent.id)
    .order("last_checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (endpointError) throw new Error(endpointError.message);
  if (!endpoint?.endpoint_url || endpoint.status !== "online") return res.status(409).json({ error: "Testnet provider endpoint is not healthy", readiness: endpoint?.status ?? "missing" });

  const providerEndpoint = endpoint as StoredEndpoint;
  const maxBudgetRaw = payment.balance;
  const maxBudgetFormatted = formatUnits(maxBudgetRaw, payment.decimals);
  const boundParameters: Record<string, unknown> = {
    ...requestMetadata,
    provider_wallet: providerWallet,
    provider_agent_id: agent.agent_id,
    provider_chain_id: TESTNET_CHAIN_ID,
    settlement_token: payment.token,
    settlement_token_symbol: payment.symbol,
    settlement_token_decimals: payment.decimals,
    max_budget_raw: maxBudgetRaw.toString(),
    max_budget: maxBudgetFormatted,
  };

  const { quote: providerQuote, operation } = await requestProviderQuote(providerEndpoint, goal, boundParameters);
  if (providerQuote.accepted === false) return res.status(409).json({ error: "Provider declined the requested terms", provider_quote: providerQuote, quote_endpoint: operation.endpoint });
  const price = normalizedPrice(providerQuote, String(payment.token), payment.symbol, payment.decimals);
  const priceRaw = BigInt(price);
  if (priceRaw <= 0n) return res.status(409).json({ error: "Provider returned a non-positive quote" });
  if (priceRaw > payment.balance) return res.status(409).json({ error: `Provider quote is ${formatUnits(priceRaw, payment.decimals)} ${payment.symbol}, but your connected Testnet wallet has only ${formatUnits(payment.balance, payment.decimals)} ${payment.symbol}.`, price_raw: price, balance_raw: payment.balance.toString(), decimals: payment.decimals });

  const currency = normalizedCurrency(providerQuote.currency, payment.symbol);
  const expiresAt = normalizedExpiry(providerQuote.quote_expires_at, new Date(Date.now() + QUOTE_TTL_MS).toISOString());
  if (new Date(expiresAt).getTime() <= Date.now()) return res.status(409).json({ error: "Provider returned an already-expired quote" });

  const quoteId = crypto.randomUUID();
  const quoteHash = keccak256(stringToHex(canonicalQuotePayload({ quoteId, agentId: agent.id, requesterWallet, providerWallet, goal, price, currency, expiresAt, requestMetadata: boundParameters })));
  const { data: quote, error: quoteError } = await supabase.from("marketplace_quotes").insert({
    quote_id: quoteId,
    agent_id: agent.id,
    requester_wallet: requesterWallet,
    goal,
    request_metadata: boundParameters,
    price,
    currency,
    provider_quote: providerQuote,
    quote_hash: quoteHash,
    chain_id: TESTNET_CHAIN_ID,
    environment: TESTNET_ENVIRONMENT,
    status: "offered",
    provider_status_code: 200,
    expires_at: expiresAt,
  }).select("quote_id,agent_id,requester_wallet,goal,request_metadata,price,currency,provider_quote,quote_hash,status,expires_at").single();
  if (quoteError) throw new Error(quoteError.message);

  return res.status(200).json({
    ok: true,
    network: "bsc-testnet",
    chain_id: TESTNET_CHAIN_ID,
    environment: TESTNET_ENVIRONMENT,
    payment: { token: payment.token, symbol: payment.symbol, decimals: payment.decimals, balance_raw: payment.balance.toString(), balance_formatted: formatUnits(payment.balance, payment.decimals) },
    quote: { ...quote, price: formatUnits(priceRaw, payment.decimals), price_raw: price, price_formatted: formatUnits(priceRaw, payment.decimals) },
    provider: { agent_id: agent.agent_id, name: agent.name, wallet_address: providerWallet, category: agent.category, status: agent.status, verification_status: agent.verification_status, endpoint: providerEndpoint.endpoint_url, protocol: providerEndpoint.protocol },
    quote_operation: { endpoint: operation.endpoint, method: operation.method, transport: operation.transport, name: operation.name },
    signature_present: Boolean(providerQuote.provider_sig || providerQuote.provider_signature),
    next: "Accept this quote, then call the Testnet ERC-8183 prepare endpoint with quote_id.",
  });
}

async function acceptQuote(req: VercelRequest, res: VercelResponse, user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>) {
  const quoteId = typeof req.body?.quote_id === "string" ? req.body.quote_id.trim() : "";
  if (!quoteId) return res.status(400).json({ error: "quote_id is required" });
  const supabase = serverClient();
  const { data: quote, error } = await supabase.from("marketplace_quotes").select("quote_id,agent_id,requester_wallet,status,expires_at,quote_hash,chain_id,environment,request_metadata").eq("quote_id", quoteId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!quote) return res.status(404).json({ error: "Quote not found" });
  if (quote.chain_id !== TESTNET_CHAIN_ID || quote.environment !== TESTNET_ENVIRONMENT) return res.status(409).json({ error: "Quote is not a Testnet quote" });
  if (quote.requester_wallet.toLowerCase() !== user.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "Quote belongs to another wallet" });
  if (quote.status !== "offered") return res.status(409).json({ error: `Quote is ${quote.status}` });
  if (new Date(quote.expires_at).getTime() <= Date.now()) { await supabase.from("marketplace_quotes").update({ status: "expired" }).eq("quote_id", quoteId); return res.status(409).json({ error: "Quote has expired" }); }

  const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,owner,metadata,status,verification_status,chain").eq("id", quote.agent_id).maybeSingle();
  if (agentError) throw new Error(agentError.message);
  if (!agent || agent.chain !== "bsc-testnet" || !validAddress(agent.owner)) return res.status(409).json({ error: "Quoted provider is no longer a valid Testnet agent" });
  if (agent.verification_status === "revoked") return res.status(409).json({ error: "Quoted provider identity is revoked" });
  const quotedProvider = quote.request_metadata && typeof quote.request_metadata.provider_wallet === "string" ? quote.request_metadata.provider_wallet : "";
  if (!quotedProvider || quotedProvider.toLowerCase() !== agent.owner.toLowerCase()) return res.status(409).json({ error: "Quote provider binding is stale or invalid; request a new quote" });
  validateRequestMetadata(agent as AgentRow, quote.request_metadata && typeof quote.request_metadata === "object" ? quote.request_metadata as Record<string, unknown> : {});

  const { data: accepted, error: updateError } = await supabase.from("marketplace_quotes").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("quote_id", quoteId).eq("status", "offered").select("quote_id,agent_id,requester_wallet,goal,request_metadata,price,currency,provider_quote,quote_hash,status,expires_at,accepted_at").maybeSingle();
  if (updateError) throw new Error(updateError.message);
  if (!accepted) return res.status(409).json({ error: "Quote could not be accepted; it may have changed state" });
  const payment = await paymentContext(user.user.wallet_address as Address);
  const rawPrice = BigInt(accepted.price);
  const currency = normalizedCurrency(accepted.currency, payment.symbol);
  return res.status(200).json({ ok: true, network: "bsc-testnet", chain_id: TESTNET_CHAIN_ID, environment: TESTNET_ENVIRONMENT, quote: { ...accepted, currency, price: formatUnits(rawPrice, payment.decimals), price_raw: rawPrice.toString(), price_formatted: formatUnits(rawPrice, payment.decimals) }, provider: { wallet_address: agent.owner, agent_id: agent.agent_id }, payment: { symbol: payment.symbol, decimals: payment.decimals }, next: "Use quote_id with /api/testnet/prepare-quote to prepare the accepted Testnet job." });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });
  try {
    const action = typeof req.body?.action === "string" ? req.body.action : "request";
    if (action === "accept") return await acceptQuote(req, res, auth);
    if (action !== "request") return res.status(400).json({ error: "action must be request or accept" });
    return await requestQuote(req, res, auth);
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to process Testnet quote" }); }
}
