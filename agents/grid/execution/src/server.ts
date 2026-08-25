import { createServer } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { executeGridAction } from "./altanaExecutor.js";
import type { GridCall, GridSessionDescriptor } from "./types.js";

const PORT = Number(process.env.PORT || 8788);
const SHARED_SECRET = process.env.GRID_EXECUTION_SHARED_SECRET || "";
const SESSION_PRIVATE_KEY = process.env.ALTANA_SESSION_PRIVATE_KEY || "";

if (!SHARED_SECRET) throw new Error("GRID_EXECUTION_SHARED_SECRET is required");
if (!SESSION_PRIVATE_KEY) throw new Error("ALTANA_SESSION_PRIVATE_KEY is required");

function json(res: import("node:http").ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

async function body(req: import("node:http").IncomingMessage) {
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

function publicExecutionCapabilities() {
  const account = privateKeyToAccount((SESSION_PRIVATE_KEY.startsWith("0x") ? SESSION_PRIVATE_KEY : `0x${SESSION_PRIVATE_KEY}`) as `0x${string}`);
  return {
    ok: true,
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
  };
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, publicExecutionCapabilities());
    }

    if (req.method === "GET" && req.url === "/execution-capabilities") {
      return json(res, 200, publicExecutionCapabilities());
    }

    if (req.method !== "POST" || req.url !== "/execute") {
      return json(res, 404, { error: "Not found" });
    }

    if (req.headers.authorization !== `Bearer ${SHARED_SECRET}`) {
      return json(res, 401, { error: "Unauthorized" });
    }

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
