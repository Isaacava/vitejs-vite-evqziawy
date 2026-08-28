import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_CALLS = 8;
const DEFAULT_NATIVE_GAS_SPEND_LIMIT_WEI = 20_000_000_000_000_000n;

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]*$/.test(value);
}

function isSelector(value: string) {
  return /^0x[a-fA-F0-9]{8}$/.test(value.slice(0, 10));
}

function selectorOf(data: string) {
  return data.slice(0, 10).toLowerCase();
}

function object(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

async function readJson(req: VercelRequest) {
  if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
  let raw = "";
  for await (const chunk of req) {
    raw += String(chunk);
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new Error("Execution request body is too large");
  }
  return JSON.parse(raw || "{}") as Record<string, unknown>;
}

function capabilityFromRequest(request: Record<string, unknown>) {
  const evidence = object(request.evidence);
  const capability = object(evidence.execution_capability);
  const sessionExpiry = Number(evidence.session_expiry);

  if (capability.network !== "bsc-testnet" || Number(capability.chainId) !== 97) throw new Error("Stored execution capability is not BSC Testnet");
  if (capability.execution !== "altana-scoped-session" || capability.wallet_provider !== "altana" || capability.authorization_model !== "scoped_session") throw new Error("Stored execution capability is not an Altana scoped-session descriptor");
  if (capability.private_key_exposed !== false) throw new Error("Stored execution capability is not private-key safe");
  if (!isAddress(capability.session_key_address) || !isHex(capability.session_key_public_key)) throw new Error("Stored execution capability has invalid session identity");
  if (!Array.isArray(capability.allowed_targets) || capability.allowed_targets.length === 0 || !capability.allowed_targets.every(isAddress)) throw new Error("Stored execution capability has no valid target allowlist");
  if (!Array.isArray(capability.allowed_selectors) || capability.allowed_selectors.length === 0 || !capability.allowed_selectors.every((value) => typeof value === "string" && isSelector(value))) throw new Error("Stored execution capability has no valid selector allowlist");
  if (!Number.isInteger(sessionExpiry) || sessionExpiry <= Math.floor(Date.now() / 1000)) throw new Error("Verified Altana session has expired");

  // capital_authorized/capital_requested are stored in human-readable token
  // units (e.g. "1" meaning 1 U), not raw wei — see execution-capital.ts,
  // where capital_requested is set to String(TESTNET_EXECUTION_CAPITAL_MAX).
  // The on-chain grant (src/lib/altanaSession.ts) authorized
  // capitalAmount * 10 ** decimals raw units, so the executor's spend
  // permission must be scaled the same way or its reconstructed session
  // permissions won't match what was actually registered on-chain.
  const humanAmountRaw = String(request.capital_authorized ?? request.capital_requested ?? "");
  if (!/^\d+(\.\d+)?$/.test(humanAmountRaw) || Number(humanAmountRaw) <= 0) {
    throw new Error("Authorized execution capital must be a positive numeric amount");
  }
  const decimals = Number.isInteger(request.capital_decimals) && Number(request.capital_decimals) > 0
    ? BigInt(request.capital_decimals as number)
    : 18n;
  const [wholePart, fractionPart = ""] = humanAmountRaw.split(".");
  const fraction = (fractionPart + "0".repeat(Number(decimals))).slice(0, Number(decimals));
  const spendRaw = (BigInt(wholePart) * 10n ** decimals + BigInt(fraction || "0")).toString();
  if (BigInt(spendRaw) <= 0n) throw new Error("Authorized execution capital must be a positive integer raw amount");

  // capital_token is a top-level column on execution_capital_requests, not
  // nested under evidence — check it first (matching execution-capital-preflight.ts
  // and ExecutionCapitalLivePanel.tsx), falling back to evidence for older rows.
  const spendToken = typeof request.capital_token === "string" && isAddress(request.capital_token)
    ? request.capital_token
    : typeof evidence.capital_token === "string" && isAddress(evidence.capital_token)
      ? evidence.capital_token
      : undefined;
  if (!spendToken) throw new Error("Execution-capital request has no valid capital_token to scope the spend permission to");

  return {
    walletAddress: request.user_execution_wallet,
    agentSessionAddress: capability.session_key_address,
    agentSessionPublicKey: capability.session_key_public_key,
    allowedCalls: capability.allowed_targets,
    allowedSelectors: capability.allowed_selectors,
    spendLimit: BigInt(spendRaw),
    spendToken,
    nativeSpendLimit: DEFAULT_NATIVE_GAS_SPEND_LIMIT_WEI,
    expiry: sessionExpiry,
  };
}

function validateCalls(raw: unknown, allowedTargets: readonly Address[], allowedSelectors: readonly string[]) {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("calls must be a non-empty array");
  if (raw.length > MAX_CALLS) throw new Error(`calls cannot contain more than ${MAX_CALLS} entries`);

  const targets = new Set(allowedTargets.map((value) => value.toLowerCase()));
  const selectors = new Set(allowedSelectors.map((value) => value.toLowerCase()));

  return raw.map((item) => {
    const call = object(item);
    if (!isAddress(call.to)) throw new Error("Each execution call requires a valid target address");
    if (!isHex(call.data) || !isSelector(call.data)) throw new Error(`Call ${call.to} requires calldata beginning with a 4-byte selector`);
    if (!targets.has(call.to.toLowerCase())) throw new Error(`Target ${call.to} is outside the verified provider capability scope`);
    if (!selectors.has(selectorOf(call.data))) throw new Error(`Function selector ${selectorOf(call.data)} is outside the verified provider capability scope`);

    let value: bigint | undefined;
    if (call.value !== undefined && call.value !== null) {
      const rawValue = String(call.value);
      if (!/^\d+$/.test(rawValue)) throw new Error(`Call ${call.to} has an invalid native value`);
      value = BigInt(rawValue);
    }

    return {
      to: call.to as Address,
      data: call.data as Hex,
      ...(value === undefined ? {} : { value }),
    };
  });
}

async function executorUrl(request: Record<string, unknown>) {
  const evidence = object(request.evidence);
  const configured = typeof process.env.GRID_EXECUTION_ENDPOINT_URL === "string" ? process.env.GRID_EXECUTION_ENDPOINT_URL.trim() : "";
  if (configured) return configured.replace(/\/$/, "") + "/execute";

  const sourceUrl = typeof evidence.execution_capability === "object" && evidence.execution_capability
    ? String(object(evidence.execution_capability).source_url || "")
    : "";
  if (!sourceUrl) throw new Error("Grid execution endpoint is not configured and no capability source URL is stored");

  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Grid execution capability source URL is not HTTP(S)");
  parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/execution-capabilities$/, "") + "/execute";
  parsed.search = "";
  return parsed.toString();
}

