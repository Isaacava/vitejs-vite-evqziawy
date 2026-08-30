import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
import { assertGridExecutionCapability, runGridPreflight, type GridPreflightInput } from "./gridExecutionAdapter.js";

const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_CALLS = 8;
const DEFAULT_NATIVE_GAS_SPEND_LIMIT_WEI = 20_000_000_000_000_000n;
const TESTNET_WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as Address;
const DEFAULT_PANCAKE_FEE = 2500;

function isAddress(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function isHex(value: unknown): value is Hex { return typeof value === "string" && /^0x[a-fA-F0-9]*$/.test(value); }
function isSelector(value: string) { return /^0x[a-fA-F0-9]{8}$/.test(value.slice(0, 10)); }
function selectorOf(data: string) { return data.slice(0, 10).toLowerCase(); }
function object(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }

async function readJson(req: VercelRequest) {
  if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
  let raw = "";
  for await (const chunk of req) { raw += String(chunk); if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new Error("Execution request body is too large"); }
  return JSON.parse(raw || "{}") as Record<string, unknown>;
}

function capabilityFromRequest(request: Record<string, unknown>) {
  const evidence = object(request.evidence);
  const capability = object(evidence.execution_capability);
  const sessionExpiry = Number(evidence.session_expiry);
  if (capability.network !== "bsc-testnet" || Number(capability.chainId) !== 97) throw new Error("Stored execution capability is not BSC Testnet");
  assertGridExecutionCapability(capability);
  if (capability.private_key_exposed !== false) throw new Error("Stored execution capability is not private-key safe");
  if (!isAddress(capability.session_key_address) || !isHex(capability.session_key_public_key)) throw new Error("Stored execution capability has invalid session identity");
  if (!Array.isArray(capability.allowed_targets) || capability.allowed_targets.length === 0 || !capability.allowed_targets.every(isAddress)) throw new Error("Stored execution capability has no valid target allowlist");
  if (!Array.isArray(capability.allowed_selectors) || capability.allowed_selectors.length === 0 || !capability.allowed_selectors.every((value) => typeof value === "string" && isSelector(value))) throw new Error("Stored execution capability has no valid selector allowlist");
  if (!Number.isInteger(sessionExpiry) || sessionExpiry <= Math.floor(Date.now() / 1000)) throw new Error("Verified Altana session has expired");

  const humanAmount = String(request.capital_authorized ?? request.capital_requested ?? "");
  if (!/^\d+(\.\d+)?$/.test(humanAmount) || Number(humanAmount) <= 0) throw new Error("Authorized execution capital must be a positive numeric amount");
  const decimals = Number.isInteger(request.capital_decimals) && Number(request.capital_decimals) >= 0 ? BigInt(request.capital_decimals as number) : 18n;
  const [wholePart, fractionPart = ""] = humanAmount.split(".");
  const fraction = (fractionPart + "0".repeat(Number(decimals))).slice(0, Number(decimals));
  const spendLimit = BigInt(wholePart) * 10n ** decimals + BigInt(fraction || "0");
  if (spendLimit <= 0n) throw new Error("Authorized execution capital must be a positive integer raw amount");
  const spendToken = isAddress(request.capital_token) ? request.capital_token : isAddress(object(evidence).capital_token) ? object(evidence).capital_token as Address : undefined;
  if (!spendToken) throw new Error("Execution-capital request has no valid capital_token to scope the spend permission to");

  return {
    walletAddress: request.user_execution_wallet,
    agentSessionAddress: capability.session_key_address,
    agentSessionPublicKey: capability.session_key_public_key,
    allowedCalls: capability.allowed_targets,
    allowedSelectors: capability.allowed_selectors,
    spendLimit,
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
    const value = call.value === undefined || call.value === null ? undefined : String(call.value);
    if (value !== undefined && !/^\d+$/.test(value)) throw new Error(`Call ${call.to} has an invalid native value`);
    return { to: call.to as Address, data: call.data as Hex, ...(value === undefined ? {} : { value: BigInt(value) }) };
  });
}

function sourceBase(request: Record<string, unknown>) {
  const sourceUrl = String(object(object(request.evidence).execution_capability).source_url || "").trim();
  if (!sourceUrl) throw new Error("Grid execution capability source URL is not stored");
  const parsed = new URL(sourceUrl);
  if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("Grid execution capability source URL is not HTTP(S)");
  parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/execution-capabilities$/, "");
  parsed.search = "";
  return parsed;
}

function executorUrl(request: Record<string, unknown>) {
  const configured = process.env.GRID_EXECUTION_ENDPOINT_URL?.trim();
  if (configured) return `${configured.replace(/\/+$/, "")}/execute`;
  const parsed = sourceBase(request);
  parsed.pathname += "/execute";
  return parsed.toString();
}

