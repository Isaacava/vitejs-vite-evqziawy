import { createServer, type IncomingMessage } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { executeGridAction } from "./altanaExecutor.js";
import { pancakeSwapPreflight } from "./preflight.js";
import type { GridCall, GridSessionDescriptor } from "./types.js";

const PORT = Number(process.env.PORT || 8788);
const SHARED_SECRET = process.env.GRID_EXECUTION_SHARED_SECRET || "";
const SESSION_PRIVATE_KEY = process.env.ALTANA_SESSION_PRIVATE_KEY || "";

function json(res: import("node:http").ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

async function body(req: IncomingMessage) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 128 * 1024) throw new Error("Request body too large");
  }
  return JSON.parse(raw || "{}");
}

function descriptor(value: unknown): GridSessionDescriptor {
  if (!value || typeof value !== "object") throw new Error("session descriptor is required");
  const input = value as Record<string, unknown>;
  if (typeof input.walletAddress !== "string" || typeof input.agentSessionAddress !== "string" || typeof input.agentSessionPublicKey !== "string") throw new Error("Invalid session descriptor identity");
  if (!Array.isArray(input.allowedCalls)) throw new Error("allowedCalls is required");
  const spendLimit = BigInt(String(input.spendLimit));
  const expiry = Number(input.expiry);
  return {
    walletAddress: input.walletAddress as GridSessionDescriptor["walletAddress"],
    agentSessionAddress: input.agentSessionAddress as GridSessionDescriptor["agentSessionAddress"],
    agentSessionPublicKey: input.agentSessionPublicKey as GridSessionDescriptor["agentSessionPublicKey"],
    allowedCalls: input.allowedCalls.map(String) as GridSessionDescriptor["allowedCalls"],
    allowedSelectors: Array.isArray(input.allowedSelectors) ? input.allowedSelectors.map(String) : undefined,
    spendLimit,
    spendToken: typeof input.spendToken === "string" ? input.spendToken as GridSessionDescriptor["spendToken"] : undefined,
    expiry,
  };
}

function calls(value: unknown): GridCall[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("calls must be a non-empty array");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid call entry");
    const call = item as Record<string, unknown>;
    if (typeof call.to !== "string" || typeof call.data !== "string") throw new Error("Each call needs to and data");
    return {
      to: call.to as GridCall["to"],
      data: call.data as GridCall["data"],
      value: call.value === undefined ? undefined : BigInt(String(call.value)),
    };
  });
}

function configuredList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function authorized(req: IncomingMessage) {
  return Boolean(SHARED_SECRET) && req.headers.authorization === `Bearer ${SHARED_SECRET}`;
}

function executionConfigState() {
  return {
    shared_secret_configured: Boolean(SHARED_SECRET),
    session_private_key_configured: Boolean(SESSION_PRIVATE_KEY),
    allowed_targets_configured: configuredList(process.env.GRID_ALLOWED_TARGETS || "").length > 0,
    allowed_selectors_configured: configuredList(process.env.GRID_ALLOWED_SELECTORS || "").length > 0,
    pancake_router_configured: Boolean(process.env.PANCAKE_TESTNET_ROUTER),
  };
}

function publicExecutionCapabilities() {
  const configured = executionConfigState();
  if (!configured.session_private_key_configured) {
    return {
      ok: true,
      execution_ready: false,
      network: "bsc-testnet",
      chainId: 97,
      execution: "altana-scoped-session",
      wallet_provider: "altana",
      authorization_model: "scoped_session",
      allowed_targets: configuredList(process.env.GRID_ALLOWED_TARGETS || ""),
      allowed_selectors: configuredList(process.env.GRID_ALLOWED_SELECTORS || ""),
      selectors_required: true,
      private_key_exposed: false,
      configuration: configured,
    };
  }

  const account = privateKeyToAccount((SESSION_PRIVATE_KEY.startsWith("0x") ? SESSION_PRIVATE_KEY : `0x${SESSION_PRIVATE_KEY}`) as `0x${string}`);
  return {
    ok: true,
    execution_ready: configured.shared_secret_configured && configured.allowed_targets_configured && configured.allowed_selectors_configured && configured.pancake_router_configured,
    network: "bsc-testnet",
    chainId: 97,
    execution: "altana-scoped-session",
    wallet_provider: "altana",
    authorization_model: "scoped_session",
    session_key_address: account.address,
    session_key_public_key: account.publicKey,
    allowed_targets: configuredList(process.env.GRID_ALLOWED_TARGETS || ""),
    allowed_selectors: configuredList(process.env.GRID_ALLOWED_SELECTORS || ""),
    selectors_required: true,
    private_key_exposed: false,
    configuration: configured,
  };
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, {
        ...publicExecutionCapabilities(),
        service: "AgentMarket Grid Altana Execution",
      });
    }

    if (req.method === "GET" && req.url === "/execution-capabilities") {
      return json(res, 200, publicExecutionCapabilities());
    }

    if (req.method === "POST" && req.url === "/preflight/pancake") {
      if (!authorized(req)) return json(res, 401, { error: "Unauthorized" });
      if (!SESSION_PRIVATE_KEY || !SHARED_SECRET) return json(res, 503, { error: "Grid execution service is not configured" });
      const request = await body(req) as Record<string, unknown>;
      const result = await pancakeSwapPreflight(request);
      return json(res, 200, { ok: true, result });
    }

    if (req.method !== "POST" || req.url !== "/execute") {
      return json(res, 404, { error: "Not found" });
    }

    if (!authorized(req)) return json(res, 401, { error: "Unauthorized" });
    if (!SESSION_PRIVATE_KEY) return json(res, 503, { error: "ALTANA_SESSION_PRIVATE_KEY is not configured" });

    const request = await body(req) as Record<string, unknown>;
    const session = descriptor(request.session);
    const proposedCalls = calls(request.calls);
    const result = await executeGridAction(session, proposedCalls, SESSION_PRIVATE_KEY);
    return json(res, 200, { ok: true, result });
  } catch (error) {
    console.error("Grid Altana execution request failed", error);
    return json(res, 400, { ok: false, error: error instanceof Error ? error.message : "Execution request failed" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Grid Altana execution service listening on ${PORT} (BSC Testnet / chain 97)`);
});
