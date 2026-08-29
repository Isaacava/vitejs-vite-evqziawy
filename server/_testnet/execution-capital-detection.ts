import { parseUnits, type Address } from "viem";

export type DetectedCapitalRequest = {
  source: "stored_request" | "agent_request_endpoint" | "agent_capability";
  request_url: string | null;
  network: string | null;
  chain_id: number | null;
  token: Address;
  amount: string;
  amount_raw: string;
  symbol: string;
  decimals: number;
  token_out: Address | null;
  token_out_symbol: string | null;
  fee: number | null;
  target: Address | null;
  selector: string | null;
  recipient: Address | null;
  protocol: string | null;
  preflight_path: string | null;
  raw: Record<string, unknown>;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function address(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function positiveDecimal(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return String(value);
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  if (Number(normalized) <= 0) return null;
  return normalized;
}

function positiveRaw(value: unknown): string | null {
  if (typeof value === "bigint") return value > 0n ? value.toString() : null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) return null;
  try {
    const parsed = BigInt(normalized);
    return parsed > 0n ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function firstValue(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function candidateRequestObjects(document: unknown): Record<string, unknown>[] {
  const root = object(document);
  const candidates = [
    root.capital_request,
    root.execution_capital_request,
    root.requested_capital,
    root.execution_capital,
    root.capital,
    root,
  ];
  return candidates
    .filter((value) => value && typeof value === "object")
    .map((value) => object(value));
}

function findRequest(document: unknown, inheritedParent?: Record<string, unknown>) {
  const root = object(document);
  for (const request of candidateRequestObjects(root)) {
    const token = requestedToken(request, root);
    const amount = requestedAmount(request, root);
    if (token && amount) return { request, parent: root };
  }
  if (inheritedParent) {
    for (const request of candidateRequestObjects(inheritedParent)) {
      const token = requestedToken(request, inheritedParent);
      const amount = requestedAmount(request, inheritedParent);
      if (token && amount) return { request, parent: inheritedParent };
    }
  }
  return null;
}

function requestedToken(request: Record<string, unknown>, parent: Record<string, unknown>) {
  const value = firstValue(
    request.token,
    request.token_in,
    request.capital_token,
    request.asset,
    parent.token,
    parent.token_in,
    parent.capital_token,
  );
  return address(value) ? value : null;
}

function requestedAmount(request: Record<string, unknown>, parent: Record<string, unknown>) {
  const raw = firstValue(
    request.amount_raw,
    request.required_amount_raw,
    request.amount_in_raw,
    request.requested_amount_raw,
    parent.amount_raw,
    parent.required_amount_raw,
  );
  const rawAmount = positiveRaw(raw);
  if (rawAmount) return { amount: null, amount_raw: rawAmount };

  const decimal = positiveDecimal(firstValue(
    request.amount,
    request.required_amount,
    request.amount_in,
    request.requested_amount,
    request.quantity,
    parent.amount,
    parent.required_amount,
    parent.amount_in,
    parent.requested_amount,
    parent.quantity,
  ));
  return decimal ? { amount: decimal, amount_raw: null } : null;
}

function urlsFromAgent(agent: Record<string, unknown>, endpoints: Array<Record<string, unknown>>) {
  const metadata = object(agent.metadata);
  const execution = object(metadata.execution);
  const values = [
    metadata.execution_capital_request_url,
    metadata.execution_capital_requests_url,
    metadata.execution_capital_requirements_url,
    metadata.execution_capital_requirement_url,
    metadata.capital_request_url,
    metadata.capital_requests_url,
    execution.execution_capital_request_url,
    execution.execution_capital_requests_url,
    execution.execution_capital_requirements_url,
    execution.execution_capital_requirement_url,
    execution.capital_request_url,
    execution.capital_requests_url,
    ...endpoints.flatMap((endpoint) => {
      const endpointMetadata = object(endpoint.metadata);
      return [
        endpointMetadata.execution_capital_request_url,
        endpointMetadata.execution_capital_requests_url,
        endpointMetadata.execution_capital_requirements_url,
        endpointMetadata.execution_capital_requirement_url,
        endpointMetadata.capital_request_url,
        endpointMetadata.capital_requests_url,
      ];
    }),
  ];
  return [...new Set(values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim()))];
}

function conventionalUrls(baseUrls: string[]) {
  const output: string[] = [];
  for (const base of baseUrls) {
    try {
      const url = new URL(base);
      const basePath = url.pathname.replace(/\/+$/, "");
      for (const path of ["/execution-capital-request", "/execution-capital", "/capital-request"]) {
        const candidate = new URL(url.toString());
        candidate.pathname = `${basePath}${path}`;
        candidate.search = "";
        output.push(candidate.toString());
      }
    } catch {
      // Ignore invalid provider-declared URLs.
    }
  }
  return [...new Set(output)];
}

async function fetchJson(url: string, jobId: string) {
  const parsed = new URL(url);
  parsed.searchParams.set("job_id", jobId);
  parsed.searchParams.set("job", jobId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 64 * 1024) throw new Error("response too large");
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function detectAgentCapitalRequest(options: {
  agent: Record<string, unknown>;
  endpoints: Array<Record<string, unknown>>;
  capability: Record<string, unknown>;
  jobId: string;
  storedRequests?: Array<Record<string, unknown>>;
  readToken: (token: Address) => Promise<{ symbol: string; decimals: number }>;
}): Promise<DetectedCapitalRequest> {
  const { agent, endpoints, capability, jobId, readToken, storedRequests = [] } = options;

  const storedMatch = storedRequests
    .map((stored) => {
      const found = findRequest(stored);
      return found ? { ...found, stored } : null;
    })
    .find((value): value is { stored: Record<string, unknown>; request: Record<string, unknown>; parent: Record<string, unknown> } => Boolean(value));

  const baseUrls = [
    ...urlsFromAgent(agent, endpoints),
    ...endpoints.map((endpoint) => typeof endpoint.endpoint_url === "string" ? endpoint.endpoint_url.trim() : ""),
  ].filter(Boolean);

  const endpointUrls = [...new Set([...urlsFromAgent(agent, endpoints), ...conventionalUrls(baseUrls)])];
  const endpointFailures: string[] = [];

  let endpointMatch: { url: string; request: Record<string, unknown>; parent: Record<string, unknown> } | null = null;
  for (const url of endpointUrls) {
    try {
      const body = object(await fetchJson(url, jobId));
      const found = findRequest(body);
      if (found) {
        endpointMatch = { url, request: found.request, parent: found.parent };
        break;
      }
    } catch (error) {
      endpointFailures.push(`${url}: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }

  const capabilityMatch = findRequest(capability);

  const selected = endpointMatch
    ? { source: "agent_request_endpoint" as const, requestUrl: endpointMatch.url, parent: endpointMatch.parent, request: endpointMatch.request }
    : storedMatch
      ? { source: "stored_request" as const, requestUrl: null, parent: storedMatch.parent, request: storedMatch.request }
      : capabilityMatch
        ? { source: "agent_capability" as const, requestUrl: null, parent: capabilityMatch.parent, request: capabilityMatch.request }
        : null;

  if (!selected) {
    throw new Error(`Agent has not published an execution-capital request for job ${jobId}${endpointFailures.length ? `; checked ${endpointFailures.length} endpoint(s)` : ""}`);
  }

  const token = requestedToken(selected.request, selected.parent);
  const amountInfo = requestedAmount(selected.request, selected.parent);
  if (!token || !amountInfo) throw new Error("Agent capital request is missing a valid token or amount");

  const metadata = object(agent.metadata);
  const tokenMeta = await readToken(token);
  const decimalAmount = amountInfo.amount ?? undefined;
  const rawAmount = amountInfo.amount_raw ?? (decimalAmount ? parseUnits(decimalAmount, tokenMeta.decimals).toString() : null);
  if (!rawAmount || BigInt(rawAmount) <= 0n) throw new Error("Agent capital request amount is invalid");

  const request = selected.request;
  const tokenOut = firstValue(request.token_out, selected.parent.token_out);
  const target = firstValue(request.target, request.router, request.to, selected.parent.target, selected.parent.router, selected.parent.to);
  const selector = firstValue(request.selector, request.function_selector, selected.parent.selector, selected.parent.function_selector);
  const recipient = firstValue(request.recipient, request.execution_wallet, selected.parent.recipient, selected.parent.execution_wallet);
  const feeValue = firstValue(request.fee, request.pool_fee, selected.parent.fee, selected.parent.pool_fee);
  const protocolValue = firstValue(request.protocol, selected.parent.protocol, capability.protocol, object(metadata.execution).protocol);
  const preflightValue = firstValue(request.preflight_path, selected.parent.preflight_path, capability.preflight_path);

  return {
    source: selected.source,
    request_url: selected.requestUrl,
    network: typeof firstValue(request.network, selected.parent.network, capability.network) === "string" ? String(firstValue(request.network, selected.parent.network, capability.network)) : null,
    chain_id: Number(firstValue(request.chain_id, request.chainId, selected.parent.chain_id, selected.parent.chainId, capability.chainId)) || null,
    token,
    amount: decimalAmount ?? "0",
    amount_raw: rawAmount,
    symbol: tokenMeta.symbol,
    decimals: tokenMeta.decimals,
    token_out: address(tokenOut) ? tokenOut : null,
    token_out_symbol: typeof firstValue(request.token_out_symbol, selected.parent.token_out_symbol) === "string" ? String(firstValue(request.token_out_symbol, selected.parent.token_out_symbol)) : null,
    fee: Number.isInteger(Number(feeValue)) ? Number(feeValue) : null,
    target: address(target) ? target : null,
    selector: typeof selector === "string" && /^0x[a-fA-F0-9]{8}$/.test(selector) ? selector : null,
    recipient: address(recipient) ? recipient : null,
    protocol: typeof protocolValue === "string" && protocolValue.trim() ? protocolValue.trim().toLowerCase() : null,
    preflight_path: typeof preflightValue === "string" && preflightValue.trim().startsWith("/") ? preflightValue.trim() : null,
    raw: selected.request,
  };
}