function submitUrl(request: Record<string, unknown>) {
  const parsed = sourceBase(request);
  parsed.pathname += "/submit-execution";
  return parsed.toString();
}

async function dispatchToExecutor(url: string, requestId: string, session: unknown, calls: unknown[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "x-agentmarket-request-id": requestId }, body: JSON.stringify({ session, calls }, (_, value) => typeof value === "bigint" ? value.toString() : value), signal: controller.signal });
    const raw = await response.text();
    let body: Record<string, unknown> = {};
    try { body = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { body = { raw }; }
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : typeof body.detail === "string" ? body.detail : `Grid executor returned HTTP ${response.status}`);
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Grid execution service timed out");
    throw error instanceof Error ? error : new Error("Grid execution service request failed");
  } finally { clearTimeout(timeout); }
}

async function providerSubmit(request: Record<string, unknown>, requestId: string, jobId: number, transactionHash: string) {
  const response = await fetch(submitUrl(request), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "x-agentmarket-request-id": requestId }, body: JSON.stringify({ job_id: jobId, transaction_hash: transactionHash }) });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try { body = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { body = { raw }; }
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : typeof body.error === "string" ? body.error : `Grid provider submission returned HTTP ${response.status}`);
  return body;
}

async function receiptFor(hash: string) {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex });
    return { transaction_hash: receipt.transactionHash, block_number: receipt.blockNumber.toString(), block_hash: receipt.blockHash, status: receipt.status, gas_used: receipt.gasUsed.toString(), effective_gas_price: receipt.effectiveGasPrice.toString(), contract_address: receipt.contractAddress };
  } catch { return null; }
}

function existingExecution(request: Record<string, unknown>) {
  const evidence = object(request.evidence);
  const last = object(evidence.last_execution);
  if (isHex(last.transaction_hash)) return last;
  const executions = Array.isArray(evidence.executions) ? evidence.executions : [];
  return [...executions].reverse().map(object).find((item) => isHex(item.transaction_hash)) || null;
}

