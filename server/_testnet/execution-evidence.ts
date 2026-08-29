import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, decodeEventLog, http, keccak256, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const CAKE2 = "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551" as Address;
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as Address;
const PANCAKE_V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as Address;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const POOL_FEES = [100, 500, 2500, 10000] as const;

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

const ERC20_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const FACTORY_ABI = [{
  type: "function",
  name: "getPool",
  stateMutability: "view",
  inputs: [
    { name: "tokenA", type: "address" },
    { name: "tokenB", type: "address" },
    { name: "fee", type: "uint24" },
  ],
  outputs: [{ name: "pool", type: "address" }],
}] as const;

const TRANSFER_ABI = [{
  type: "event",
  name: "Transfer",
  anonymous: false,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
}] as const;

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function formatUnits(value: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseArchivedContent(bytes: Uint8Array): unknown {
  const text = new TextDecoder().decode(bytes);
  try { return JSON.parse(text); } catch { return text; }
}

function findTransactionHash(value: unknown): Hex | null {
  if (isHash(value)) return value;
  if (typeof value === "string") {
    try { return findTransactionHash(JSON.parse(value)); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  const record = object(value);
  for (const key of ["transaction_hash", "transactionHash", "tx_hash", "txHash"]) {
    if (isHash(record[key])) return record[key];
  }
  for (const key of ["execution_result", "receipt", "response", "content", "result"]) {
    const nested = record[key];
    const found = findTransactionHash(nested);
    if (found) return found;
  }
  return null;
}

async function loadOwnedJob(jobId: string, authUserId: string, wallet: string) {
  const supabase = serverClient();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id,mission_task_id,client_wallet,chain_job_id")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Job not found");
  if (!job.mission_task_id || !job.chain_job_id) throw new Error("Job is not attached to a funded ERC-8183 chain job");
  if (String(job.client_wallet || "").toLowerCase() !== wallet.toLowerCase()) throw new Error("The authenticated wallet does not own this job");

  const { data: task, error: taskError } = await supabase
    .from("mission_tasks")
    .select("id,mission_id")
    .eq("id", job.mission_task_id)
    .maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task?.mission_id) throw new Error("Job task is not attached to a mission");

  const { data: mission, error: missionError } = await supabase
    .from("missions")
    .select("id,user_id")
    .eq("id", task.mission_id)
    .maybeSingle();
  if (missionError) throw new Error(missionError.message);
  if (!mission || mission.user_id !== authUserId) throw new Error("You do not own this mission");

  const { data: executionEvidence, error: evidenceError } = await supabase
    .from("execution_capital_execution_evidence")
    .select("id,transaction_hash,receipt_verified,created_at")
    .eq("job_id", job.id)
    .not("transaction_hash", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (evidenceError) throw new Error(evidenceError.message);

  const { data: request, error: requestError } = await supabase
    .from("execution_capital_requests")
    .select("id,user_execution_wallet,agent_session_key,status,evidence")
    .eq("job_id", job.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (requestError) throw new Error(requestError.message);

  const { data: archived, error: archiveError } = await supabase
    .from("erc8183_deliverable_archives")
    .select("chain_id,commerce_address,job_id,onchain_deliverable_hash,content_base64,verified,verification_error,captured_at,capture_source,provider_endpoint")
    .eq("chain_id", 97)
    .ilike("commerce_address", COMMERCE)
    .eq("job_id", Number(job.chain_job_id))
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (archiveError) throw new Error(archiveError.message);

  return { supabase, job, executionEvidence, request, archived };
}

async function verifyOnchain(txHash: Hex, executionWallet: Address | null, sessionKey: Address | null) {
  const [transaction, receipt] = await Promise.all([
    publicClient.getTransaction({ hash: txHash }),
    publicClient.getTransactionReceipt({ hash: txHash }),
  ]);
  if (receipt.status !== "success") throw new Error("Execution transaction is not successful on BSC Testnet");

  const [block, latestBlock] = await Promise.all([
    publicClient.getBlock({ blockNumber: receipt.blockNumber }),
    publicClient.getBlockNumber(),
  ]);

  const transferEvents: Array<{ token: Address; from: Address; to: Address; value: bigint }> = [];
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics, strict: false });
      if (decoded.eventName !== "Transfer") continue;
      const args = decoded.args as { from: Address; to: Address; value: bigint };
      if (isAddress(log.address) && isAddress(args.from) && isAddress(args.to) && typeof args.value === "bigint") {
        transferEvents.push({ token: log.address as Address, from: args.from, to: args.to, value: args.value });
      }
    } catch {}
  }

  const wallet = executionWallet?.toLowerCase();
  const tokenInRaw = transferEvents
    .filter((event) => event.token.toLowerCase() === CAKE2.toLowerCase() && wallet && event.from.toLowerCase() === wallet && event.value > 0n)
    .reduce((sum, event) => sum + event.value, 0n);
  const tokenOutRaw = transferEvents
    .filter((event) => event.token.toLowerCase() === WBNB.toLowerCase() && wallet && event.to.toLowerCase() === wallet && event.value > 0n)
    .reduce((sum, event) => sum + event.value, 0n);

  const poolMatches: Array<{ fee: number; pool: Address }> = [];
  for (const fee of POOL_FEES) {
    try {
      const pool = await publicClient.readContract({ address: PANCAKE_V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [CAKE2, WBNB, fee] });
      if (isAddress(pool) && pool.toLowerCase() !== ZERO_ADDRESS.toLowerCase() && receipt.logs.some((log) => log.address.toLowerCase() === pool.toLowerCase())) {
        poolMatches.push({ fee, pool });
      }
    } catch {}
  }

  let tokenInDecimals = 18;
  let tokenOutDecimals = 18;
  try { tokenInDecimals = Number(await publicClient.readContract({ address: CAKE2, abi: ERC20_ABI, functionName: "decimals" })); } catch {}
  try { tokenOutDecimals = Number(await publicClient.readContract({ address: WBNB, abi: ERC20_ABI, functionName: "decimals" })); } catch {}

  const matchedPool = poolMatches.length === 1 ? poolMatches[0] : null;
  const verifiedMarket = Boolean(matchedPool && tokenInRaw > 0n && tokenOutRaw > 0n);
  const confirmations = latestBlock >= receipt.blockNumber ? (latestBlock - receipt.blockNumber).toString() : "0";

  return {
    verified: true,
    network: "bsc-testnet",
    chain_id: 97,
    transaction_hash: receipt.transactionHash,
    execution: {
      status: receipt.status,
      block_number: receipt.blockNumber.toString(),
      block_hash: receipt.blockHash,
      block_timestamp: Number(block.timestamp),
      confirmations,
      gas_used: receipt.gasUsed.toString(),
      effective_gas_price: receipt.effectiveGasPrice.toString(),
      from: transaction.from,
      to: transaction.to,
      session_key: sessionKey,
      execution_wallet: executionWallet,
    },
    market: {
      verified_onchain: verifiedMarket,
      token_in: CAKE2,
      token_in_symbol: "CAKE2",
      token_in_decimals: tokenInDecimals,
      token_in_amount_raw: tokenInRaw.toString(),
      token_in_amount: formatUnits(tokenInRaw, tokenInDecimals),
      token_out: WBNB,
      token_out_symbol: "WBNB",
      token_out_decimals: tokenOutDecimals,
      token_out_amount_raw: tokenOutRaw.toString(),
      token_out_amount: formatUnits(tokenOutRaw, tokenOutDecimals),
      fee: matchedPool?.fee ?? null,
      pool: matchedPool?.pool ?? null,
    },
    accounting: {
      capital_deployed: formatUnits(tokenInRaw, tokenInDecimals),
      capital_deployed_token: "CAKE2",
      realized_pnl: null,
      realized_pnl_token: null,
      realized_pnl_status: "not_determinable_from_single_swap",
      realized_pnl_basis: "A single spot swap receipt proves the executed asset amounts, but it does not establish realized P&L without an onchain accounting period, closing trade, or valuation basis.",
    },
    source: "agentmarket_independent_bsc_rpc_verification",
  };
}

