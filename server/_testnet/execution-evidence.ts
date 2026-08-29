import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, decodeEventLog, http, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const CAKE2 = "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551" as Address;
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as Address;
const PANCAKE_V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as Address;
const POOL_FEES = [100, 500, 2500, 10000] as const;

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

const ERC20_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
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

const SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe6135f1ecf99f4e2f1d6f7c6f5f3d7f" as Hex;

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function object(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function formatUnits(value: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
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
    .select("transaction_hash,receipt_verified,created_at")
    .eq("job_id", job.id)
    .not("transaction_hash", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (evidenceError) throw new Error(evidenceError.message);

  const { data: request, error: requestError } = await supabase
    .from("execution_capital_requests")
    .select("user_execution_wallet,agent_session_key,status")
    .eq("job_id", job.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (requestError) throw new Error(requestError.message);

  return { supabase, job, executionEvidence, request };
}

async function verifyOnchain(
  txHash: Hex,
  executionWallet: Address | null,
  sessionKey: Address | null,
) {
  const [transaction, receipt] = await Promise.all([
    publicClient.getTransaction({ hash: txHash }),
    publicClient.getTransactionReceipt({ hash: txHash }),
  ]);
  if (receipt.status !== "success") throw new Error("Execution transaction is not successful on BSC Testnet");

  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const transferEvents: Array<{ token: Address; from: Address; to: Address; value: bigint }> = [];
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics, strict: false });
      if (decoded.eventName !== "Transfer") continue;
      const args = decoded.args as { from: Address; to: Address; value: bigint };
      if (isAddress(log.address) && isAddress(args.from) && isAddress(args.to) && typeof args.value === "bigint") {
        transferEvents.push({ token: log.address as Address, from: args.from, to: args.to, value: args.value });
      }
    } catch {
      // Ignore non-ERC20 transfer logs.
    }
  }

  const inputWallet = executionWallet?.toLowerCase();
  const outputWallet = executionWallet?.toLowerCase();
  const tokenInTransfers = transferEvents.filter((event) => event.token.toLowerCase() === CAKE2.toLowerCase() && inputWallet && event.from.toLowerCase() === inputWallet && event.value > 0n);
  const tokenOutTransfers = transferEvents.filter((event) => event.token.toLowerCase() === WBNB.toLowerCase() && outputWallet && event.to.toLowerCase() === outputWallet && event.value > 0n);

  const tokenInRaw = tokenInTransfers.reduce((sum, event) => sum + event.value, 0n);
  const tokenOutRaw = tokenOutTransfers.reduce((sum, event) => sum + event.value, 0n);

  const poolMatches: Array<{ fee: number; pool: Address }> = [];
  for (const fee of POOL_FEES) {
    try {
      const pool = await publicClient.readContract({
        address: PANCAKE_V3_FACTORY,
        abi: FACTORY_ABI,
        functionName: "getPool",
        args: [CAKE2, WBNB, fee],
      });
      if (isAddress(pool) && pool !== "0x0000000000000000000000000000000000000000" && receipt.logs.some((log) => log.address.toLowerCase() === pool.toLowerCase())) {
        poolMatches.push({ fee, pool });
      }
    } catch {
      // Ignore unsupported/missing fee tiers.
    }
  }

  let tokenInSymbol = "CAKE2";
  let tokenOutSymbol = "WBNB";
  let tokenInDecimals = 18;
  let tokenOutDecimals = 18;
  try { tokenInDecimals = Number(await publicClient.readContract({ address: CAKE2, abi: ERC20_ABI, functionName: "decimals" })); } catch {}
  try { tokenOutDecimals = Number(await publicClient.readContract({ address: WBNB, abi: ERC20_ABI, functionName: "decimals" })); } catch {}
  try { await publicClient.readContract({ address: CAKE2, abi: ERC20_ABI, functionName: "symbol" }); } catch {}
  try { await publicClient.readContract({ address: WBNB, abi: ERC20_ABI, functionName: "symbol" }); } catch {}

  const matchedPool = poolMatches.length === 1 ? poolMatches[0] : null;
  const verifiedMarket = Boolean(matchedPool && tokenInRaw > 0n && tokenOutRaw > 0n);

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
      confirmations: "0",
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
      token_in_symbol: tokenInSymbol,
      token_in_decimals: tokenInDecimals,
      token_in_amount_raw: tokenInRaw.toString(),
      token_in_amount: formatUnits(tokenInRaw, tokenInDecimals),
      token_out: WBNB,
      token_out_symbol: tokenOutSymbol,
      token_out_decimals: tokenOutDecimals,
      token_out_amount_raw: tokenOutRaw.toString(),
      token_out_amount: formatUnits(tokenOutRaw, tokenOutDecimals),
      fee: matchedPool?.fee ?? null,
      pool: matchedPool?.pool ?? null,
    },
    accounting: {
      capital_deployed: formatUnits(tokenInRaw, tokenInDecimals),
      capital_deployed_token: tokenInSymbol,
      realized_pnl: null,
      realized_pnl_token: null,
      realized_pnl_status: "not_determinable_from_single_swap",
      realized_pnl_basis: "A single spot swap receipt proves the executed asset amounts, but it does not establish a realized P&L without an onchain accounting period, closing trade, or valuation basis.",
    },
    source: "agentmarket_independent_bsc_rpc_verification",
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });
  const jobId = typeof req.query?.job === "string" ? req.query.job.trim() : "";
  if (!jobId) return res.status(400).json({ error: "job is required" });

  try {
    const { executionEvidence, request } = await loadOwnedJob(jobId, auth.user.id, auth.user.wallet_address);
    const txHash = typeof executionEvidence?.transaction_hash === "string" && isHash(executionEvidence.transaction_hash) ? executionEvidence.transaction_hash : null;
    if (!txHash) return res.status(200).json({ ok: true, observed: false, network: "bsc-testnet", chain_id: 97, source: "agentmarket_independent_bsc_rpc_verification", message: "No execution transaction has been independently linked to this job yet." });

    const executionWallet = isAddress(request?.user_execution_wallet) ? request.user_execution_wallet as Address : null;
    const sessionKey = isAddress(request?.agent_session_key) ? request.agent_session_key as Address : null;
    const verified = await verifyOnchain(txHash, executionWallet, sessionKey);
    return res.status(200).json({ ok: true, observed: true, job_id: jobId, ...verified });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to independently verify execution on BSC Testnet";
    return res.status(503).json({ ok: false, observed: false, error: message, network: "bsc-testnet", chain_id: 97, source: "agentmarket_independent_bsc_rpc_verification" });
  }
}