async function deriveCall(request: Record<string, unknown>, session: ReturnType<typeof capabilityFromRequest>, input: Record<string, unknown>) {
  const evidence = object(request.evidence);
  const capability = object(evidence.execution_capability);
  const market = object(capability.execution_market);
  const router = isAddress(market.router) ? market.router : session.allowedCalls.find((value) => value.toLowerCase() !== session.spendToken.toLowerCase());
  if (!isAddress(router)) throw new Error("Grid could not identify the PancakeSwap router inside the provider capability scope");
  const tokenOut = isAddress(input.tokenOut) ? input.tokenOut : isAddress(market.token_out) ? market.token_out : TESTNET_WBNB;
  const fee = Number.isInteger(Number(input.fee)) ? Number(input.fee) : Number.isInteger(Number(market.fee)) ? Number(market.fee) : DEFAULT_PANCAKE_FEE;
  const amountIn = /^\d+$/.test(String(input.amountIn ?? "")) ? String(input.amountIn) : session.spendLimit.toString();
  const amountOutMinimum = /^\d+$/.test(String(input.amountOutMinimum ?? "")) ? String(input.amountOutMinimum) : process.env.GRID_TESTNET_AMOUNT_OUT_MINIMUM_RAW?.trim() || "0";
  const preflightInput: GridPreflightInput = { router, tokenIn: session.spendToken, tokenOut, recipient: session.walletAddress, fee, amountIn, amountOutMinimum };
  const response = await runGridPreflight(request, preflightInput, "pancake-v3-swap");
  const result = object(response.result);
  const call = object(result.call);
  if (!isAddress(call.to) || !isHex(call.data)) throw new Error("Grid preflight did not return executable calldata");
  return { call, preflight: result };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
    const input = await readJson(req);
    const requestId = typeof input.request_id === "string" ? input.request_id.trim() : "";
    if (!requestId) return res.status(400).json({ error: "request_id is required" });

    const supabase = serverClient();
    const { data: request, error: requestError } = await supabase.from("execution_capital_requests").select("*").eq("id", requestId).maybeSingle();
    if (requestError) return res.status(500).json({ error: requestError.message });
    if (!request) return res.status(404).json({ error: "Execution capital request not found" });
    const { data: job, error: jobError } = await supabase.from("jobs").select("id,client_wallet,chain_job_id").eq("id", request.job_id).maybeSingle();
    if (jobError) return res.status(500).json({ error: jobError.message });
    if (!job || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "You do not own this execution-capital request" });
    if (!request.chain_job_id && !job.chain_job_id) throw new Error("The ERC-8183 chain job has not been created yet");
    const chainJobId = Number(job.chain_job_id || request.chain_job_id);
    const chainJob = await publicClient.readContract({ address: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address, abi: [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" }] }] }] as const, functionName: "getJob", args: [BigInt(chainJobId)] });
    if (Number(chainJob.status) !== 1) return res.status(409).json({ error: `Execution requires a funded ERC-8183 job; live status is ${Number(chainJob.status)}` });

    const session = capabilityFromRequest(request as Record<string, unknown>);
    if (String(session.walletAddress).toLowerCase() !== String(request.user_execution_wallet).toLowerCase()) throw new Error("Stored execution wallet does not match the authorized session wallet");
    if (String(session.agentSessionAddress).toLowerCase() !== String(request.agent_session_key).toLowerCase()) throw new Error("Stored provider session key does not match the verified Grid capability");
    const prior = existingExecution(request as Record<string, unknown>);
    if (prior) return res.status(200).json({ ok: true, request, execution: prior, note: "Execution already recorded; duplicate broadcast prevented." });

    let calls: ReturnType<typeof validateCalls>;
    if (Array.isArray(input.calls) && input.calls.length > 0) calls = validateCalls(input.calls, session.allowedCalls as readonly Address[], session.allowedSelectors as readonly string[]);
    else calls = validateCalls([object((await deriveCall(request as Record<string, unknown>, session, input)).call)], session.allowedCalls as readonly Address[], session.allowedSelectors as readonly string[]);

    const endpoint = executorUrl(request as Record<string, unknown>);
    const execution = await dispatchToExecutor(endpoint, request.id, session, calls);
    const result = object(execution.result);
    const transactionHash = typeof result.transactionHash === "string" && isHex(result.transactionHash) ? result.transactionHash : null;
    if (!transactionHash) throw new Error("Grid execution returned without a transaction hash");
    const receipt = await receiptFor(transactionHash);
    const evidence = object(request.evidence);
    const executionEvidence = { execution_id: typeof input.execution_id === "string" ? input.execution_id.trim() : crypto.randomUUID(), requested_at: new Date().toISOString(), executor_url: endpoint, calls: calls.map((call) => ({ to: call.to, selector: selectorOf(call.data), data: call.data, value: call.value?.toString() || "0" })), calls_id: typeof result.callsId === "string" ? result.callsId : null, transaction_hash: transactionHash, executor_status: typeof result.status === "string" ? result.status : null, receipt, receipt_verified: Boolean(receipt && String(receipt.status).toLowerCase() === "success"), chain_id: 97, source: "grid_testnet_execution_adapter" };

    let submission: Record<string, unknown> | null = null;
    if (executionEvidence.receipt_verified) submission = await providerSubmit(request as Record<string, unknown>, request.id, chainJobId, transactionHash);

    const nextEvidence = { ...evidence, last_execution: executionEvidence, executions: [...(Array.isArray(evidence.executions) ? evidence.executions : []).slice(-9), executionEvidence], ...(submission ? { last_submission: { submitted_at: new Date().toISOString(), submission_tx_hash: submission.submission_tx_hash || null, execution_transaction_hash: transactionHash, source: "agentmarket_execution_bridge" } } : {}) };
    const { data: updated, error: updateError } = await supabase.from("execution_capital_requests").update({ status: transactionHash ? "active" : request.status, activated_at: request.activated_at || new Date().toISOString(), evidence: nextEvidence, updated_at: new Date().toISOString() }).eq("id", requestId).select("*").single();
    if (updateError) return res.status(500).json({ error: updateError.message });

    const { error: evidenceError } = await supabase.from("execution_capital_execution_evidence").upsert({ request_id: request.id, execution_capital_request_id: request.id, job_id: job.id, chain_id: 97, execution_id: executionEvidence.execution_id, calls_id: executionEvidence.calls_id, executor_status: executionEvidence.executor_status, transaction_hash: transactionHash, receipt, receipt_verified: executionEvidence.receipt_verified, calls: executionEvidence.calls, source: "grid_testnet_execution_adapter" }, { onConflict: "execution_capital_request_id,execution_id" });
    if (evidenceError) return res.status(500).json({ error: evidenceError.message });

    return res.status(200).json({ ok: true, request: updated, execution: executionEvidence, submission, note: submission ? "Execution receipt verified and ERC-8183 submission dispatched." : "Execution accepted but receipt is not yet independently confirmed; ERC-8183 submission remains pending." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected execution bridge error";
    return res.status(/required|must|invalid|outside|expired|missing|does not match|funded|scope|capability/i.test(message) ? 409 : 500).json({ error: message });
  }
}