async function persistCandidatePointer(
  supabase: ReturnType<typeof serverClient>,
  requestId: string | null,
  jobId: number,
  transactionHash: Hex,
  source: string,
) {
  if (!requestId) return;
  const { error } = await supabase.from("execution_capital_execution_evidence").upsert({
    execution_capital_request_id: requestId,
    job_id: jobId,
    chain_id: 97,
    execution_id: `deliverable-pointer-${jobId}`,
    calls_id: null,
    executor_status: "candidate_from_verified_deliverable",
    transaction_hash: transactionHash,
    receipt: null,
    receipt_verified: false,
    calls: [],
    source,
  }, { onConflict: "execution_capital_request_id,execution_id" });
  if (error) throw new Error(error.message);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });
  const jobId = typeof req.query?.job === "string" ? req.query.job.trim() : "";
  if (!jobId) return res.status(400).json({ error: "job is required" });

  try {
    const { supabase, job, executionEvidence, request, archived } = await loadOwnedJob(jobId, auth.user.id, auth.user.wallet_address);
    const requestEvidence = object(request?.evidence);
    const lastExecution = object(requestEvidence.last_execution);

    let transactionCandidate = String(executionEvidence?.transaction_hash || lastExecution.transaction_hash || "").trim();
    let candidateSource = executionEvidence?.transaction_hash ? "execution_capital_execution_evidence" : lastExecution.transaction_hash ? "execution_capital_request" : "";

    if (!transactionCandidate && archived?.verified && archived.content_base64) {
      const bytes = decodeBase64(archived.content_base64);
      const computedHash = keccak256(bytes) as Hex;
      if (String(archived.onchain_deliverable_hash || "").toLowerCase() === computedHash.toLowerCase()) {
        const content = parseArchivedContent(bytes);
        const archivedCandidate = findTransactionHash(content);
        if (archivedCandidate) {
          transactionCandidate = archivedCandidate;
          candidateSource = "verified_erc8183_deliverable_archive";
        }
      }
    }

    const txHash = isHash(transactionCandidate) ? transactionCandidate : null;
    if (!txHash) {
      return res.status(200).json({
        ok: true,
        observed: false,
        job_id: Number(job.chain_job_id),
        network: "bsc-testnet",
        chain_id: 97,
        source: "agentmarket_independent_bsc_rpc_verification",
        message: "No execution transaction could be located from verified AgentMarket evidence yet.",
      });
    }

    await persistCandidatePointer(supabase, request?.id ?? null, Number(job.id), txHash, candidateSource || "execution_evidence_locator");

    const executionWallet = isAddress(request?.user_execution_wallet) ? request.user_execution_wallet as Address : null;
    const sessionKey = isAddress(request?.agent_session_key) ? request.agent_session_key as Address : null;
    const verified = await verifyOnchain(txHash, executionWallet, sessionKey);
    return res.status(200).json({ ok: true, observed: true, job_id: jobId, ...verified });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to independently verify execution on BSC Testnet";
    return res.status(503).json({ ok: false, observed: false, error: message, network: "bsc-testnet", chain_id: 97, source: "agentmarket_independent_bsc_rpc_verification" });
  }
}
