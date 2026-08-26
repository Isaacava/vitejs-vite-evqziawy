import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Address, Hex } from "viem";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 64 * 1024;

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

    const capability = object(object(request.evidence).execution_capability);
    const allowedTargets = Array.isArray(capability.allowed_targets) ? capability.allowed_targets.filter(isAddress) : [];
    const allowedSelectors = Array.isArray(capability.allowed_selectors) ? capability.allowed_selectors.filter((value): value is string => typeof value === "string") : [];
    if (allowedTargets.length === 0 || allowedSelectors.length === 0) return res.status(409).json({ error: "Stored execution capability has no usable target/selector scope" });

    const preflightInput: Record<string, unknown> = {
      router: input.router,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      recipient: input.recipient || request.user_execution_wallet,
      fee: input.fee,
      amountIn: input.amountIn,
      amountOutMinimum: input.amountOutMinimum ?? "0",
    };
    if (preflightInput.router === undefined || preflightInput.router === null || preflightInput.router === "") {
      if (allowedTargets.length === 1) preflightInput.router = allowedTargets[0];
      else return res.status(400).json({ error: "router is required when the provider capability advertises multiple target contracts" });
    }
    if (!isAddress(preflightInput.router)) return res.status(400).json({ error: "router must be a valid EVM address" });
    if (!allowedTargets.some((target) => target.toLowerCase() === String(preflightInput.router).toLowerCase())) {
      return res.status(409).json({ error: "Requested PancakeSwap router is outside the verified provider capability target allowlist" });
    }

    const response = await dispatch(executorPreflightUrl(request as Record<string, unknown>), preflightInput);
    const result = object(response.result);
    if (result.broadcast !== false) return res.status(502).json({ error: "Grid preflight did not prove that no transaction was broadcast" });
    if (typeof result.selector !== "string" || !isHex(result.selector) || !allowedSelectors.includes(selectorOf(result.selector))) {
      return res.status(409).json({ error: "Grid preflight produced a function selector outside the verified provider capability scope" });
    }

    return res.status(200).json({
      ok: true,
      request_id: requestId,
      chain_id: 97,
      capability_scope: {
        allowed_targets: allowedTargets,
        allowed_selectors: allowedSelectors,
      },
      preflight: result,
      note: "Read-only preflight completed through the private Grid executor. No transaction was broadcast.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected PancakeSwap preflight error";
    const status = /required|must|invalid|outside|authorized|configured|scope/i.test(message) ? 409 : 500;
    return res.status(status).json({ error: message });
  }
}
