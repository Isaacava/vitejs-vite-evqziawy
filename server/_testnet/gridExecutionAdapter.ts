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
    throw new Error("This Testnet execution adapter requires the Grid agent's verified scoped-session execution capability");
  }
}

function executorPreflightUrl(request: Record<string, unknown>) {
  const configured = process.env.GRID_EXECUTION_ENDPOINT_URL?.trim() || "";
  if (configured) return `${configured.replace(/\/+$/, "")}/preflight/pancake`;

  const capability = object(object(request.evidence).execution_capability);
  const sourceUrl = typeof capability.source_url === "string" ? capability.source_url.trim() : "";
  if (!sourceUrl) throw new Error("Grid execution adapter has no configured endpoint or capability source URL");
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Grid execution capability source URL is not HTTP(S)");
  parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/execution-capabilities$/, "") + "/preflight/pancake";
  parsed.search = "";
  return parsed.toString();
}

async function dispatch(url: string, input: GridPreflightInput) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new Error("Grid executor response is too large");
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

export async function runGridPreflight(request: Record<string, unknown>, input: GridPreflightInput) {
  return dispatch(executorPreflightUrl(request), input);
}
