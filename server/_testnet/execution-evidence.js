import { createPublicClient, decodeEventLog, http, keccak256 } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de";
const CAKE2 = "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551";
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const PANCAKE_V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const POOL_FEES = [100, 500, 2500, 10000];

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

const ERC20_ABI = [{
  type: "function",
  name: "decimals",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "uint8" }],
}];

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
}];

const POOL_ABI = [{
  type: "function",
  name: "slot0",
  stateMutability: "view",
  inputs: [],
  outputs: [
    { name: "sqrtPriceX96", type: "uint160" },
    { name: "tick", type: "int24" },
    { name: "observationIndex", type: "uint16" },
    { name: "observationCardinality", type: "uint16" },
    { name: "observationCardinalityNext", type: "uint16" },
    { name: "feeProtocol", type: "uint8" },
    { name: "unlocked", type: "bool" },
  ],
}];

const TRANSFER_ABI = [{
  type: "event",
  name: "Transfer",
  anonymous: false,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
}];

function isAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHash(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function object(value) {
  return value && typeof value === "object" ? value : {};
}

function formatUnits(value, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function fixed(value, digits = 10) {
  if (!Number.isFinite(value)) return null;
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function decodeBase64(value) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function parseArchivedContent(bytes) {
  const text = new TextDecoder().decode(bytes);
  try { return JSON.parse(text); } catch { return text; }
}

function findTransactionHash(value) {
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
    const nested = findTransactionHash(record[key]);
    if (nested) return nested;
  }
  return null;
}

function decodeTransfers(receipt) {
  const transfers = [];
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: TRANSFER_ABI,
        data: log.data,
        topics: log.topics,
        strict: false,
      });
      const args = object(decoded.args);
      if (decoded.eventName === "Transfer" && isAddress(log.address) && isAddress(args.from) && isAddress(args.to) && typeof args.value === "bigint") {
        transfers.push({ token: log.address, from: args.from, to: args.to, value: args.value });
      }
    } catch {}
  }
  return transfers;
}

async function findPool(receiptLogs) {
  for (const fee of POOL_FEES) {
    try {
      const pool = await publicClient.readContract({
        address: PANCAKE_V3_FACTORY,
        abi: FACTORY_ABI,
        functionName: "getPool",
        args: [CAKE2, WBNB, fee],
      });
      if (isAddress(pool) && pool.toLowerCase() !== ZERO_ADDRESS && receiptLogs.some((log) => log.toLowerCase() === pool.toLowerCase())) {
        return { pool, fee };
      }
    } catch {}
  }
  return null;
}

async function classifyExecution(txHash, executionWallet) {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") return null;
    const transfers = decodeTransfers(receipt);
    const wallet = executionWallet.toLowerCase();
    const cakeOut = transfers.filter((x) => x.token.toLowerCase() === CAKE2.toLowerCase() && x.from.toLowerCase() === wallet && x.value > 0n).reduce((s, x) => s + x.value, 0n);
    const cakeIn = transfers.filter((x) => x.token.toLowerCase() === CAKE2.toLowerCase() && x.to.toLowerCase() === wallet && x.value > 0n).reduce((s, x) => s + x.value, 0n);
    const wbnbOut = transfers.filter((x) => x.token.toLowerCase() === WBNB.toLowerCase() && x.from.toLowerCase() === wallet && x.value > 0n).reduce((s, x) => s + x.value, 0n);
    const wbnbIn = transfers.filter((x) => x.token.toLowerCase() === WBNB.toLowerCase() && x.to.toLowerCase() === wallet && x.value > 0n).reduce((s, x) => s + x.value, 0n);
    const pool = await findPool(receipt.logs.map((log) => log.address));
    return { hash: txHash, receipt, pool, cakeIn, cakeOut, wbnbIn, wbnbOut, entry: cakeOut > 0n && wbnbIn > 0n, exit: wbnbOut > 0n && cakeIn > 0n };
  } catch {
    return null;
  }
}

