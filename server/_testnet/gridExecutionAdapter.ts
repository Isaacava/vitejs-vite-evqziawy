import type { Address } from "viem";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 64 * 1024;

export type GridPreflightInput = {
  router: Address;
  tokenIn: Address;
  tokenOut: Address;
  recipient: Address;
  fee: number;
  amountIn: string;
  amountOutMinimum: string;
};

function object(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function assertGridExecutionCapability(capability: Record<string, unknown>) {
  if (capability.execution !== "altana-scoped-session" || capability.wallet_provider !== "altana" || capability.authorization_model !== "scoped_session") {
    throw new Error("This Testnet execution adapter requires an agent's verified Altana scoped-session execution capability");
  }
}

const PROTOCOL_PREFLIGHT_PATHS: Record<string, string> = {
  "pancake-v3-swap": "/preflight/pancake",
};
const DEFAULT_PREFLIGHT_PATH = "/preflight";

function executorPreflightUrl(request: Record<string, unknown>, protocol: string) {
  const preflightPath = PROTOCOL_PREFLIGHT_PATHS[protocol] || DEFAULT_PREFLIGHT_PATH;
  const configured = process.env.GRID_EXECUTION_ENDPOINT_URL?.trim() || "";
  if (configured) return `${configured.replace(/\/+$/, "")}${preflightPath}`;

  const capability = object(object(request.evidence).execution_capability);
  const declaredPath = typeof capability.preflight_path === "string" ? capability.preflight_path.trim() : "";
  const sourceUrl = typeof capability.source_url === "string" ? capability.source_url.trim() : "";
  if (!sourceUrl) throw new Error("Execution adapter has no configured endpoint or capability source URL");
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Execution capability source URL is not HTTP(S)");
  const path = declaredPath && declaredPath.startsWith("/") ? declaredPath : preflightPath;
  parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/execution-capabilities$/, "") + path;
  parsed.search = "";
  return parsed.toString();
}

async function dispatch(url: string, input: GridPreflightInput, requestId?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (requestId) headers["x-agentmarket-request-id"] = requestId;
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(input), signal: controller.signal });
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new Error("Execution adapter response is too large");
    let body: Record<string, unknown> = {};
    try { body = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { body = { raw }; }
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Execution preflight returned HTTP ${response.status}`);
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Testnet execution preflight timed out");
    throw error instanceof Error ? error : new Error("Testnet execution preflight failed");
  } finally {
    clearTimeout(timeout);
  }
}

export async function runGridPreflight(request: Record<string, unknown>, input: GridPreflightInput, protocol = "pancake-v3-swap") {
  const requestId = typeof request.id === "string" ? request.id : typeof request.request_id === "string" ? request.request_id : undefined;
  return dispatch(executorPreflightUrl(request, protocol), input, requestId);
}
