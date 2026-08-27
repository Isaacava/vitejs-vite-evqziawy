import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Address, Hex } from "viem";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 64 * 1024;
const TESTNET_CHAIN_ID = 97;
const TESTNET_U_TOKEN = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as Address;
const TESTNET_WBNB_TOKEN = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as Address;
const CONTROLLED_FEE = 2500;
const CONTROLLED_CAPITAL_RAW = 1_000_000_000_000_000_000n;

function object(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]*$/.test(value);
}

function selectorOf(value: string) {
  return value.slice(0, 10).toLowerCase();
}

function rawInteger(value: unknown, field: string, positive = false) {
  const text = typeof value === "string" ? value.trim() : String(value ?? "");
  if (!/^\d+$/.test(text)) throw new Error(`${field} must be an integer raw amount`);
  const parsed = BigInt(text);
  if (positive && parsed <= 0n) throw new Error(`${field} must be greater than zero`);
  return parsed;
}

async function readJson(req: VercelRequest) {
  if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
  let raw = "";
  for await (const chunk of req) {
    raw += String(chunk);
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new Error("Preflight request body is too large");
  }
  return JSON.parse(raw || "{}") as Record<string, unknown>;
}

function executorPreflightUrl(request: Record<string, unknown>) {
  const configured = process.env.GRID_EXECUTION_ENDPOINT_URL?.trim() || "";
  if (configured) return `${configured.replace(/\/+$/, "")}/preflight/pancake`;

  const capability = object(object(request.evidence).execution_capability);
  const sourceUrl = typeof capability.source_url === "string" ? capability.source_url.trim() : "";
  if (!sourceUrl) throw new Error("Grid execution endpoint is not configured and no capability source URL is stored");
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Grid execution capability source URL is not HTTP(S)");
  parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/execution-capabilities$/, "") + "/preflight/pancake";
  parsed.search = "";
  return parsed.toString();
}

