import type { Address } from "viem";
import { invokeProviderOperation, resolveProviderOperation } from "./provider-operation.js";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 64 * 1024;

type EndpointRecord = {
  endpoint_url: string;
  protocol: string;
  status: string;
  metadata?: unknown;
  version?: string | null;
};

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

async function dispatchDeclaredPreflight(
  request: Record<string, unknown>,
  input: GridPreflightInput,
) {
  const capability = object(object(request.evidence).execution_capability);
  const sourceUrl = typeof capability.source_url === "string" ? capability.source_url.trim() : "";
  if (!sourceUrl) throw new Error("Execution adapter has no provider capability source URL");

  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Execution capability source URL is not HTTP(S)");
  }

  const endpoint: EndpointRecord = {
    endpoint_url: parsed.toString(),
    protocol: typeof capability.protocol === "string" && capability.protocol.trim()
      ? capability.protocol.trim()
      : "http",
    status: "online",
    metadata: capability,
  };

  const operation = await resolveProviderOperation(endpoint, "preflight");
  if (!operation) throw new Error("Provider has not declared or exposed a preflight operation");

  const body: Record<string, unknown> = {
    ...input,
    chain_id: 97,
    network: "bsc-testnet",
    request_id: typeof request.id === "string" ? request.id : typeof request.request_id === "string" ? request.request_id : undefined,
  };

  const result = await invokeProviderOperation(operation, body);
  const raw = result.rawText || "";
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new Error("Execution adapter response is too large");
  }

  return object(result.body);
}

export async function runGridPreflight(request: Record<string, unknown>, input: GridPreflightInput, _protocol = "pancake-v3-swap") {
  return dispatchDeclaredPreflight(request, input);
}
