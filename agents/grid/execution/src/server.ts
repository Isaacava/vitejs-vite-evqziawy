import { createServer, type IncomingMessage } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { BNB_TESTNET } from "@altananetwork/sdk";
import { executeConfiguredGridAction, executeGridAction, configuredSessionDescriptor, deriveJobSessionPrivateKey } from "./altanaExecutor.js";
import { pancakeSwapPreflight } from "./preflight.js";
import { buildPancakeTestnetConfig } from "./pancakeSwap.js";
import { observeTestnetReceipt } from "./receipt.js";
import { getExecutionReadiness } from "./readiness.js";
import type { GridCall, GridSessionDescriptor } from "./types.js";

const PORT = Number(process.env.GRID_EXECUTION_PORT || 8788);
const SESSION_PRIVATE_KEY = process.env.ALTANA_SESSION_PRIVATE_KEY || "";

function json(res: import("node:http").ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("access-control-allow-origin", process.env.GRID_CORS_ORIGIN || "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "Content-Type, Accept, Authorization, X-ERC8183-Job-Id");
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
  if (
    typeof input.walletAddress !== "string" ||
    typeof input.agentSessionAddress !== "string" ||
    typeof input.agentSessionPublicKey !== "string"
  ) throw new Error("Invalid session descriptor identity");
  if (!Array.isArray(input.allowedCalls)) throw new Error("allowedCalls is required");

  return {
    walletAddress: input.walletAddress as GridSessionDescriptor["walletAddress"],
    agentSessionAddress: input.agentSessionAddress as GridSessionDescriptor["agentSessionAddress"],
    agentSessionPublicKey: input.agentSessionPublicKey as GridSessionDescriptor["agentSessionPublicKey"],
    allowedCalls: input.allowedCalls.map(String) as GridSessionDescriptor["allowedCalls"],
    allowedSelectors: Array.isArray(input.allowedSelectors) ? input.allowedSelectors.map(String) : undefined,
    spendLimit: BigInt(String(input.spendLimit)),
    spendToken: typeof input.spendToken === "string" ? input.spendToken as GridSessionDescriptor["spendToken"] : undefined,
    nativeSpendLimit: input.nativeSpendLimit !== undefined
      ? BigInt(String(input.nativeSpendLimit))
      : 20_000_000_000_000_000n,
    expiry: Number(input.expiry),
  };
}

function calls(value: unknown): GridCall[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("calls must be a non-empty array");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid call entry");
    const call = item as Record<string, unknown>;
    if (typeof call.to !== "string" || typeof call.data !== "string") {
      throw new Error("Each call needs to and data");
    }
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

function executionConfigState() {
  return {
    session_private_key_configured: Boolean(SESSION_PRIVATE_KEY),
    altana_wallet_address_configured: Boolean(process.env.ALTANA_WALLET_ADDRESS),
    altana_session_expiry_configured: Boolean(process.env.ALTANA_SESSION_EXPIRY),
    altana_session_native_spend_limit_configured:
      /^\d+$/.test(process.env.ALTANA_SESSION_NATIVE_SPEND_LIMIT || "20000000000000000") &&
      BigInt(process.env.ALTANA_SESSION_NATIVE_SPEND_LIMIT || "20000000000000000") > 0n,
    allowed_targets_configured: configuredList(process.env.GRID_ALLOWED_TARGETS || "").length > 0,
    allowed_selectors_configured: configuredList(process.env.GRID_ALLOWED_SELECTORS || "").length > 0,
    pancake_router_configured: Boolean(process.env.PANCAKE_TESTNET_ROUTER),
  };
}

function jobIdFromRequest(req: IncomingMessage, input?: Record<string, unknown>): number | undefined {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const raw = url.searchParams.get("job_id") || req.headers["x-erc8183-job-id"] || (typeof input?.job_id === "string" || typeof input?.job_id === "number" ? String(input.job_id) : "");
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("job_id must be a positive integer");
  return value;
}

async function publicExecutionCapabilities(req: IncomingMessage) {
  const configured = executionConfigState();
  const market = buildPancakeTestnetConfig();
  const jobId = jobIdFromRequest(req);
  const base = {
    ok: true,
    network: "bsc-testnet",
    chainId: 97,
    execution: "altana-scoped-session",
    wallet_provider: "altana",
    authorization_model: "scoped_session",
    protocol: "pancake-v3-swap",
    execution_market: {
      token_in: market.tokenIn,
      token_out: market.tokenOut,
      token_in_symbol: market.tokenInSymbol,
      token_out_symbol: market.tokenOutSymbol,
      fee: market.fee,
    },
    preflight_path: "/preflight/pancake",
    allowed_targets: configuredList(process.env.GRID_ALLOWED_TARGETS || ""),
    allowed_selectors: configuredList(process.env.GRID_ALLOWED_SELECTORS || ""),
    selectors_required: true,
    private_key_exposed: false,
    configuration: configured,
    execution_wallet_mode: "user-granted-wallet",
    session_scope: jobId ? "request-scoped" : "job-required",
    job_id: jobId || null,
  };

  if (!SESSION_PRIVATE_KEY) return { ...base, execution_ready: false };

  const sessionPrivateKey = jobId ? deriveJobSessionPrivateKey(jobId) : SESSION_PRIVATE_KEY;
  const account = privateKeyToAccount(
    (sessionPrivateKey.startsWith("0x") ? sessionPrivateKey : `0x${sessionPrivateKey}`) as `0x${string}`,
  );

  return {
    ...base,
    execution_ready: true,
    session_key_address: account.address,
    session_key_public_key: account.publicKey,
    authorization_check: {
      wallet_address: process.env.ALTANA_WALLET_ADDRESS || null,
      session_key_id: account.address,
      keystore_authorized: "checked_at_execution",
    },
  };
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      return json(res, 204, null);
    }
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, { ...(await publicExecutionCapabilities(req)), service: "Grid Agent Altana Execution", chain: BNB_TESTNET.id });
    }
    if (req.method === "GET" && req.url?.startsWith("/execution-capabilities")) {
      return json(res, 200, await publicExecutionCapabilities(req));
    }
    if (req.method === "GET" && req.url === "/execution-readiness") {
      return json(res, 200, await getExecutionReadiness());
    }
    if (req.method === "POST" && req.url === "/preflight/pancake") {
      const request = await body(req) as Record<string, unknown>;
      return json(res, 200, { ok: true, result: await pancakeSwapPreflight(request) });
    }
    if (req.method === "GET" && req.url?.startsWith("/receipt/")) {
      if (!SESSION_PRIVATE_KEY) return json(res, 503, { error: "Grid execution service is not configured" });
      const hash = decodeURIComponent(req.url.slice("/receipt/".length)).split("?", 1)[0];
      if (!hash) return json(res, 400, { error: "transaction hash is required" });
      return json(res, 200, { ok: true, result: await observeTestnetReceipt(hash) });
    }
    if (req.method === "POST" && req.url === "/execute-configured") {
      if (!SESSION_PRIVATE_KEY) return json(res, 503, { error: "Grid execution key derivation secret is not configured" });
      const request = await body(req) as Record<string, unknown>;
      const jobId = jobIdFromRequest(req, request);
      if (jobId === undefined) return json(res, 400, { error: "job_id is required for standalone Grid execution" });
      return json(res, 200, { ok: true, result: await executeConfiguredGridAction(calls(request.calls), jobId) });
    }
    if (req.method !== "POST" || req.url !== "/execute") {
      return json(res, 404, { error: "Not found" });
    }
    if (!SESSION_PRIVATE_KEY) return json(res, 503, { error: "Grid execution key derivation secret is not configured" });
    const request = await body(req) as Record<string, unknown>;
    const jobId = jobIdFromRequest(req, request);
    if (jobId === undefined) return json(res, 400, { error: "job_id is required for standalone Grid execution" });
    const session = descriptor(request.session);
    const sessionPrivateKey = deriveJobSessionPrivateKey(jobId);
    const expected = configuredSessionDescriptor(jobId);
    if (expected.agentSessionAddress.toLowerCase() !== session.agentSessionAddress.toLowerCase()) {
      throw new Error("Session descriptor does not match the job-scoped Grid signing key");
    }
    return json(res, 200, { ok: true, result: await executeGridAction(session, calls(request.calls), sessionPrivateKey) });
  } catch (error) {
    console.error("Grid Altana execution request failed", error);
    return json(res, 400, { ok: false, error: error instanceof Error ? error.message : "Execution request failed" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Grid Altana execution service listening on ${PORT} (localhost / BSC Testnet / chain 97)`);
});