async function dispatchToExecutor(url: string, session: unknown, calls: unknown[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ session, calls }, (_, value) => typeof value === "bigint" ? value.toString() : value),
      signal: controller.signal,
    });
    const raw = await response.text();
    let body: Record<string, unknown> = {};
    try { body = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { body = { raw }; }
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Grid executor returned HTTP ${response.status}`);
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Grid execution service timed out");
    throw error instanceof Error ? error : new Error("Grid execution service request failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function receiptFor(hash: string | null) {
  if (!hash || !isHex(hash)) return null;
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    return {
      transaction_hash: receipt.transactionHash,
      block_number: receipt.blockNumber.toString(),
      block_hash: receipt.blockHash,
      status: receipt.status,
      gas_used: receipt.gasUsed.toString(),
      effective_gas_price: receipt.effectiveGasPrice.toString(),
      contract_address: receipt.contractAddress,
    };
  } catch {
    return null;
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

    const { data: job, error: jobError } = await supabase.from("jobs").select("id,client_wallet,mission_task_id,chain_job_id").eq("id", request.job_id).maybeSingle();
    if (jobError) return res.status(500).json({ error: jobError.message });
    if (!job || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "You do not own this execution-capital request" });

    if (request.status !== "authorized" && request.status !== "active") {
      return res.status(409).json({ error: `Execution capital request must be authorized before execution; current status is ${request.status}` });
    }
    if (!request.authorization_verified_at || !request.session_key_id || !request.user_execution_wallet || !request.agent_session_key) {
      return res.status(409).json({ error: "Execution-capital request is missing independently verified session identity" });
    }

    const session = capabilityFromRequest(request as Record<string, unknown>);
    if (String(session.agentSessionAddress).toLowerCase() !== String(request.agent_session_key).toLowerCase()) return res.status(409).json({ error: "Stored session key does not match the provider capability" });
    if (String(session.walletAddress).toLowerCase() !== String(request.user_execution_wallet).toLowerCase()) return res.status(409).json({ error: "Stored execution wallet does not match the authorized session wallet" });

    const calls = validateCalls(input.calls, session.allowedCalls as readonly Address[], session.allowedSelectors as readonly string[]);
    const endpoint = await executorUrl(request as Record<string, unknown>);
    const execution = await dispatchToExecutor(endpoint, session, calls);
    const result = object(execution.result);
    const transactionHash = typeof result.transactionHash === "string" && isHex(result.transactionHash) ? result.transactionHash : null;
    const receipt = await receiptFor(transactionHash);
    const now = new Date().toISOString();
    const previousEvidence = object(request.evidence);
    const executions = Array.isArray(previousEvidence.executions) ? previousEvidence.executions : [];
    const executionEvidence = {
      execution_id: typeof input.execution_id === "string" ? input.execution_id.trim() : crypto.randomUUID(),
      requested_at: now,
      executor_url: endpoint,
      calls: calls.map((call) => ({ to: call.to, selector: selectorOf(call.data), data: call.data, value: call.value?.toString() || "0" })),
      calls_id: typeof result.callsId === "string" ? result.callsId : null,
      transaction_hash: transactionHash,
      executor_status: typeof result.status === "string" ? result.status : null,
      receipt,
      receipt_verified: Boolean(receipt),
      chain_id: 97,
      source: "grid_testnet_execution_adapter",
    };

    const nextEvidence = {
      ...previousEvidence,
      last_execution: executionEvidence,
      executions: [...executions.slice(-9), executionEvidence],
    };
    const nextStatus = transactionHash ? "active" : request.status;
    const { data: updated, error: updateError } = await supabase.from("execution_capital_requests").update({
      status: nextStatus,
      activated_at: request.activated_at || now,
      evidence: nextEvidence,
      updated_at: now,
    }).eq("id", requestId).select("*").single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    const executionId = executionEvidence.execution_id as string;
    const { error: evidenceError } = await supabase.from("execution_capital_execution_evidence").upsert({
      execution_capital_request_id: request.id,
      job_id: job.id,
      chain_id: 97,
      execution_id: executionId,
      calls_id: executionEvidence.calls_id,
      executor_status: executionEvidence.executor_status,
      transaction_hash: transactionHash,
      receipt,
      receipt_verified: Boolean(receipt),
      calls: executionEvidence.calls,
      source: "grid_testnet_execution_adapter",
    }, { onConflict: "execution_capital_request_id,execution_id" });
    if (evidenceError) return res.status(500).json({ error: evidenceError.message });

    let missionId: string | null = null;
    if (job.mission_task_id) {
      const { data: task } = await supabase.from("mission_tasks").select("mission_id").eq("id", job.mission_task_id).maybeSingle();
      missionId = task?.mission_id || null;
    }
    if (job.mission_task_id) {
      await supabase.from("user_activity").insert({
        user_id: auth.user.id,
        mission_id: missionId,
        job_id: job.id,
        type: "execution_capital_execute",
        title: "Execution-capital call dispatched",
        description: transactionHash ? `Grid execution returned transaction ${transactionHash}.` : "Grid execution was dispatched without a mined transaction receipt yet.",
      });
    }

    return res.status(200).json({
      ok: true,
      request: updated,
      execution: executionEvidence,
      note: receipt ? "Execution receipt observed on BSC Testnet and stored as independent execution evidence." : "Execution service accepted the call but a receipt is not yet observable; capital/P&L remain unreported.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected execution bridge error";
    const status = /required|must|invalid|outside|expired|missing|does not match|status is/i.test(message) ? 409 : 500;
    return res.status(status).json({ error: message });
  }
}
