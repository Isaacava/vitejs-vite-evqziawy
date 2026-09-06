import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, keccak256, parseEventLogs, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { serverClient } from "../../src/server/authHandlers.js";
import { invokeProviderOperation, resolveProviderOperation } from "./provider-operation.js";

type EndpointRecord = { endpoint_url: string; protocol: string; status: string; metadata?: unknown; version?: string | null };

const NETWORK = "bsc-testnet" as const;
const CHAIN_ID = 97 as const;
const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const RPC_URL = process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com";
const BLOCKS_PER_RUN = BigInt(Math.max(100, Number(process.env.ERC8183_INDEX_BLOCKS_PER_RUN || "1500")));
const CONFIRMATIONS = BigInt(Math.max(1, Number(process.env.ERC8183_INDEX_CONFIRMATIONS || "5")));
const CURSOR_ID = `${NETWORK}:${COMMERCE.toLowerCase()}`;

const EVENT_ABI = [
  { type: "event", name: "JobCreated", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "client", type: "address", indexed: true }, { name: "provider", type: "address", indexed: true }, { name: "evaluator", type: "address", indexed: false }, { name: "expiredAt", type: "uint256", indexed: false }, { name: "hook", type: "address", indexed: false }], anonymous: false },
  { type: "event", name: "ProviderSet", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "provider", type: "address", indexed: true }, { name: "agentId", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "BudgetSet", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "token", type: "address", indexed: false }, { name: "amount", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "JobFunded", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "client", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "JobSubmitted", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "provider", type: "address", indexed: true }, { name: "deliverable", type: "bytes32", indexed: false }], anonymous: false },
  { type: "event", name: "PayoutReceiverSet", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "payoutReceiver", type: "address", indexed: false }], anonymous: false },
  { type: "event", name: "JobCompleted", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "evaluator", type: "address", indexed: true }, { name: "reason", type: "bytes32", indexed: false }], anonymous: false },
  { type: "event", name: "JobRejected", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "rejector", type: "address", indexed: true }, { name: "reason", type: "bytes32", indexed: false }], anonymous: false },
  { type: "event", name: "JobExpired", inputs: [{ name: "jobId", type: "uint256", indexed: true }], anonymous: false },
  { type: "event", name: "PaymentReleased", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "recipient", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "PlatformFeePaid", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "platformTreasury", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "EvaluatorFeePaid", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "evaluator", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "Refunded", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "client", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "Settled", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "cumulativeAmount", type: "uint256", indexed: false }, { name: "delta", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "ClaimSubmitted", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "provider", type: "address", indexed: true }, { name: "cumulativeAmount", type: "uint256", indexed: false }, { name: "delta", type: "uint256", indexed: false }, { name: "deliverable", type: "bytes32", indexed: false }, { name: "optParams", type: "bytes", indexed: false }], anonymous: false },
  { type: "event", name: "ClaimSettled", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "settler", type: "address", indexed: true }, { name: "cumulativeAmount", type: "uint256", indexed: false }, { name: "delta", type: "uint256", indexed: false }, { name: "deliverable", type: "bytes32", indexed: false }], anonymous: false },
  { type: "event", name: "ClaimApproved", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "approver", type: "address", indexed: true }, { name: "cumulativeAmount", type: "uint256", indexed: false }, { name: "delta", type: "uint256", indexed: false }, { name: "deliverable", type: "bytes32", indexed: false }], anonymous: false },
  { type: "event", name: "ClaimRejected", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "rejector", type: "address", indexed: true }, { name: "reason", type: "bytes32", indexed: false }], anonymous: false },
] as const;

const JOB_READ_ABI = [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [
  { name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" },
] }] }] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(RPC_URL) });
const CHAIN_STATUS: Record<number, "open" | "funded" | "submitted" | "completed" | "rejected" | "expired"> = { 0: "open", 1: "funded", 2: "submitted", 3: "completed", 4: "rejected", 5: "expired" };

