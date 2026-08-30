import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const COMMERCE_ABI = [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" }] }] }] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });

function object(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function validTx(value: unknown): value is `0x${string}` { return typeof value === "string" && /^0x[a-f-fA-F0-9]{64}$/.test(value); }

function providerSubmitUrl(sourceUrl: string) {
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Grid capability source URL is not HTTP(S)");
  parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/execution-capabilities$/, "") + "/submit-execution";
  parsed.search = "";
  return parsed.toString();
}

async function dispatch(url: string, requestId: string, body: Record<string, unknown>) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "x-agentmarket-request-id": requestId }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof payload?.detail === "string" ? payload.detail : typeof payload?.error === "string" ? payload.error : `Grid submission returned HTTP ${response.status}`);
  return payload || {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }

    const requestId = typeof req.body?.request_id === "string" ? req.body.request_id.trim() : "";
    if (!requestId) return res.status(400).json({ error: "request_id is required" });
    const supabase = serverClient();
    const { data: request, error: requestError } = await supabase.from("execution_capital_requests").select("*").eq("id", requestId).maybeSingle();
    if (requestError) return res.status(500).json({ error: requestError.message });
    if (!request) return res.status(404).json({ error: "Execution capital request not found" });

    const { data: job, error: jobError } = await supabase.from("jobs").select("id,client_wallet,chain_job_id").eq("id", request.job_id).maybeSingle();
    if (jobError) return res.status(500).json({ error: jobError.message });
    if (!job || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "You do not own this execution-capital request" });
    if (!job.chain_job_id) return res.status(409).json({ error: "The ERC-8183 chain job has not been created yet" });

    const chainJob = await publicClient.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "getJob", args: [BigInt(job.chain_job_id)] });
    if (Number(chainJob.status) === 2) return res.status(200).json({ ok: true, already_submitted: true, job_status: Number(chainJob.status) });
    if (Number(chainJob.status) !== 1) return res.status(409).json({ error: `ERC-8183 submission requires a funded job; live status is ${Number(chainJob.status)}` });

    const evidence = object(request.evidence);
    const lastExecution = object(evidence.last_execution);
    let transactionHash = validTx(lastExecution.transaction_hash) ? lastExecution.transaction_hash : null;
    if (!transactionHash) {
      const { data: rows } = await supabase.from("execution_capital_execution_evidence").select("transaction_hash,receipt_verified,created_at").eq("execution_capital_request_id", request.id).order("created_at", { ascending: false }).limit(10);
      const row = (rows || []).find((item) => item?.receipt_verified === true && validTx(item.transaction_hash));
      transactionHash = row?.transaction_hash || null;
    }
    if (!transactionHash) return res.status(409).json({ error: "No verified execution transaction is recorded for this request; refusing to submit the ERC-8183 deliverable" });

    const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== "success") return res.status(409).json({ error: "Recorded execution transaction does not have a successful BSC Testnet receipt" });

    const capability = object(evidence.execution_capability);
    const sourceUrl = typeof capability.source_url === "string" ? capability.source_url.trim() : "";
    if (!sourceUrl) return res.status(409).json({ error: "No Grid capability source URL is stored for this request" });
    const submission = await dispatch(providerSubmitUrl(sourceUrl), request.id, { job_id: Number(job.chain_job_id), transaction_hash: transactionHash });

    await supabase.from("execution_capital_requests").update({
      evidence: { ...evidence, last_submission: { submitted_at: new Date().toISOString(), submission_tx_hash: submission.submission_tx_hash || null, execution_transaction_hash: transactionHash, source: "agentmarket_submission_recovery" } },
      updated_at: new Date().toISOString(),
    }).eq("id", request.id);

    return res.status(200).json({ ok: true, job_id: job.chain_job_id, execution_transaction_hash: transactionHash, submission_tx_hash: submission.submission_tx_hash || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution submission failed";
    return res.status(409).json({ error: message });
  }
}
