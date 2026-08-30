import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, decodeEventLog, http, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

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
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
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

function formatUnits(value: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function signedFixed(value: number) {
  return value.toFixed(8).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

async function findPool(receiptLogs: readonly { address: Address }[]) {
  for (const fee of POOL_FEES) {
    try {
      const pool = await publicClient.readContract({
        address: PANCAKE_V3_FACTORY,
        abi: FACTORY_ABI,
        functionName: "getPool",
        args: [CAKE2, WBNB, fee],
      });
      if (
        isAddress(pool) &&
        pool.toLowerCase() !== ZERO_ADDRESS.toLowerCase() &&
        receiptLogs.some((log) => log.address.toLowerCase() === pool.toLowerCase())
      ) {
        return { pool, fee };
      }
    } catch {}
  }
  return null;
}

async function classifyExecution(txHash: Hex, executionWallet: Address) {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") return null;
    const transfers: Array<{ token: Address; from: Address; to: Address; value: bigint }> = [];

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics, strict: false });
        if (decoded.eventName !== "Transfer") continue;
        const args = decoded.args as { from: Address; to: Address; value: bigint };
        if (isAddress(log.address) && isAddress(args.from) && isAddress(args.to) && typeof args.value === "bigint") {
          transfers.push({ token: log.address, from: args.from, to: args.to, value: args.value });
        }
      } catch {}
    }

    const wallet = executionWallet.toLowerCase();
    const cakeOut = transfers
      .filter((event) => event.token.toLowerCase() === CAKE2.toLowerCase() && event.from.toLowerCase() === wallet && event.value > 0n)
      .reduce((sum, event) => sum + event.value, 0n);
    const cakeIn = transfers
      .filter((event) => event.token.toLowerCase() === CAKE2.toLowerCase() && event.to.toLowerCase() === wallet && event.value > 0n)
      .reduce((sum, event) => sum + event.value, 0n);
    const wbnbOut = transfers
      .filter((event) => event.token.toLowerCase() === WBNB.toLowerCase() && event.from.toLowerCase() === wallet && event.value > 0n)
      .reduce((sum, event) => sum + event.value, 0n);
    const wbnbIn = transfers
      .filter((event) => event.token.toLowerCase() === WBNB.toLowerCase() && event.to.toLowerCase() === wallet && event.value > 0n)
      .reduce((sum, event) => sum + event.value, 0n);

    const pool = await findPool(receipt.logs.map((log) => ({ address: log.address })));
    return {
      hash: txHash,
      blockNumber: receipt.blockNumber,
      receipt,
      pool,
      cakeIn,
      cakeOut,
      wbnbIn,
      wbnbOut,
      entry: cakeOut > 0n && wbnbIn > 0n,
      exit: wbnbOut > 0n && cakeIn > 0n,
    };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });
  const jobId = typeof req.query?.job === "string" ? req.query.job.trim() : "";
  if (!jobId) return res.status(400).json({ error: "job is required" });

  try {
    const supabase = serverClient();
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id,mission_task_id,client_wallet,chain_job_id")
      .eq("id", jobId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ error: "You do not own this job" });
    }

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
    if (!mission || mission.user_id !== auth.user.id) return res.status(403).json({ error: "You do not own this mission" });

    const { data: request, error: requestError } = await supabase
      .from("execution_capital_requests")
      .select("id,user_execution_wallet,evidence")
      .eq("job_id", job.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (requestError) throw new Error(requestError.message);

    const executionWallet = isAddress(request?.user_execution_wallet) ? request.user_execution_wallet as Address : null;
    if (!executionWallet) throw new Error("No verified execution wallet is available for P&L calculation");

    const evidenceRoot = object(request?.evidence);
    const embeddedExecutions = Array.isArray(evidenceRoot.executions) ? evidenceRoot.executions : [];
    const embeddedHashes = embeddedExecutions
      .map((item) => typeof object(item).transaction_hash === "string" ? object(item).transaction_hash : "")
      .filter(isHash);

    const { data: evidenceRows, error: evidenceError } = await supabase
      .from("execution_capital_execution_evidence")
      .select("transaction_hash,created_at")
      .eq("job_id", job.id)
      .not("transaction_hash", "is", null)
      .order("created_at", { ascending: true });
    if (evidenceError) throw new Error(evidenceError.message);

    const hashes = Array.from(new Set([
      ...embeddedHashes,
      ...(evidenceRows || []).map((row) => row.transaction_hash).filter(isHash),
    ]));
    if (hashes.length === 0) {
      return res.status(200).json({
        ok: true,
        observed: false,
        mode: "pending",
        message: "No verified execution transaction is available for P&L calculation yet.",
        chain_id: 97,
      });
    }

    const executions = (await Promise.all(hashes.map((hash) => classifyExecution(hash, executionWallet))))
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .sort((a, b) => a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0);

    const entries = executions.filter((execution) => execution.entry);
    const exits = executions.filter((execution) => execution.exit);
    if (entries.length === 0) {
      return res.status(200).json({
        ok: true,
        observed: false,
        mode: "pending",
        message: "Verified execution exists, but no CAKE2→WBNB position entry could be established from the execution wallet's transfer logs.",
        chain_id: 97,
      });
    }

    let costBasisCake = 0n;
    let openWbnb = 0n;
    let realizedPnlCake = 0n;
    let realized = false;

    for (const execution of executions) {
      if (execution.entry) {
        costBasisCake += execution.cakeOut;
        openWbnb += execution.wbnbIn;
      } else if (execution.exit && openWbnb > 0n) {
        const exitWbnb = execution.wbnbOut > openWbnb ? openWbnb : execution.wbnbOut;
        const basisForExit = costBasisCake * exitWbnb / openWbnb;
        realizedPnlCake += execution.cakeIn - basisForExit;
        costBasisCake -= basisForExit;
        openWbnb -= exitWbnb;
        if (costBasisCake < 0n) costBasisCake = 0n;
        realized = true;
      }
    }

    const latestExecution = executions[executions.length - 1];
    const pool = latestExecution?.pool;
    if (!pool) {
      return res.status(200).json({
        ok: true,
        observed: true,
        mode: realized && openWbnb === 0n ? "realized" : "unpriced",
        chain_id: 97,
        realized_pnl: realizedPnlCake.toString(),
        realized_pnl_token: "CAKE2",
        unrealized_pnl: null,
        message: "Execution was verified, but the matching Pancake V3 pool could not be independently identified for a live mark.",
      });
    }

    const [slot0, cakeDecimals, wbnbDecimals, latestBlock] = await Promise.all([
      publicClient.readContract({ address: pool.pool, abi: POOL_ABI, functionName: "slot0" }),
      publicClient.readContract({ address: CAKE2, abi: ERC20_ABI, functionName: "decimals" }),
      publicClient.readContract({ address: WBNB, abi: ERC20_ABI, functionName: "decimals" }),
      publicClient.getBlockNumber(),
    ]);

    const sqrtPriceX96 = slot0[0];
    if (sqrtPriceX96 <= 0n) throw new Error("Pancake V3 pool has no usable spot price");

    const q192 = 2n ** 192n;
    const rawToken1PerToken0 = sqrtPriceX96 * sqrtPriceX96;

    let currentWbnbPerCake = Number(rawToken1PerToken0) / Number(q192);
    const decimalAdjustment = 10 ** (Number(cakeDecimals) - Number(wbnbDecimals));
    currentWbnbPerCake *= decimalAdjustment;
    if (!(currentWbnbPerCake > 0)) throw new Error("Unable to derive current Pancake V3 spot price");

    const currentCakePerWbnb = 1 / currentWbnbPerCake;
    const markWbnbHuman = Number(formatUnits(openWbnb, Number(wbnbDecimals)));
    const remainingCostCakeHuman = Number(formatUnits(costBasisCake, Number(cakeDecimals)));
    const markedValueCakeHuman = markWbnbHuman * currentCakePerWbnb;
    const unrealizedPnlCakeHuman = markedValueCakeHuman - remainingCostCakeHuman;
    const realizedPnlCakeHuman = Number(formatUnits(realizedPnlCake, Number(cakeDecimals)));
    const totalPnlCakeHuman = realizedPnlCakeHuman + unrealizedPnlCakeHuman;
    const percentage = remainingCostCakeHuman > 0 ? (unrealizedPnlCakeHuman / remainingCostCakeHuman) * 100 : null;

    const mode = openWbnb > 0n ? "unrealized" : "realized";
    return res.status(200).json({
      ok: true,
      observed: true,
      mode,
      chain_id: 97,
      network: "bsc-testnet",
      block_number: latestBlock.toString(),
      pool: pool.pool,
      pool_fee: pool.fee,
      mark_source: "pancake_v3_slot0_onchain",
      quote: {
        token_in: CAKE2,
        token_out: WBNB,
        wbnb_per_cake2: signedFixed(currentWbnbPerCake),
        cake2_per_wbnb: signedFixed(currentCakePerWbnb),
      },
      position: {
        remaining_wbnb: formatUnits(openWbnb, Number(wbnbDecimals)),
        remaining_cost_basis_cake2: formatUnits(costBasisCake, Number(cakeDecimals)),
        marked_value_cake2: signedFixed(markedValueCakeHuman),
      },
      realized: {
        pnl_cake2: signedFixed(realizedPnlCakeHuman),
        available: realized,
      },
      unrealized: {
        pnl_cake2: signedFixed(unrealizedPnlCakeHuman),
        percent: percentage === null ? null : signedFixed(percentage),
      },
      total: {
        pnl_cake2: signedFixed(totalPnlCakeHuman),
      },
      gas: {
        execution_transaction_count: executions.length,
        excluded_from_pnl: true,
        basis: "Native gas is reported separately because the execution transaction is paid in BNB/native gas; it is not silently converted into CAKE2.",
      },
      source: "agentmarket_independent_bsc_rpc_mark_to_market",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to independently calculate execution P&L";
    return res.status(503).json({ ok: false, observed: false, error: message, chain_id: 97, network: "bsc-testnet" });
  }
}
