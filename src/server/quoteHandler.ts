import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { keccak256, stringToBytes } from "viem";
import { getAuthenticatedUser } from "./authHandlers.js";

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function negotiateUrl(endpointUrl: string) {
  const endpoint = new URL(endpointUrl);
  if (endpoint.protocol !== "https:") throw new Error("Provider endpoint must use HTTPS");
  const host = endpoint.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || /^127\./.test(host) || host === "::1" || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
    throw new Error("Provider endpoint must use a public hostname");
  }

  const path = endpoint.pathname.replace(/\/$/, "");
  if (path.endsWith("/negotiate")) return endpoint.toString();
  if (path.endsWith("/status") || path.endsWith("/health")) {
    endpoint.pathname = path.slice(0, path.lastIndexOf("/")) + "/negotiate";
    return endpoint.toString();
  }
  if (path.endsWith("/erc8183")) {
    endpoint.pathname = `${path}/negotiate`;
    return endpoint.toString();
  }
  endpoint.pathname = `${path}/erc8183/negotiate`;
  return endpoint.toString();
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function quoteHash(quote: { quote_id: string; agent_id: string; requester_wallet: string; goal: string; price: string; currency: string; expires_at: string }) {
  const canonical = JSON.stringify({
    quote_id: quote.quote_id,
    agent_id: quote.agent_id,
    requester_wallet: quote.requester_wallet.toLowerCase(),
    goal: quote.goal,
    price: quote.price,
    currency: quote.currency,
    expires_at: quote.expires_at,
  });
  return keccak256(stringToBytes(canonical));
}

export async function quoteHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Wallet authentication required" });

  const action = asString(req.body?.action, "request").toLowerCase();

  try {
    const supabase = db();

    if (action === "accept") {
      const quoteId = asString(req.body?.quote_id);
      if (!quoteId) return res.status(400).json({ error: "quote_id is required" });

      const { data: quote, error: quoteError } = await supabase
        .from("marketplace_quotes")
        .select("quote_id,agent_id,requester_wallet,goal,price,currency,provider_quote,status,requested_at,expires_at")
        .eq("quote_id", quoteId)
        .maybeSingle();
      if (quoteError) throw new Error(quoteError.message);
      if (!quote) return res.status(404).json({ error: "Quote not found" });
      if (quote.requester_wallet.toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "Quote belongs to a different wallet" });
      if (quote.status !== "offered") return res.status(409).json({ error: `Quote is ${quote.status}, not offered` });
      if (new Date(quote.expires_at).getTime() <= Date.now()) {
        await supabase.from("marketplace_quotes").update({ status: "expired", updated_at: new Date().toISOString() }).eq("quote_id", quoteId);
        return res.status(409).json({ error: "Quote has expired" });
      }

      const acceptedAt = new Date().toISOString();
      const acceptedHash = quoteHash({
        quote_id: quote.quote_id,
        agent_id: quote.agent_id,
        requester_wallet: quote.requester_wallet,
        goal: quote.goal,
        price: quote.price,
        currency: quote.currency,
        expires_at: quote.expires_at,
      });

      const { data: accepted, error: updateError } = await supabase
        .from("marketplace_quotes")
        .update({ status: "accepted", accepted_at: acceptedAt, quote_hash: acceptedHash, updated_at: acceptedAt })
        .eq("quote_id", quoteId)
        .eq("requester_wallet", auth.user.wallet_address)
        .eq("status", "offered")
        .select("quote_id,agent_id,requester_wallet,goal,price,currency,provider_quote,status,expires_at,accepted_at,quote_hash")
        .single();
      if (updateError) throw new Error(updateError.message);

      return res.status(200).json({
        ok: true,
        quote: accepted,
        next: "create_and_fund_erc8183_job",
      });
    }

    const agentId = asString(req.body?.agent_id);
    const goal = asString(req.body?.goal);
    const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};
    const maxBudget = asString(req.body?.max_budget);
    if (!agentId || !goal) return res.status(400).json({ error: "agent_id and goal are required" });

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id,agent_id,name,owner,verification_status,status")
      .eq("agent_id", agentId)
      .maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ error: "Agent not found in the indexed marketplace" });
    if (agent.verification_status === "revoked") return res.status(409).json({ error: "Agent identity is revoked" });

    const { data: endpoint, error: endpointError } = await supabase
      .from("agent_endpoints")
      .select("endpoint_url,protocol,status,last_checked_at")
      .eq("agent_id", agent.id)
      .eq("protocol", "erc8183")
      .order("last_checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (endpointError) throw new Error(endpointError.message);
    if (!endpoint?.endpoint_url) return res.status(409).json({ error: "Agent has no ERC-8183 provider endpoint" });
    if (endpoint.status !== "online") return res.status(409).json({ error: "Agent provider endpoint is not currently healthy" });

    const quoteId = crypto.randomUUID();
    const requestedAt = new Date();
    const negotiationEndpoint = negotiateUrl(endpoint.endpoint_url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let providerResponse: Response;
    try {
      providerResponse = await fetch(negotiationEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          job: {
            agent_id: agent.agent_id,
            goal,
            description: goal,
            max_budget: maxBudget || undefined,
            metadata,
          },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await providerResponse.text();
    let providerQuote: unknown = null;
    try {
      providerQuote = text ? JSON.parse(text) : null;
    } catch {
      providerQuote = { raw: text.slice(0, 4000) };
    }

    if (!providerResponse.ok) {
      await supabase.from("marketplace_quotes").insert({
        quote_id: quoteId,
        agent_id: agent.id,
        requester_wallet: auth.user.wallet_address,
        goal,
        request_metadata: metadata,
        price: "",
        currency: "",
        status: "rejected",
        provider_status_code: providerResponse.status,
        provider_quote: providerQuote,
        requested_at: requestedAt.toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      return res.status(409).json({ error: "Provider declined the quote request", quote_id: quoteId, provider_status: providerResponse.status, provider_response: providerQuote });
    }

    const normalized = providerQuote && typeof providerQuote === "object" ? providerQuote as Record<string, unknown> : {};
    const price = asString(normalized.price ?? normalized.amount ?? normalized.budget ?? normalized.service_price);
    const currency = asString(normalized.currency ?? normalized.payment_token ?? normalized.token, "provider settlement token");
    const quoteExpires = asString(normalized.expires_at ?? normalized.expiration ?? normalized.valid_until);
    const expiresAt = quoteExpires ? new Date(quoteExpires) : new Date(Date.now() + 15 * 60 * 1000);
    if (!price) throw new Error("Provider quote did not include a price");
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new Error("Provider returned an invalid quote expiry");

    const quote = {
      quote_id: quoteId,
      agent_id: agent.id,
      requester_wallet: auth.user.wallet_address,
      goal,
      request_metadata: metadata,
      price,
      currency,
      provider_quote: providerQuote,
      status: "offered",
      provider_status_code: providerResponse.status,
      requested_at: requestedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    const { error: insertError } = await supabase.from("marketplace_quotes").insert(quote);
    if (insertError) throw new Error(insertError.message);

    return res.status(200).json({ ok: true, quote: { ...quote, endpoint: negotiationEndpoint } });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Provider negotiation failed" });
  }
}