async function dispatch(url: string, input: Record<string, unknown>) {
  const secret = process.env.GRID_EXECUTION_SHARED_SECRET?.trim() || "";
  if (!secret) throw new Error("GRID_EXECUTION_SHARED_SECRET is not configured on AgentMarket");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input, (_, value) => typeof value === "bigint" ? value.toString() : value),
      signal: controller.signal,
    });
    const raw = await response.text();
    let body: Record<string, unknown> = {};
    try { body = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { body = { raw }; }
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Grid preflight returned HTTP ${response.status}`);
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Grid PancakeSwap preflight timed out");
    throw error instanceof Error ? error : new Error("Grid PancakeSwap preflight failed");
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const input = await readJson(req);
    const requestId = typeof input.request_id === "string" ? input.request_id.trim() : "";
    if (!requestId) return res.status(400).json({ error: "request_id is required" });

    const supabase = serverClient();
    const { data: request, error: requestError } = await supabase.from("execution_capital_requests").select("*").eq("id", requestId).maybeSingle();
    if (requestError) return res.status(500).json({ error: requestError.message });
    if (!request) return res.status(404).json({ error: "Execution capital request not found" });

    const { data: job, error: jobError } = await supabase.from("jobs").select("id,client_wallet").eq("id", request.job_id).maybeSingle();
    if (jobError) return res.status(500).json({ error: jobError.message });
    if (!job || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ error: "You do not own this execution-capital request" });
    }
    if (request.status !== "authorized" && request.status !== "active") {
      return res.status(409).json({ error: `Execution capital request must be authorized before PancakeSwap preflight; current status is ${request.status}` });
    }
    if (!request.authorization_verified_at || !request.session_key_id || !request.user_execution_wallet || !request.agent_session_key) {
      return res.status(409).json({ error: "Execution-capital request is missing independently verified session identity" });
    }

    const executionWallet = request.user_execution_wallet as Address;
    const authenticatedWallet = auth.user.wallet_address as Address;

    const evidence = object(request.evidence);
    const capability = object(evidence.execution_capability);
    const allowedTargets = Array.isArray(capability.allowed_targets) ? capability.allowed_targets.filter(isAddress) : [];
    const allowedSelectors = Array.isArray(capability.allowed_selectors) ? capability.allowed_selectors.filter((value): value is string => typeof value === "string") : [];
    if (allowedTargets.length === 0 || allowedSelectors.length === 0) return res.status(409).json({ error: "Stored execution capability has no usable target/selector scope" });
    if (capability.network !== "bsc-testnet" || Number(capability.chainId) !== TESTNET_CHAIN_ID) return res.status(409).json({ error: "Stored execution capability is not BSC Testnet" });
    if (capability.execution !== "altana-scoped-session" || capability.wallet_provider !== "altana" || capability.authorization_model !== "scoped_session") return res.status(409).json({ error: "Stored execution capability is not an Altana scoped-session descriptor" });

    const expectedTokenIn = typeof request.capital_token === "string" && isAddress(request.capital_token)
      ? request.capital_token as Address
      : typeof evidence.capital_token === "string" && isAddress(evidence.capital_token)
        ? evidence.capital_token as Address
        : TESTNET_U_TOKEN;
    const expectedCapital = CONTROLLED_CAPITAL_RAW;

    const requestedTokenIn = input.tokenIn;
    const requestedTokenOut = input.tokenOut;
    const requestedAmountIn = rawInteger(input.amountIn, "amountIn", true);
    const requestedMinimumOut = rawInteger(input.amountOutMinimum ?? "0", "amountOutMinimum");
    const requestedFee = rawInteger(input.fee, "fee", true);
    const recipient = input.recipient || executionWallet;

    if (!isAddress(authenticatedWallet)) return res.status(403).json({ error: "Authenticated wallet identity is invalid" });
    if (!isAddress(executionWallet)) return res.status(409).json({ error: "Verified execution wallet identity is invalid" });
    if (!isAddress(requestedTokenIn)) return res.status(400).json({ error: "tokenIn must be a valid EVM address" });
    if (requestedTokenIn.toLowerCase() !== expectedTokenIn.toLowerCase()) return res.status(409).json({ error: "tokenIn must match the authorized execution-capital token" });
    if (!isAddress(requestedTokenOut)) return res.status(400).json({ error: "tokenOut must be a valid EVM address" });
    if (requestedTokenOut.toLowerCase() !== TESTNET_WBNB_TOKEN.toLowerCase()) return res.status(409).json({ error: "Controlled Testnet proof requires WBNB as tokenOut" });
    if (requestedAmountIn > expectedCapital) return res.status(409).json({ error: "amountIn must not exceed the authorized 1 U capital" });
    if (requestedMinimumOut < 0n) return res.status(400).json({ error: "amountOutMinimum must be a non-negative raw integer" });
    if (requestedFee !== BigInt(CONTROLLED_FEE)) return res.status(409).json({ error: `Controlled Testnet proof requires pool fee ${CONTROLLED_FEE}` });
    if (!isAddress(recipient)) return res.status(400).json({ error: "recipient must be a valid EVM address" });
    if (recipient.toLowerCase() !== executionWallet.toLowerCase()) return res.status(409).json({ error: "recipient must equal the independently verified execution wallet" });

    const routerInput = input.router;
    if (routerInput !== undefined && routerInput !== null && routerInput !== "" && !isAddress(routerInput)) return res.status(400).json({ error: "router must be a valid EVM address" });
    const router = routerInput || (allowedTargets.length === 1 ? allowedTargets[0] : undefined);
    if (!isAddress(router)) return res.status(400).json({ error: "router must be a valid EVM address" });
    if (!allowedTargets.some((target) => target.toLowerCase() === router.toLowerCase())) return res.status(409).json({ error: "Requested PancakeSwap router is outside the verified provider capability target allowlist" });

    const response = await dispatch(executorPreflightUrl(request as Record<string, unknown>), {
      router,
      tokenIn: requestedTokenIn,
      tokenOut: requestedTokenOut,
      recipient,
      fee: Number(requestedFee),
      amountIn: requestedAmountIn.toString(),
      amountOutMinimum: requestedMinimumOut.toString(),
    });
    const result = object(response.result);
    if (result.broadcast !== false) return res.status(502).json({ error: "Grid preflight did not prove that no transaction was broadcast" });
    if (typeof result.selector !== "string" || !isHex(result.selector) || !allowedSelectors.includes(selectorOf(result.selector))) {
      return res.status(409).json({ error: "Grid preflight produced a function selector outside the verified provider capability scope" });
    }

    return res.status(200).json({
      ok: true,
      request_id: requestId,
      chain_id: TESTNET_CHAIN_ID,
      authenticated_wallet: authenticatedWallet,
      execution_wallet: executionWallet,
      capability_scope: {
        allowed_targets: allowedTargets,
        allowed_selectors: allowedSelectors,
        authorized_token_in: expectedTokenIn,
        authorized_capital_raw: expectedCapital.toString(),
        controlled_token_out: TESTNET_WBNB_TOKEN,
        controlled_fee: CONTROLLED_FEE,
      },
      preflight: result,
      note: "Read-only preflight completed through the private Grid executor. No transaction was broadcast.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected PancakeSwap preflight error";
    const status = /required|must|invalid|outside|authorized|configured|scope|capital|token|recipient|fee|wallet/i.test(message) ? 409 : 500;
    return res.status(status).json({ error: message });
  }
}