async function loadOwnedJob(jobId, authUserId, wallet) {
  const supabase = serverClient();
  const { data: job, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,client_wallet,chain_job_id").eq("id", jobId).maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Job not found");
  if (!job.mission_task_id || !job.chain_job_id) throw new Error("Job is not attached to a funded ERC-8183 chain job");
  if (String(job.client_wallet || "").toLowerCase() !== wallet.toLowerCase()) throw new Error("The authenticated wallet does not own this job");

  const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,mission_id").eq("id", job.mission_task_id).maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task?.mission_id) throw new Error("Job task is not attached to a mission");

  const { data: mission, error: missionError } = await supabase.from("missions").select("id,user_id").eq("id", task.mission_id).maybeSingle();
  if (missionError) throw new Error(missionError.message);
  if (!mission || mission.user_id !== authUserId) throw new Error("You do not own this mission");

  const { data: executionEvidence, error: evidenceError } = await supabase.from("execution_capital_execution_evidence").select("id,transaction_hash,receipt_verified,created_at").eq("job_id", job.id).not("transaction_hash", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (evidenceError) throw new Error(evidenceError.message);

  const { data: request, error: requestError } = await supabase.from("execution_capital_requests").select("id,user_execution_wallet,agent_session_key,status,evidence").eq("job_id", job.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (requestError) throw new Error(requestError.message);

  const { data: archived, error: archiveError } = await supabase.from("erc8183_deliverable_archives").select("chain_id,commerce_address,job_id,onchain_deliverable_hash,content_base64,verified,verification_error,captured_at,capture_source,provider_endpoint").eq("chain_id", 97).ilike("commerce_address", COMMERCE).eq("job_id", Number(job.chain_job_id)).order("captured_at", { ascending: false }).limit(1).maybeSingle();
  if (archiveError) throw new Error(archiveError.message);

  return { supabase, job, executionEvidence, request, archived };
}

async function calculatePnl(executions, executionWallet) {
  let costBasisCake = 0n;
  let openWbnb = 0n;
  let realizedPnlCake = 0n;
  let realized = false;
  let pool = null;

  for (const execution of executions) {
    if (execution.entry) {
      costBasisCake += execution.cakeOut;
      openWbnb += execution.wbnbIn;
      if (execution.pool) pool = execution.pool;
    } else if (execution.exit && openWbnb > 0n) {
      const exitWbnb = execution.wbnbOut > openWbnb ? openWbnb : execution.wbnbOut;
      const basisForExit = costBasisCake * exitWbnb / openWbnb;
      realizedPnlCake += execution.cakeIn - basisForExit;
      costBasisCake -= basisForExit;
      openWbnb -= exitWbnb;
      if (execution.pool) pool = execution.pool;
      realized = true;
    }
  }

  if (!pool && executions.length) pool = executions[executions.length - 1].pool || null;
  if (!pool) return { mode: openWbnb > 0n ? "unpriced" : "realized", pool: null, realizedPnlCake, unrealizedPnlCake: null, totalPnlCake: realizedPnlCake, percentage: null, openWbnb, costBasisCake };

  const [slot0, cakeDecimals, wbnbDecimals, latestBlock] = await Promise.all([
    publicClient.readContract({ address: pool.pool, abi: POOL_ABI, functionName: "slot0" }),
    publicClient.readContract({ address: CAKE2, abi: ERC20_ABI, functionName: "decimals" }),
    publicClient.readContract({ address: WBNB, abi: ERC20_ABI, functionName: "decimals" }),
    publicClient.getBlockNumber(),
  ]);

  const sqrtPriceX96 = slot0[0];
  if (sqrtPriceX96 <= 0n) throw new Error("Pancake V3 pool has no usable spot price");
  const rawToken1PerToken0 = Number((sqrtPriceX96 * sqrtPriceX96)) / Number(2n ** 192n);
  if (!(rawToken1PerToken0 > 0)) throw new Error("Unable to derive current Pancake V3 spot price");

  const cakeIsToken0 = CAKE2.toLowerCase() < WBNB.toLowerCase();
  const humanToken1PerToken0 = rawToken1PerToken0 * (10 ** (cakeIsToken0 ? Number(cakeDecimals) - Number(wbnbDecimals) : Number(wbnbDecimals) - Number(cakeDecimals)));
  const currentWbnbPerCake = cakeIsToken0 ? humanToken1PerToken0 : 1 / humanToken1PerToken0;
  const currentCakePerWbnb = 1 / currentWbnbPerCake;

  const markWbnbHuman = Number(formatUnits(openWbnb, Number(wbnbDecimals)));
  const remainingCostCakeHuman = Number(formatUnits(costBasisCake, Number(cakeDecimals)));
  const markedValueCakeHuman = markWbnbHuman * currentCakePerWbnb;
  const unrealizedPnlCakeHuman = openWbnb > 0n ? markedValueCakeHuman - remainingCostCakeHuman : 0;
  const realizedPnlCakeHuman = Number(formatUnits(realizedPnlCake, Number(cakeDecimals)));
  const totalPnlCakeHuman = realizedPnlCakeHuman + unrealizedPnlCakeHuman;
  const percentage = remainingCostCakeHuman > 0 ? (unrealizedPnlCakeHuman / remainingCostCakeHuman) * 100 : null;

  return {
    mode: openWbnb > 0n ? "unrealized" : "realized",
    pool,
    blockNumber: latestBlock,
    cakeDecimals: Number(cakeDecimals),
    wbnbDecimals: Number(wbnbDecimals),
    currentWbnbPerCake,
    currentCakePerWbnb,
    remainingWbnb: formatUnits(openWbnb, Number(wbnbDecimals)),
    remainingCostBasisCake2: formatUnits(costBasisCake, Number(cakeDecimals)),
    markedValueCake2: fixed(markedValueCakeHuman),
    unrealizedPnlCake2: fixed(unrealizedPnlCakeHuman),
    realizedPnlCake2: fixed(realizedPnlCakeHuman),
    totalPnlCake2: fixed(totalPnlCakeHuman),
    pnlPercentage: percentage === null ? null : fixed(percentage, 4),
    realized,
  };
}

export default async function handler(req, res) {
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
      const computedHash = keccak256(bytes);
      if (String(archived.onchain_deliverable_hash || "").toLowerCase() === computedHash.toLowerCase()) {
        const archivedCandidate = findTransactionHash(parseArchivedContent(bytes));
        if (archivedCandidate) { transactionCandidate = archivedCandidate; candidateSource = "verified_erc8183_deliverable_archive"; }
      }
    }

    const txHash = isHash(transactionCandidate) ? transactionCandidate : null;
    if (!txHash) return res.status(200).json({ ok: true, observed: false, job_id: Number(job.chain_job_id), network: "bsc-testnet", chain_id: 97, source: "agentmarket_independent_bsc_rpc_verification", message: "No execution transaction could be located from verified AgentMarket evidence yet." });

    await supabase.from("execution_capital_execution_evidence").upsert({
      execution_capital_request_id: request?.id ?? null,
      job_id: String(job.id),
      chain_id: 97,
      execution_id: `deliverable-pointer-${Number(job.chain_job_id)}`,
      calls_id: null,
      executor_status: "candidate_from_verified_deliverable",
      transaction_hash: txHash,
      receipt: null,
      receipt_verified: false,
      calls: [],
      source: candidateSource || "execution_evidence_locator",
    }, { onConflict: "execution_capital_request_id,execution_id" });

    const executionWallet = isAddress(request?.user_execution_wallet) ? request.user_execution_wallet : null;
    const sessionKey = isAddress(request?.agent_session_key) ? request.agent_session_key : null;
    const verified = executionWallet ? await classifyExecution(txHash, executionWallet) : null;
    if (!verified) return res.status(200).json({ ok: true, observed: false, job_id: Number(job.chain_job_id), network: "bsc-testnet", chain_id: 97, source: "agentmarket_independent_bsc_rpc_verification", transaction_hash: txHash, message: "Transaction is recorded, but the receipt is not yet independently observable." });

    const pnl = executionWallet ? await calculatePnl([verified], executionWallet) : null;
    const accounting = pnl && pnl.mode !== "unpriced" ? {
      capital_deployed: formatUnits(verified.cakeOut, 18),
      capital_deployed_token: "CAKE2",
      realized_pnl: pnl.mode === "realized" ? pnl.realizedPnlCake2 : null,
      realized_pnl_token: pnl.mode === "realized" ? "CAKE2" : null,
      unrealized_pnl: pnl.mode === "unrealized" ? pnl.unrealizedPnlCake2 : null,
      unrealized_pnl_token: pnl.mode === "unrealized" ? "CAKE2" : null,
      total_pnl: pnl.totalPnlCake2,
      total_pnl_token: "CAKE2",
      pnl_percentage: pnl.pnlPercentage,
      pnl_status: pnl.mode === "unrealized" ? "live_mark_to_market" : "realized_from_verified_round_trip",
      pnl_basis: pnl.mode === "unrealized" ? "Verified execution cost basis marked against the current Pancake V3 slot0 price from the verified pool." : "Verified CAKE2→WBNB and WBNB→CAKE2 execution transfers matched to the same execution wallet.",
    } : {
      capital_deployed: formatUnits(verified.cakeOut, 18),
      capital_deployed_token: "CAKE2",
      realized_pnl: null,
      realized_pnl_token: null,
      unrealized_pnl: null,
      unrealized_pnl_token: null,
      total_pnl: null,
      total_pnl_token: null,
      pnl_percentage: null,
      pnl_status: "unpriced",
      pnl_basis: "Verified execution was observed, but a matching Pancake V3 pool/spot price was not available.",
    };

    return res.status(200).json({
      ok: true,
      observed: true,
      job_id: jobId,
      network: "bsc-testnet",
      chain_id: 97,
      transaction_hash: verified.receipt.transactionHash,
      execution: {
        status: verified.receipt.status,
        block_number: verified.receipt.blockNumber.toString(),
        block_hash: verified.receipt.blockHash,
        gas_used: verified.receipt.gasUsed.toString(),
        effective_gas_price: verified.receipt.effectiveGasPrice.toString(),
        from: (await publicClient.getTransaction({ hash: txHash })).from,
        to: (await publicClient.getTransaction({ hash: txHash })).to,
        session_key: sessionKey,
        execution_wallet: executionWallet,
      },
      market: {
        verified_onchain: Boolean(verified.pool && (verified.cakeOut > 0n || verified.wbnbOut > 0n)),
        token_in: CAKE2,
        token_in_symbol: "CAKE2",
        token_in_amount: formatUnits(verified.cakeOut, 18),
        token_out: WBNB,
        token_out_symbol: "WBNB",
        token_out_amount: formatUnits(verified.wbnbIn, 18),
        fee: verified.pool?.fee ?? null,
        pool: verified.pool?.pool ?? null,
      },
      accounting,
      source: "agentmarket_independent_bsc_rpc_verification",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to independently verify execution on BSC Testnet";
    return res.status(503).json({ ok: false, observed: false, error: message, network: "bsc-testnet", chain_id: 97, source: "agentmarket_independent_bsc_rpc_verification" });
  }
}