function authorized(req: VercelRequest) { const configured = process.env.CRON_SECRET; if (!configured) return false; const bearer = typeof req.headers.authorization === "string" ? req.headers.authorization : ""; const header = typeof req.headers["x-cron-secret"] === "string" ? req.headers["x-cron-secret"] : ""; return bearer === `Bearer ${configured}` || header === configured; }
function jsonSafe(value: unknown): unknown { if (typeof value === "bigint") return value.toString(); if (Array.isArray(value)) return value.map(jsonSafe); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, jsonSafe(entry)])); return value; }
function decodeKnownEvent(log: any) { try { const parsed = parseEventLogs({ abi: EVENT_ABI, logs: [log], strict: false })[0]; if (!parsed) return null; const args = jsonSafe(parsed.args || {}); const record = args as Record<string, unknown>; const rawJobId = record.jobId; const chainJobId = rawJobId == null ? null : Number(rawJobId); return { eventName: String(parsed.eventName), chainJobId: Number.isSafeInteger(chainJobId) && chainJobId > 0 ? chainJobId : null, payload: record }; } catch { return null; } }
function unknownEventName(log: any) { const topic = Array.isArray(log.topics) && log.topics[0] ? String(log.topics[0]) : "unknown"; return `unknown:${topic}`; }
function statusForEvent(eventName: string): string | null { switch (eventName) { case "JobCreated": return "created"; case "ProviderSet": return null; case "BudgetSet": return "budget_set"; case "JobFunded": return "funded"; case "JobSubmitted": return "submitted"; case "JobCompleted": return "completed"; case "JobRejected": return "rejected"; case "JobExpired": return "expired"; default: return null; } }
function isHash(value: unknown): value is Hex { return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value); }
function isAddress(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function findTransactionHashes(value: unknown, output: Hex[] = []): Hex[] {
  if (isHash(value)) { if (!output.includes(value)) output.push(value); return output; }
  if (typeof value === "string") { try { return findTransactionHashes(JSON.parse(value), output); } catch { return output; } }
  if (!value || typeof value !== "object") return output;
  const record = object(value);
  for (const key of ["transaction_hash", "transactionHash", "tx_hash", "txHash"]) if (isHash(record[key]) && !output.includes(record[key])) output.push(record[key]);
  for (const key of ["execution", "evidence", "transactions", "execution_result", "receipt", "response", "content", "result", "metadata"]) findTransactionHashes(record[key], output);
  return output;
}

async function syncJobFromChain(supabase: ReturnType<typeof serverClient>, chainJobId: number, txHash: string, blockNumber: bigint) {
  const chainJob = await publicClient.readContract({ address: COMMERCE, abi: JOB_READ_ABI, functionName: "getJob", args: [BigInt(chainJobId)] });
  if (!chainJob || chainJob.id === 0n) return false;
  const chainStatus = CHAIN_STATUS[Number(chainJob.status)]; if (!chainStatus) return false;
  const patch: Record<string, unknown> = { chain_status: chainStatus, chain_last_synced_at: new Date().toISOString(), chain_tx_hash: txHash, chain_error: null, updated_at: new Date().toISOString() };
  if (chainStatus === "funded") patch.funded_at = new Date(Number(blockNumber) * 1000).toISOString();
  if (chainStatus === "submitted") { patch.submitted_at = chainJob.submittedAt > 0n ? new Date(Number(chainJob.submittedAt) * 1000).toISOString() : new Date().toISOString(); patch.deliverable = chainJob.deliverable; }
  if (["completed", "rejected", "expired"].includes(chainStatus)) patch.terminal_at = new Date().toISOString();
  const { error } = await supabase.from("jobs").update(patch).eq("chain_job_id", chainJobId); if (error) throw new Error(error.message); return true;
}

async function recordTransactionsFromSubmission(supabase: ReturnType<typeof serverClient>, chainJobId: number, submissionTxHash: string, provider: Address, client: Address, deliverable: Hex, content: unknown) {
  const txHashes = findTransactionHashes(content);
  if (txHashes.length === 0) return { candidate_count: 0, verified_count: 0 };
  const { data: job } = await supabase.from("jobs").select("id,mission_id").eq("chain_job_id", chainJobId).maybeSingle();
  if (!job) return { candidate_count: txHashes.length, verified_count: 0 };
  let verifiedCount = 0;
  for (const txHash of txHashes) {
    try {
      const [receipt, tx] = await Promise.all([publicClient.getTransactionReceipt({ hash: txHash }), publicClient.getTransaction({ hash: txHash })]);
      if (receipt.status !== "success") continue;
      const metadata = { type: "agent-submission-proof/v1", chain_id: CHAIN_ID, network: NETWORK, chain_job_id: chainJobId, provider, client, submission_tx_hash: submissionTxHash, deliverable_commitment: deliverable, transaction_hash: txHash, tx_from: tx.from, tx_to: tx.to, receipt_verified: true, block_hash: receipt.blockHash, gas_used: receipt.gasUsed.toString(), evidence: content };
      await supabase.from("transactions").upsert({ mission_id: job.mission_id, job_id: job.id, tx_hash: txHash, chain_id: CHAIN_ID, kind: "agent_execution_evidence", status: "confirmed", block_number: Number(receipt.blockNumber), metadata }, { onConflict: "job_id,tx_hash" });
      verifiedCount += 1;
    } catch {}
  }
  return { candidate_count: txHashes.length, verified_count: verifiedCount };
}

async function verifySubmittedDeliverable(supabase: ReturnType<typeof serverClient>, chainJobId: number, submissionTxHash: string) {
  const chainJob: any = await publicClient.readContract({ address: COMMERCE, abi: JOB_READ_ABI, functionName: "getJob", args: [BigInt(chainJobId)] });
  if (!chainJob || chainJob.id === 0n || ![2, 3].includes(Number(chainJob.status))) return { provider_result: false, deliverable_matches: false, candidate_count: 0, verified_count: 0 };
  const { data: agent } = await supabase.from("agents").select("id,agent_id,owner").ilike("owner", String(chainJob.provider)).limit(1).maybeSingle();
  if (!agent) return { provider_result: false, deliverable_matches: false, candidate_count: 0, verified_count: 0 };
  const { data: endpoints } = await supabase.from("agent_endpoints").select("endpoint_url,protocol,status,metadata,version").eq("agent_id", String(agent.id)).order("last_checked_at", { ascending: false }).limit(20);
  for (const endpoint of (endpoints || []) as EndpointRecord[]) {
    const operation = await resolveProviderOperation(endpoint, "result"); if (!operation) continue;
    try {
      const result = await invokeProviderOperation(operation, { chain_job_id: chainJobId, job_id: chainJobId, agent_id: agent.agent_id, client_wallet: String(chainJob.client), provider_wallet: String(chainJob.provider), network: NETWORK });
      const bytes = new TextEncoder().encode(result.rawText); const computed = keccak256(bytes) as Hex; const matches = String(chainJob.deliverable).toLowerCase() === computed.toLowerCase();
      if (!matches) return { provider_result: true, deliverable_matches: false, candidate_count: 0, verified_count: 0, computed_deliverable_hash: computed };
      let content: unknown; try { content = JSON.parse(result.rawText); } catch { content = result.rawText; }
      return { provider_result: true, deliverable_matches: true, computed_deliverable_hash: computed, ...(await recordTransactionsFromSubmission(supabase, chainJobId, submissionTxHash, chainJob.provider, chainJob.client, chainJob.deliverable, content)) };
    } catch {}
  }
  return { provider_result: false, deliverable_matches: false, candidate_count: 0, verified_count: 0 };
}

async function persistEvent(supabase: ReturnType<typeof serverClient>, log: any, decoded: ReturnType<typeof decodeKnownEvent>) {
  const eventName = decoded?.eventName || unknownEventName(log); const chainJobId = decoded?.chainJobId ?? null; const payload = decoded?.payload || { topics: log.topics, data: log.data }; const transactionHash = String(log.transactionHash || ""); const blockNumber = BigInt(log.blockNumber);
  const { data: inserted, error } = await supabase.from("erc8183_events").upsert({ chain_id: CHAIN_ID, contract_address: COMMERCE.toLowerCase(), event_name: eventName, block_number: Number(blockNumber), block_hash: log.blockHash ? String(log.blockHash) : null, transaction_hash: transactionHash, log_index: Number(log.logIndex), chain_job_id: chainJobId, payload }, { onConflict: "chain_id,contract_address,transaction_hash,log_index", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (chainJobId) {
    const statusHint = statusForEvent(eventName);
    await syncJobFromChain(supabase, chainJobId, transactionHash, blockNumber);
    if (statusHint === "submitted") {
      const deliverable = typeof decoded?.payload?.deliverable === "string" ? decoded.payload.deliverable : null;
      if (deliverable) await supabase.from("jobs").update({ deliverable }).eq("chain_job_id", chainJobId);
      await verifySubmittedDeliverable(supabase, chainJobId, transactionHash);
    }
  }
  if (["PaymentReleased", "Refunded", "Settled", "PlatformFeePaid", "EvaluatorFeePaid"].includes(eventName) && chainJobId) {
    const amount = typeof decoded?.payload?.amount === "string" ? decoded.payload.amount : typeof decoded?.payload?.delta === "string" ? decoded.payload.delta : null;
    const recipient = typeof decoded?.payload?.recipient === "string" ? decoded.payload.recipient : null;
    const { data: job } = await supabase.from("jobs").select("id,mission_id,user_id,budget,payment_token").eq("chain_job_id", chainJobId).maybeSingle();
    if (job) {
      const metadata = { event: eventName, chain_job_id: chainJobId, recipient, amount_raw: amount, tx_hash: transactionHash, block_number: Number(blockNumber), chain_id: CHAIN_ID, network: NETWORK };
      await supabase.from("transactions").upsert({ mission_id: job.mission_id, job_id: job.id, tx_hash: transactionHash, chain_id: CHAIN_ID, kind: eventName, status: "confirmed", block_number: Number(blockNumber), metadata }, { onConflict: "job_id,tx_hash" });
      if (eventName === "Refunded") await supabase.from("payments").update({ status: "refunded", tx_hash: transactionHash, updated_at: new Date().toISOString() }).eq("job_id", job.id);
      if (eventName === "PaymentReleased") await supabase.from("payments").update({ status: "released", tx_hash: transactionHash, updated_at: new Date().toISOString() }).eq("job_id", job.id);
    }
  }
  return Boolean(inserted);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized indexer request" });
  try {
    const supabase = serverClient();
    const latest = await publicClient.getBlockNumber(); const safeHead = latest > CONFIRMATIONS ? latest - CONFIRMATIONS : 0n;
    const { data: cursor } = await supabase.from("erc8183_indexer_cursors").select("last_scanned_block").eq("id", CURSOR_ID).maybeSingle();
    const configuredStart = BigInt(process.env.ERC8183_INDEX_START_BLOCK || "0");
    const start = cursor?.last_scanned_block != null ? BigInt(cursor.last_scanned_block) + 1n : configuredStart > 0n ? configuredStart : (safeHead > BLOCKS_PER_RUN ? safeHead - BLOCKS_PER_RUN + 1n : 0n);
    if (start > safeHead) return res.status(200).json({ ok: true, network: NETWORK, chain_id: CHAIN_ID, indexed: 0, from_block: start.toString(), to_block: safeHead.toString(), latest: latest.toString(), message: "Indexer is caught up" });
    const end = ((start + BLOCKS_PER_RUN - 1n) < safeHead) ? start + BLOCKS_PER_RUN - 1n : safeHead;
    const logs = await publicClient.getLogs({ address: COMMERCE, fromBlock: start, toBlock: end });
    let inserted = 0; let recognized = 0; const touchedJobs = new Set<number>(); const evidenceJobs = new Set<number>(); let evidenceTransactionsVerified = 0;
    for (const log of logs) {
      const decoded = decodeKnownEvent(log); if (decoded) { recognized += 1; if (decoded.chainJobId) touchedJobs.add(decoded.chainJobId); }
      if (decoded?.eventName === "JobSubmitted" && decoded.chainJobId) evidenceJobs.add(decoded.chainJobId);
      if (await persistEvent(supabase, log, decoded)) inserted += 1;
    }
    for (const jobId of evidenceJobs) {
      try {
        const result = await verifySubmittedDeliverable(supabase, jobId, `indexed-job-${jobId}`);
        evidenceTransactionsVerified += Number(result.verified_count || 0);
      } catch {}
    }
    await supabase.from("erc8183_indexer_cursors").upsert({ id: CURSOR_ID, chain_id: CHAIN_ID, contract_address: COMMERCE.toLowerCase(), last_scanned_block: Number(end), updated_at: new Date().toISOString() }, { onConflict: "id" });
    return res.status(200).json({ ok: true, network: NETWORK, chain_id: CHAIN_ID, from_block: start.toString(), to_block: end.toString(), latest: latest.toString(), confirmations: CONFIRMATIONS.toString(), logs_seen: logs.length, events_inserted: inserted, recognized_events: recognized, jobs_touched: touchedJobs.size, submission_jobs_verified: evidenceJobs.size, evidence_transactions_verified: evidenceTransactionsVerified });
  } catch (error) {
    console.error("ERC-8183 indexer failed", error);
    return res.status(500).json({ ok: false, network: NETWORK, chain_id: CHAIN_ID, error: error instanceof Error ? error.message : "ERC-8183 indexer failed" });
  }
}
