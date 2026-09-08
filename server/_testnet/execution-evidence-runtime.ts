import { createPublicClient, decodeEventLog, formatUnits, http, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
import { invokeProviderOperation, resolveProviderOperation } from "./provider-operation.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

const JOB_ABI = [{
  type: "function",
  name: "getJob",
  stateMutability: "view",
  inputs: [{ name: "jobId", type: "uint256" }],
  outputs: [{ name: "job", type: "tuple", components: [
    { name: "id", type: "uint256" },
    { name: "client", type: "address" },
    { name: "provider", type: "address" },
    { name: "evaluator", type: "address" },
    { name: "description", type: "string" },
    { name: "budget", type: "uint256" },
    { name: "expiredAt", type: "uint256" },
    { name: "status", type: "uint8" },
    { name: "hook", type: "address" },
    { name: "submittedAt", type: "uint256" },
    { name: "deliverable", type: "bytes32" },
  ] }],
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

// Uniswap/Pancake V3-style pool event. Pancake V3 includes the protocol-fee fields.
const V3_SWAP_ABI = [{
  type: "event",
  name: "Swap",
  anonymous: false,
  inputs: [
    { name: "sender", type: "address", indexed: true },
    { name: "recipient", type: "address", indexed: true },
    { name: "amount0", type: "int256", indexed: false },
    { name: "amount1", type: "int256", indexed: false },
    { name: "sqrtPriceX96", type: "uint160", indexed: false },
    { name: "liquidity", type: "uint128", indexed: false },
    { name: "tick", type: "int24", indexed: false },
    { name: "protocolFeesToken0", type: "uint128", indexed: false },
    { name: "protocolFeesToken1", type: "uint128", indexed: false },
  ],
}] as const;

const V2_SWAP_ABI = [{
  type: "event",
  name: "Swap",
  anonymous: false,
  inputs: [
    { name: "sender", type: "address", indexed: true },
    { name: "amount0In", type: "uint256", indexed: false },
    { name: "amount1In", type: "uint256", indexed: false },
    { name: "amount0Out", type: "uint256", indexed: false },
    { name: "amount1Out", type: "uint256", indexed: false },
    { name: "to", type: "address", indexed: true },
  ],
}] as const;

const ERC20_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const V3_POOL_ABI = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
] as const;

const OPTIONAL_FEE_ABI = [
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "swapFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

type EndpointRecord = {
  endpoint_url: string;
  protocol: string;
  status: string;
  metadata?: unknown;
  version?: string | null;
};

type TransferRecord = {
  token: Address;
  from: Address;
  to: Address;
  value: bigint;
  logIndex: number | null;
};

type TokenMeta = {
  symbol: string | null;
  decimals: number;
};

type SwapEvidence = {
  kind: "v3" | "v2" | "wallet-net";
  pool: Address | null;
  fee: string | null;
  fee_raw: string | null;
  tokenIn: Address;
  tokenOut: Address;
  amountInRaw: bigint;
  amountOutRaw: bigint;
  logIndex: number | null;
  verified: boolean;
};

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function safeJson(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry));
}

function parseContent(text: string): unknown {
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
  for (const key of [
    "execution_result",
    "execution",
    "evidence",
    "transactions",
    "receipt",
    "response",
    "content",
    "result",
    "metadata",
  ]) {
    const nested = findTransactionHash(record[key]);
    if (nested) return nested;
  }
  return null;
}

function decodeTransfers(receipt: any): TransferRecord[] {
  const transfers: TransferRecord[] = [];
  for (const log of receipt.logs || []) {
    try {
      const decoded = decodeEventLog({
        abi: TRANSFER_ABI,
        data: log.data,
        topics: log.topics,
        strict: false,
      });
      const args = object(decoded.args);
      if (
        decoded.eventName === "Transfer" &&
        isAddress(log.address) &&
        isAddress(args.from) &&
        isAddress(args.to) &&
        typeof args.value === "bigint"
      ) {
        transfers.push({
          token: log.address,
          from: args.from,
          to: args.to,
          value: args.value,
          logIndex: typeof log.logIndex === "number" ? log.logIndex : null,
        });
      }
    } catch {
      // Ignore non-ERC20 Transfer logs.
    }
  }
  return transfers;
}

function extractCapability(request: any) {
  const requestEvidence = object(request?.evidence);
  const capability = object(requestEvidence.execution_capability);
  const execution = object(capability.execution);
  const capabilityMarket = object(capability.execution_market);
  const sessionKey = isAddress(capability.session_key_address) ? capability.session_key_address : null;
  const allowedTargets = Array.isArray(capability.allowed_targets)
    ? capability.allowed_targets.filter(isAddress)
    : [];
  return {
    capability,
    capabilityMarket,
    sessionKey,
    allowedTargets,
    executionMode: typeof capability.execution === "string"
      ? capability.execution
      : typeof execution.mode === "string"
        ? execution.mode
        : null,
  };
}

async function loadProviderResult(
  supabase: ReturnType<typeof serverClient>,
  chainJobId: number,
  clientWallet: string,
  providerWallet: string,
) {
  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id,agent_id,name")
    .ilike("owner", providerWallet)
    .limit(1)
    .maybeSingle();
  if (agentError) throw new Error(agentError.message);
  if (!agent) return null;

  const { data: endpoints, error: endpointError } = await supabase
    .from("agent_endpoints")
    .select("endpoint_url,protocol,status,metadata,version")
    .eq("agent_id", String(agent.id))
    .order("last_checked_at", { ascending: false })
    .limit(20);
  if (endpointError) throw new Error(endpointError.message);

  for (const endpoint of (endpoints || []) as EndpointRecord[]) {
    const operation = await resolveProviderOperation(endpoint, "result");
    if (!operation) continue;
    try {
      const result = await invokeProviderOperation(operation, {
        chain_job_id: chainJobId,
        job_id: chainJobId,
        agent_id: agent.agent_id,
        client_wallet: clientWallet,
        provider_wallet: providerWallet,
        network: "bsc-testnet",
      });
      return {
        rawText: result.rawText || "",
        endpoint: result.endpoint,
        agentId: agent.agent_id,
        agentName: agent.name,
        operation,
      };
    } catch {
      // Try another discovered result operation.
    }
  }
  return null;
}

async function tokenMeta(token: Address): Promise<TokenMeta> {
  const [symbolResult, decimalsResult] = await Promise.allSettled([
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
  ]);
  const symbol = symbolResult.status === "fulfilled" && typeof symbolResult.value === "string"
    ? symbolResult.value
    : null;
  const decimals = decimalsResult.status === "fulfilled"
    ? Number(decimalsResult.value)
    : 18;
  return { symbol, decimals: Number.isFinite(decimals) ? decimals : 18 };
}

async function poolMeta(pool: Address) {
  let token0: Address | null = null;
  let token1: Address | null = null;
  let feeRaw: bigint | null = null;

  const [token0Result, token1Result, feeResult] = await Promise.allSettled([
    publicClient.readContract({ address: pool, abi: V3_POOL_ABI, functionName: "token0" }),
    publicClient.readContract({ address: pool, abi: V3_POOL_ABI, functionName: "token1" }),
    publicClient.readContract({ address: pool, abi: V3_POOL_ABI, functionName: "fee" }),
  ]);
  if (token0Result.status === "fulfilled" && isAddress(token0Result.value)) token0 = token0Result.value;
  if (token1Result.status === "fulfilled" && isAddress(token1Result.value)) token1 = token1Result.value;
  if (feeResult.status === "fulfilled") feeRaw = BigInt(feeResult.value as any);

  if (feeRaw === null) {
    for (const functionName of ["fee", "swapFee"] as const) {
      try {
        const result = await publicClient.readContract({ address: pool, abi: OPTIONAL_FEE_ABI, functionName });
        feeRaw = BigInt(result as any);
        break;
      } catch {
        // Not every pool exposes a fee getter.
      }
    }
  }

  return { token0, token1, feeRaw };
}

function walletNetDeltas(wallet: string, transfers: TransferRecord[]) {
  const normalized = wallet.toLowerCase();
  const deltas = new Map<string, { token: Address; net: bigint; outbound: bigint; inbound: bigint }>();
  for (const transfer of transfers) {
    const key = transfer.token.toLowerCase();
    if (!deltas.has(key)) deltas.set(key, { token: transfer.token, net: 0n, outbound: 0n, inbound: 0n });
    const current = deltas.get(key)!;
    if (transfer.from.toLowerCase() === normalized) {
      current.outbound += transfer.value;
      current.net -= transfer.value;
    }
    if (transfer.to.toLowerCase() === normalized) {
      current.inbound += transfer.value;
      current.net += transfer.value;
    }
  }
  return [...deltas.values()].filter((entry) => entry.net !== 0n);
}

function walletTransferScore(wallet: string, transfers: TransferRecord[]) {
  const normalized = wallet.toLowerCase();
  const related = transfers.filter((transfer) => transfer.from.toLowerCase() === normalized || transfer.to.toLowerCase() === normalized);
  const contractsTouched = new Set<string>();
  for (const transfer of related) {
    const other = transfer.from.toLowerCase() === normalized ? transfer.to : transfer.from;
    if (other !== normalized) contractsTouched.add(other.toLowerCase());
  }
  return {
    count: related.length,
    totalValue: related.reduce((sum, transfer) => sum + transfer.value, 0n),
    counterparties: contractsTouched.size,
  };
}

function selectExecutionWallet(
  preferredWallets: string[],
  txFrom: string | null,
  transfers: TransferRecord[],
): string | null {
  const candidates = [...new Set([...preferredWallets, txFrom || ""].filter(isAddress).map((value) => value.toLowerCase()))];
  if (candidates.length === 0) return isAddress(txFrom) ? txFrom : null;
  let best: { wallet: string; count: number; totalValue: bigint; counterparties: number } | null = null;
  for (const wallet of candidates) {
    const score = walletTransferScore(wallet, transfers);
    if (
      !best ||
      score.count > best.count ||
      (score.count === best.count && score.counterparties > best.counterparties) ||
      (score.count === best.count && score.counterparties === best.counterparties && score.totalValue > best.totalValue)
    ) {
      best = { wallet, ...score };
    }
  }
  return best?.wallet || null;
}

async function findSwapEvidence(receipt: any, executionWallet: string | null, transfers: TransferRecord[]): Promise<SwapEvidence | null> {
  const net = executionWallet ? walletNetDeltas(executionWallet, transfers) : [];
  const netMap = new Map(net.map((entry) => [entry.token.toLowerCase(), entry.net]));

  for (const log of receipt.logs || []) {
    if (!isAddress(log.address)) continue;
    try {
      const decoded = decodeEventLog({ abi: V3_SWAP_ABI, data: log.data, topics: log.topics, strict: false });
      const args = object(decoded.args);
      if (decoded.eventName !== "Swap") continue;
      const meta = await poolMeta(log.address);
      if (!meta.token0 || !meta.token1 || typeof args.amount0 !== "bigint" || typeof args.amount1 !== "bigint") continue;

      let tokenIn: Address;
      let tokenOut: Address;
      let amountInRaw: bigint;
      let amountOutRaw: bigint;
      if (args.amount0 > 0n && args.amount1 < 0n) {
        tokenIn = meta.token0;
        tokenOut = meta.token1;
        amountInRaw = args.amount0;
        amountOutRaw = -args.amount1;
      } else if (args.amount1 > 0n && args.amount0 < 0n) {
        tokenIn = meta.token1;
        tokenOut = meta.token0;
        amountInRaw = args.amount1;
        amountOutRaw = -args.amount0;
      } else {
        continue;
      }

      const matchesWallet = executionWallet
        ? (netMap.get(tokenIn.toLowerCase()) || 0n) < 0n && (netMap.get(tokenOut.toLowerCase()) || 0n) > 0n
        : true;
      if (!matchesWallet) continue;

      return {
        kind: "v3",
        pool: log.address,
        fee: meta.feeRaw === null ? null : String(Number(meta.feeRaw) / 1_000_000),
        fee_raw: meta.feeRaw?.toString() || null,
        tokenIn,
        tokenOut,
        amountInRaw,
        amountOutRaw,
        logIndex: typeof log.logIndex === "number" ? log.logIndex : null,
        verified: true,
      };
    } catch {
      // Try another log/event family.
    }
  }

  for (const log of receipt.logs || []) {
    if (!isAddress(log.address)) continue;
    try {
      const decoded = decodeEventLog({ abi: V2_SWAP_ABI, data: log.data, topics: log.topics, strict: false });
      const args = object(decoded.args);
      if (decoded.eventName !== "Swap") continue;
      const pairMeta = await poolMeta(log.address);
      if (!pairMeta.token0 || !pairMeta.token1) continue;
      const amount0In = typeof args.amount0In === "bigint" ? args.amount0In : 0n;
      const amount1In = typeof args.amount1In === "bigint" ? args.amount1In : 0n;
      const amount0Out = typeof args.amount0Out === "bigint" ? args.amount0Out : 0n;
      const amount1Out = typeof args.amount1Out === "bigint" ? args.amount1Out : 0n;
      let tokenIn: Address;
      let tokenOut: Address;
      let amountInRaw: bigint;
      let amountOutRaw: bigint;
      if (amount0In > 0n && amount1Out > 0n) {
        tokenIn = pairMeta.token0;
        tokenOut = pairMeta.token1;
        amountInRaw = amount0In;
        amountOutRaw = amount1Out;
      } else if (amount1In > 0n && amount0Out > 0n) {
        tokenIn = pairMeta.token1;
        tokenOut = pairMeta.token0;
        amountInRaw = amount1In;
        amountOutRaw = amount0Out;
      } else {
        continue;
      }
      const matchesWallet = executionWallet
        ? (netMap.get(tokenIn.toLowerCase()) || 0n) < 0n && (netMap.get(tokenOut.toLowerCase()) || 0n) > 0n
        : true;
      if (!matchesWallet) continue;
      return {
        kind: "v2",
        pool: log.address,
        fee: pairMeta.feeRaw === null ? null : String(Number(pairMeta.feeRaw) / 1_000_000),
        fee_raw: pairMeta.feeRaw?.toString() || null,
        tokenIn,
        tokenOut,
        amountInRaw,
        amountOutRaw,
        logIndex: typeof log.logIndex === "number" ? log.logIndex : null,
        verified: true,
      };
    } catch {
      // Continue to generic wallet-delta fallback.
    }
  }

  if (!executionWallet || net.length < 2) return null;
  const outgoing = net.filter((entry) => entry.net < 0n);
  const incoming = net.filter((entry) => entry.net > 0n);
  if (!outgoing.length || !incoming.length) return null;
  outgoing.sort((a, b) => (a.net < b.net ? -1 : 1));
  incoming.sort((a, b) => (a.net > b.net ? -1 : 1));
  const tokenIn = outgoing[0];
  const tokenOut = incoming[0];
  return {
    kind: "wallet-net",
    pool: null,
    fee: null,
    fee_raw: null,
    tokenIn: tokenIn.token,
    tokenOut: tokenOut.token,
    amountInRaw: -tokenIn.net,
    amountOutRaw: tokenOut.net,
    logIndex: null,
    verified: true,
  };
}

async function upsertEvidence(
  supabase: ReturnType<typeof serverClient>,
  requestId: string | null,
  jobId: string,
  chainJobId: number,
  transactionHash: Hex,
  source: string,
  executorStatus: string,
  receiptVerified: boolean,
  receipt: any,
  executionWallet: string | null,
  tx: any,
  transfers: TransferRecord[],
) {
  const receiptPayload = receipt ? {
    status: receipt.status || null,
    block_number: receipt.blockNumber?.toString?.() || null,
    block_hash: receipt.blockHash || null,
    gas_used: receipt.gasUsed?.toString?.() || null,
    transaction_hash: transactionHash,
    execution_wallet: executionWallet,
    tx_from: tx?.from || null,
    tx_to: tx?.to || null,
  } : null;

  const calls = transfers.map((transfer) => ({
    token: transfer.token,
    from: transfer.from,
    to: transfer.to,
    value: transfer.value.toString(),
    log_index: transfer.logIndex,
  }));

  const { error } = await supabase
    .from("execution_capital_execution_evidence")
    .upsert({
      execution_capital_request_id: requestId,
      job_id: jobId,
      chain_id: 97,
      execution_id: `provider-execution-${chainJobId}`,
      calls_id: null,
      executor_status: executorStatus,
      transaction_hash: transactionHash,
      receipt: receiptPayload,
      receipt_verified: receiptVerified,
      calls,
      source,
      recorded_at: new Date().toISOString(),
    }, { onConflict: "execution_capital_request_id,execution_id" });

  if (error) throw new Error(error.message);
}

function formatAmount(value: bigint, decimals: number) {
  return formatUnits(value, decimals);
}

async function marketEvidence(swap: SwapEvidence | null) {
  if (!swap) return null;
  const [inputMeta, outputMeta] = await Promise.all([tokenMeta(swap.tokenIn), tokenMeta(swap.tokenOut)]);
  return {
    token_in: swap.tokenIn,
    token_out: swap.tokenOut,
    token_in_symbol: inputMeta.symbol,
    token_out_symbol: outputMeta.symbol,
    token_in_amount: formatAmount(swap.amountInRaw, inputMeta.decimals),
    token_out_amount: formatAmount(swap.amountOutRaw, outputMeta.decimals),
    token_in_amount_raw: swap.amountInRaw.toString(),
    token_out_amount_raw: swap.amountOutRaw.toString(),
    token_in_decimals: inputMeta.decimals,
    token_out_decimals: outputMeta.decimals,
    fee: swap.fee,
    fee_raw: swap.fee_raw,
    pool: swap.pool,
    swap_event_verified: swap.kind !== "wallet-net",
    swap_event_kind: swap.kind,
    swap_log_index: swap.logIndex,
    execution_effects_verified: true,
  };
}

function accountingFromMarket(market: any) {
  if (!market) return null;
  return {
    capital_deployed: market.token_in_amount,
    capital_deployed_token: market.token_in_symbol || market.token_in,
    capital_deployed_raw: market.token_in_amount_raw,
    capital_deployed_decimals: market.token_in_decimals,
    pnl_status: "unpriced",
    realized_pnl: null,
    unrealized_pnl: null,
    pnl_token: market.token_in_symbol || market.token_in,
    source: "agentmarket_chain_verifier",
  };
}

async function deliverableHash(rawText: string, expectedHash: string | null) {
  if (!rawText || !expectedHash || !isHash(expectedHash)) {
    return { checked: false, matches: null, computed_hash: null, expected_hash: expectedHash };
  }
  const { keccak256 } = await import("viem");
  const computed = keccak256(new TextEncoder().encode(rawText));
  return {
    checked: true,
    matches: computed.toLowerCase() === expectedHash.toLowerCase(),
    computed_hash: computed,
    expected_hash: expectedHash,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  const rawJob = typeof req.query?.job === "string" ? req.query.job.trim() : "";
  if (!/^\d+$/.test(rawJob)) return res.status(400).json({ error: "job is required" });
  const chainJobId = Number(rawJob);

  try {
    const chainJob: any = await publicClient.readContract({
      address: COMMERCE,
      abi: JOB_ABI,
      functionName: "getJob",
      args: [BigInt(chainJobId)],
    });
    if (!chainJob || chainJob.id === 0n) return res.status(404).json({ error: "ERC-8183 job not found" });
    if (String(chainJob.client).toLowerCase() !== String(auth.user.wallet_address).toLowerCase()) {
      return res.status(403).json({ error: "This job is not owned by the connected client wallet" });
    }

    const supabase = serverClient();
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id,chain_job_id,client_wallet,mission_task_id")
      .eq("chain_job_id", chainJobId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return res.status(404).json({ error: "Marketplace job record not found" });

    const { data: request, error: requestError } = await supabase
      .from("execution_capital_requests")
      .select("id,user_execution_wallet,agent_session_key,status,evidence")
      .eq("job_id", job.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (requestError) throw new Error(requestError.message);

    const capability = extractCapability(request);
    const preferredWallets = [request?.user_execution_wallet, request?.agent_session_key, capability.sessionKey].filter(isAddress);
    const requestEvidence = object(request?.evidence);
    const lastExecution = object(requestEvidence.last_execution);

    const { data: storedEvidence, error: storedEvidenceError } = await supabase
      .from("execution_capital_execution_evidence")
      .select("id,transaction_hash,receipt_verified,executor_status,receipt,source,created_at")
      .eq("job_id", job.id)
      .not("transaction_hash", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (storedEvidenceError) throw new Error(storedEvidenceError.message);

    // A transaction hash is only a locator. No execution facts are trusted from the agent response.
    let transactionHash: Hex | null = isHash(storedEvidence?.transaction_hash)
      ? storedEvidence.transaction_hash
      : isHash(lastExecution.transaction_hash)
        ? lastExecution.transaction_hash
        : null;
    let source = storedEvidence?.transaction_hash
      ? "execution_capital_execution_evidence"
      : lastExecution.transaction_hash
        ? "execution_locator"
        : "";
    let providerRawText = "";
    let providerEndpoint: string | null = null;
    let providerResultUsed = false;
    let deliverableChecked = false;
    let deliverableMatches: boolean | null = null;
    let deliverableComputedHash: string | null = null;

    if (!transactionHash) {
      const providerResult = await loadProviderResult(
        supabase,
        chainJobId,
        String(auth.user.wallet_address),
        String(chainJob.provider),
      );
      if (providerResult) {
        providerResultUsed = true;
        providerRawText = providerResult.rawText;
        providerEndpoint = providerResult.endpoint;
        transactionHash = findTransactionHash(parseContent(providerResult.rawText));
        if (transactionHash) source = "provider_transaction_locator";
        if (providerResult.rawText && isHash(chainJob.deliverable)) {
          const verification = await deliverableHash(providerResult.rawText, chainJob.deliverable);
          deliverableChecked = verification.checked;
          deliverableMatches = verification.matches;
          deliverableComputedHash = verification.computed_hash;
        }
      }
    }

    let archive: any = null;
    if (!transactionHash && [2, 3].includes(Number(chainJob.status))) {
      const { data: archived, error: archiveError } = await supabase
        .from("erc8183_deliverable_archives")
        .select("content_base64,onchain_deliverable_hash,verified,provider_endpoint,captured_at,capture_source,verification_error")
        .eq("chain_id", 97)
        .ilike("commerce_address", COMMERCE)
        .eq("job_id", chainJobId)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (archiveError) throw new Error(archiveError.message);
      archive = archived;
      if (archived?.content_base64) {
        const bytes = new Uint8Array(Buffer.from(archived.content_base64, "base64"));
        const content = parseContent(new TextDecoder().decode(bytes));
        const candidate = findTransactionHash(content);
        if (candidate) {
          transactionHash = candidate;
          source = "deliverable_transaction_locator";
        }
        if (isHash(chainJob.deliverable)) {
          const rawText = new TextDecoder().decode(bytes);
          const verification = await deliverableHash(rawText, chainJob.deliverable);
          deliverableChecked = verification.checked;
          deliverableMatches = verification.matches;
          deliverableComputedHash = verification.computed_hash;
        }
      }
    }

    if (!transactionHash) {
      return res.status(200).json({
        ok: true,
        observed: false,
        job_id: chainJobId,
        network: "bsc-testnet",
        chain_id: 97,
        source: "agentmarket_execution_evidence_runtime",
        message: "No execution transaction locator is available yet.",
        observation_mode: "awaiting_transaction_hash",
        deliverable_verification: {
          checked: deliverableChecked,
          matches: deliverableMatches,
          computed_hash: deliverableComputedHash,
          expected_hash: chainJob.deliverable,
        },
      });
    }

    let tx: any = null;
    let receipt: any = null;
    try {
      [tx, receipt] = await Promise.all([
        publicClient.getTransaction({ hash: transactionHash }),
        publicClient.getTransactionReceipt({ hash: transactionHash }),
      ]);
    } catch (error) {
      try {
        await upsertEvidence(
          supabase,
          request?.id || null,
          job.id,
          chainJobId,
          transactionHash,
          source || "execution_evidence",
          "receipt_pending",
          false,
          null,
          null,
          null,
          [],
        );
      } catch {
        // Do not hide the pending-chain state if persistence fails.
      }
      return res.status(200).json({
        ok: true,
        observed: false,
        job_id: chainJobId,
        network: "bsc-testnet",
        chain_id: 97,
        transaction_hash: transactionHash,
        source: source || "execution_evidence",
        observation_mode: "receipt_pending",
        execution: {
          status: null,
          receipt_verified: false,
          execution_wallet: preferredWallets[0] || null,
          tx_from: null,
          tx_to: null,
        },
        market: {
          verified_onchain: false,
          receipt_verified: false,
          transfer_count: 0,
          token_in: null,
          token_out: null,
          token_in_symbol: null,
          token_out_symbol: null,
          token_in_amount: null,
          token_out_amount: null,
          fee: null,
          pool: null,
        },
        accounting: null,
        deliverable_verification: {
          checked: deliverableChecked,
          matches: deliverableMatches,
          computed_hash: deliverableComputedHash,
          expected_hash: chainJob.deliverable,
        },
        message: error instanceof Error
          ? `Transaction identified; receipt is not observable yet: ${error.message}`
          : "Transaction identified; receipt is not observable yet.",
      });
    }

    const transfers = decodeTransfers(receipt);
    const executionWallet = selectExecutionWallet(preferredWallets, tx?.from || null, transfers);
    const receiptVerified = receipt?.status === "success";
    const executorStatus = receiptVerified ? "verified_onchain" : "failed";
    const swap = receiptVerified ? await findSwapEvidence(receipt, executionWallet, transfers) : null;
    const market = await marketEvidence(swap);
    const accounting = accountingFromMarket(market);
    const walletTransfers = executionWallet
      ? transfers.filter((entry) => entry.from.toLowerCase() === executionWallet!.toLowerCase() || entry.to.toLowerCase() === executionWallet!.toLowerCase())
      : [];
    const assetAddresses = [...new Set(walletTransfers.map((entry) => entry.token.toLowerCase()))];
    const effectVerified = receiptVerified && Boolean(market?.execution_effects_verified);

    await upsertEvidence(
      supabase,
      request?.id || null,
      job.id,
      chainJobId,
      transactionHash,
      source || "execution_evidence",
      executorStatus,
      receiptVerified,
      receipt,
      executionWallet,
      tx,
      transfers,
    );

    return res.status(200).json({
      ok: true,
      observed: receiptVerified,
      job_id: chainJobId,
      network: "bsc-testnet",
      chain_id: 97,
      transaction_hash: transactionHash,
      source: source || "execution_evidence",
      observation_mode: swap?.kind === "wallet-net"
        ? "receipt_and_wallet_balance_deltas"
        : effectVerified
          ? "receipt_and_swap_event"
          : receiptVerified
            ? "receipt_only"
            : "transaction_failed",
      execution: {
        status: receipt?.status || null,
        block_number: receipt?.blockNumber?.toString?.() || null,
        block_hash: receipt?.blockHash || null,
        gas_used: receipt?.gasUsed?.toString?.() || null,
        execution_wallet: executionWallet,
        tx_from: tx?.from || null,
        tx_to: tx?.to || null,
        receipt_verified: receiptVerified,
      },
      market: {
        verified_onchain: receiptVerified,
        receipt_verified: receiptVerified,
        ...(market || {
          token_in: null,
          token_out: null,
          token_in_symbol: null,
          token_out_symbol: null,
          token_in_amount: null,
          token_out_amount: null,
          token_in_amount_raw: null,
          token_out_amount_raw: null,
          token_in_decimals: null,
          token_out_decimals: null,
          fee: null,
          fee_raw: null,
          pool: null,
          swap_event_verified: false,
          swap_event_kind: null,
          swap_log_index: null,
          execution_effects_verified: false,
        }),
        transfer_count: transfers.length,
        assets_involved: assetAddresses,
      },
      effects: {
        transfer_count: transfers.length,
        execution_wallet_transfer_count: walletTransfers.length,
        assets_involved: assetAddresses,
        transfers: transfers.map((entry) => ({
          token: entry.token,
          from: entry.from,
          to: entry.to,
          value: entry.value.toString(),
          log_index: entry.logIndex,
        })),
      },
      accounting,
      provider: providerResultUsed
        ? { endpoint: providerEndpoint, result_available: true, role: "locator_only" }
        : { endpoint: archive?.provider_endpoint || null, result_available: false, role: "locator_only" },
      deliverable_verification: {
        checked: deliverableChecked,
        matches: deliverableMatches,
        computed_hash: deliverableComputedHash,
        expected_hash: chainJob.deliverable,
        independent_of_execution_observation: true,
      },
      capability: {
        execution_mode: capability.executionMode,
        session_key: capability.sessionKey,
        allowed_target_count: capability.allowedTargets.length,
      },
      verifier: {
        source_of_truth: "bsc_testnet_receipt_and_logs",
        agent_response_used_for_execution_facts: false,
        transaction_locator_only: true,
      },
    });
  } catch (error) {
    console.error("Execution evidence runtime failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to verify execution evidence" });
  }
}
