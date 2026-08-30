import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
import { assertGridExecutionCapability, runGridPreflight, type GridPreflightInput } from "./gridExecutionAdapter.js";

const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });
const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const COMMERCE_ABI = [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" }] }] }] as const;
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as Address;
const DEFAULT_FEE = 2500;
const MAX_BODY_BYTES = 128 * 1024;

function object(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function address(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function hex(value: unknown): value is Hex { return typeof value === "string" && /^0x[a-fA-F0-9]*$/.test(value); }
function selector(value: string) { return /^0x[a-fA-F0-9]{8}$/.test(value.slice(0, 10)); }
function selectorOf(data: string) { return data.slice(0, 10).toLowerCase(); }

async function readJson(req: VercelRequest) {
  if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
  let raw = "";
  for await (const chunk of req) { raw += String(chunk); if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new Error("Execution request body is too large"); }
  return JSON.parse(raw || "{}") as Record<string, unknown>;
}

function sessionFromRequest(request: Record<string, unknown>) {
  const evidence = object(request.evidence);
  const capability = object(evidence.execution_capability);
  assertGridExecutionCapability(capability);
  if (capability.network !== "bsc-testnet" || Number(capability.chainId) !== 97) throw new Error("Stored Grid capability is not BSC Testnet");
  if (capability.private_key_exposed !== false) throw new Error("Stored Grid capability is not private-key safe");
  if (!address(capability.session_key_address) || !hex(capability.session_key_public_key)) throw new Error("Stored Grid capability has invalid session identity");
  if (!Array.isArray(capability.allowed_targets) || capability.allowed_targets.length === 0 || !capability.allowed_targets.every(address)) throw new Error("Stored Grid capability has no valid target allowlist");
  if (!Array.isArray(capability.allowed_selectors) || capability.allowed_selectors.length === 0 || !capability.allowed_selectors.every((v) => typeof v === "string" && selector(v))) throw new Error("Stored Grid capability has no valid selector allowlist");
  const expiry = Number(evidence.session_expiry);
  if (!Number.isInteger(expiry) || expiry <= Math.floor(Date.now() / 1000)) throw new Error("Verified Altana session has expired");
  const amount = String(request.capital_authorized ?? request.capital_requested ?? "");
  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) throw new Error("Authorized execution capital must be a positive amount");
  const decimals = Number.isInteger(request.capital_decimals) && Number(request.capital_decimals) >= 0 ? Number(request.capital_decimals) : 18;
  const [whole, fraction = ""] = amount.split(".");
  const spendLimit = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  const spendToken = address(request.capital_token) ? request.capital_token : address(evidence.capital_token) ? evidence.capital_token as Address : null;
  if (!spendToken) throw new Error("Execution-capital request has no valid capital token");
  return { walletAddress: request.user_execution_wallet as Address, agentSessionAddress: capability.session_key_address as Address, agentSessionPublicKey: capability.session_key_public_key as Hex, allowedCalls: capability.allowed_targets as Address[], allowedSelectors: capability.allowed_selectors as string[], spendLimit, spendToken, nativeSpendLimit: 20_000_000_000_000_000n, expiry, capability };
}

function validateCalls(raw: unknown, allowedTargets: readonly Address[], allowedSelectors: readonly string[]) {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("calls must be a non-empty array");
  if (raw.length > 8) throw new Error("calls cannot contain more than 8 entries");
  const targets = new Set(allowedTargets.map((v) => v.toLowerCase()));
  const selectors = new Set(allowedSelectors.map((v) => v.toLowerCase()));
  return raw.map((item) => {
    const call = object(item);
    if (!address(call.to) || !hex(call.data) || !selector(String(call.data))) throw new Error("Each call must contain a valid target and selector-prefixed calldata");
    if (!targets.has(String(call.to).toLowerCase())) throw new Error(`Target ${call.to} is outside the verified provider capability scope`);
    if (!selectors.has(selectorOf(String(call.data)))) throw new Error(`Function selector ${selectorOf(String(call.data))} is outside the verified provider capability scope`);
    return { to: call.to as Address, data: call.data as Hex, ...(call.value === undefined || call.value === null ? {} : { value: BigInt(String(call.value)) }) };
  });
}

function sourceUrl(request: Record<string, unknown>) {
  const source = String(object(object(request.evidence).execution_capability).source_url || "").trim();
  if (!source) throw new Error("Grid capability source URL is missing");
  const parsed = new URL(source);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("Grid capability source URL must be HTTP(S)");
  parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/execution-capabilities$/, "");
  parsed.search = "";
  return parsed;
}

async function dispatch(url: string, requestId: string, session: unknown, calls: unknown[]) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "x-agentmarket-request-id": requestId }, body: JSON.stringify({ session, calls }, (_, v) => typeof v === "bigint" ? v.toString() : v) });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : `Grid executor returned HTTP ${response.status}`);
  return body || {};
}

async function providerSubmit(request: Record<string, unknown>, requestId: string, chainJobId: number, transactionHash: string) {
  const url = sourceUrl(request); url.pathname += "/submit-execution";
  const response = await fetch(url.toString(), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "x-agentmarket-request-id": requestId }, body: JSON.stringify({ job_id: chainJobId, transaction_hash: transactionHash }) });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof body?.detail === "string" ? body.detail : typeof body?.error === "string" ? body.error : `Grid provider submission returned HTTP ${response.status}`);
  return body || {};
}

async function receipt(hash: string) {
  const value = await publicClient.getTransactionReceipt({ hash: hash as Hex });
  if (value.status !== "success") throw new Error("Execution transaction receipt is not successful");
  return { transaction_hash: value.transactionHash, block_number: value.blockNumber.toString(), block_hash: value.blockHash, status: value.status, gas_used: value.gasUsed.toString(), effective_gas_price: value.effectiveGasPrice.toString() };
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
    const chainJobId = Number(job.chain_job_id);
    if (!Number.isInteger(chainJobId)) throw new Error("The ERC-8183 chain job has not been created");
    const chainJob = await publicClient.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "getJob", args: [BigInt(chainJobId)] });
    if (![1, 2].includes(Number(chainJob.status))) throw new Error(`Execution requires a funded or submitted ERC-8183 job; live status is ${Number(chainJob.status)}`);

    const requestRecord = request as Record<string, unknown>;
    const evidence = object(requestRecord.evidence);
    const existing = object(evidence.last_execution);
    if (isHex(existing.transaction_hash)) return res.status(200).json({ ok: true, request, execution: existing, note: "Existing execution evidence found; duplicate broadcast prevented." });

    if (Number(chainJob.status) === 2) return res.status(409).json({ error: "ERC-8183 job is already Submitted but execution evidence has not been linked to this request" });
    const session = sessionFromRequest(requestRecord);
    if (String(session.walletAddress).toLowerCase() !== String(request.user_execution_wallet).toLowerCase()) throw new Error("Stored execution wallet does not match the authorized session wallet");
    if (String(session.agentSessionAddress).toLowerCase() !== String(request.agent_session_key).toLowerCase()) throw new Error("Stored provider session key does not match the authorized Grid session");

    let calls;
    if (Array.isArray(input.calls) && input.calls.length > 0) calls = validateCalls(input.calls, session.allowedCalls, session.allowedSelectors);
    else {
      const market = object(session.capability.execution_market);
      const router = address(market.router) ? market.router : session.allowedCalls.find((v) => v.toLowerCase() !== session.spendToken.toLowerCase());
      if (!router) throw new Error("Provider capability does not identify an execution router");
      const preflightInput: GridPreflightInput = { router, tokenIn: session.spendToken, tokenOut: address(market.token_out) ? market.token_out : WBNB, recipient: session.walletAddress, fee: Number.isInteger(Number(market.fee)) ? Number(market.fee) : DEFAULT_FEE, amountIn: session.spendLimit.toString(), amountOutMinimum: process.env.GRID_TESTNET_AMOUNT_OUT_MINIMUM_RAW?.trim() || "0" };
      const preflight = await runGridPreflight(requestRecord, preflightInput, "pancake-v3-swap");
      const call = object(object(preflight).result).call;
      if (!address(call.to) || !hex(call.data)) throw new Error("Grid preflight did not return executable calldata");
      calls = validateCalls([call], session.allowedCalls, session.allowedSelectors);
    }

    const executionUrl = process.env.GRID_EXECUTION_ENDPOINT_URL?.trim() ? `${process.env.GRID_EXECUTION_ENDPOINT_URL.trim().replace(/\/+$/, "")}/execute` : (() => { const url = sourceUrl(requestRecord); url.pathname += "/execute"; return url.toString(); })();
    const response = await dispatch(executionUrl, request.id, session, calls);
    const result = object(response.result);
    const transactionHash = typeof result.transactionHash === "string" && isHex(result.transactionHash) ? result.transactionHash : null;
    if (!transactionHash) throw new Error("Grid execution returned without a transaction hash");
    const txReceipt = await receipt(transactionHash);

    let submission: Record<string, unknown> | null = null;
    if (txReceipt) submission = await providerSubmit(requestRecord, request.id, chainJobId, transactionHash);

    const executionEvidence = { execution_id: typeof input.execution_id === "string" ? input.execution_id.trim() : crypto.randomUUID(), requested_at: new Date().toISOString(), executor_url: executionUrl, calls: calls.map((call) => ({ to: call.to, selector: selectorOf(call.data), data: call.data, value: call.value?.toString() || "0" })), calls_id: typeof result.callsId === "string" ? result.callsId : null, transaction_hash: transactionHash, executor_status: typeof result.status === "string" ? result.status : "CONFIRMED", receipt: txReceipt, receipt_verified: true, chain_id: 97, source: "grid_testnet_execution_adapter" };
    const nextEvidence = { ...evidence, last_execution: executionEvidence, executions: [...(Array.isArray(evidence.executions) ? evidence.executions : []).slice(-9), executionEvidence], ...(submission ? { last_submission: { submitted_at: new Date().toISOString(), submission_tx_hash: submission.submission_tx_hash || null, execution_transaction_hash: transactionHash, source: "agentmarket_execution_bridge" } } : {}) };
    const { error: updateError } = await supabase.from("execution_capital_requests").update({ status: "active", activated_at: request.activated_at || new Date().toISOString(), evidence: nextEvidence, updated_at: new Date().toISOString() }).eq("id", requestId);
    if (updateError) return res.status(500).json({ error: updateError.message });

    const { error: evidenceError } = await supabase.from("execution_capital_execution_evidence").upsert({ execution_capital_request_id: request.id, job_id: job.id, chain_id: 97, execution_id: executionEvidence.execution_id, calls_id: executionEvidence.calls_id, executor_status: executionEvidence.executor_status, transaction_hash: transactionHash, receipt: txReceipt, receipt_verified: true, calls: executionEvidence.calls, source: "grid_testnet_execution_adapter" }, { onConflict: "execution_capital_request_id,execution_id" });
    if (evidenceError) return res.status(500).json({ error: evidenceError.message });

    return res.status(200).json({ ok: true, request_id: request.id, request: { ...request, evidence: nextEvidence, status: "active" }, execution: executionEvidence, submission, note: submission ? "Execution succeeded and ERC-8183 submission was dispatched." : "Execution succeeded but submission was not dispatched." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution bridge failed";
    return res.status(/required|invalid|outside|expired|missing|does not match|funded|submitted|scope|capability/i.test(message) ? 409 : 500).json({ error: message });
  }
}
