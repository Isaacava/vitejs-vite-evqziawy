import { createPublicClient, decodeEventLog, http, keccak256 } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
import { invokeProviderOperation, resolveProviderOperation } from "./provider-operation.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de";
const CAKE2 = "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551";
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865";
const ZERO = "0x0000000000000000000000000000000000000000";
const FEES = [100, 500, 2500, 10000];
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });

const JOB_ABI = [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [
  { name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" },
  { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" },
  { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" },
] }] }];
const TRANSFER_ABI = [{ type: "event", name: "Transfer", anonymous: false, inputs: [
  { name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false },
] }];
const FACTORY_ABI = [{ type: "function", name: "getPool", stateMutability: "view", inputs: [
  { name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "fee", type: "uint24" },
], outputs: [{ name: "pool", type: "address" }] }];
const TOKEN_ABI = [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }];
const POOL_ABI = [{ type: "function", name: "slot0", stateMutability: "view", inputs: [], outputs: [
  { name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" }, { name: "observationIndex", type: "uint16" },
  { name: "observationCardinality", type: "uint16" }, { name: "observationCardinalityNext", type: "uint16" }, { name: "feeProtocol", type: "uint8" }, { name: "unlocked", type: "bool" },
] }];

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function isAddress(value) { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function isHash(value) { return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value); }
function formatUnits(value, decimals) { const base = 10n ** BigInt(decimals); const whole = value / base; const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, ""); return fraction ? `${whole}.${fraction}` : whole.toString(); }
function fixed(value, decimals = 10) { return Number.isFinite(value) ? value.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1") : null; }

function findTransactionHash(value) {
  if (isHash(value)) return value;
  if (typeof value === "string") { try { return findTransactionHash(JSON.parse(value)); } catch { return null; } }
  if (!value || typeof value !== "object") return null;
  const record = object(value);
  for (const key of ["transaction_hash", "transactionHash", "tx_hash", "txHash"]) if (isHash(record[key])) return record[key];
  for (const key of ["execution_result", "receipt", "response", "content", "result", "metadata"]) { const hash = findTransactionHash(record[key]); if (hash) return hash; }
  return null;
}

function decodeTransfers(receipt) {
  const transfers = [];
  for (const log of receipt.logs || []) {
    try {
      const decoded = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics, strict: false });
      const args = object(decoded.args);
      if (decoded.eventName === "Transfer" && isAddress(log.address) && isAddress(args.from) && isAddress(args.to) && typeof args.value === "bigint") transfers.push({ token: log.address, from: args.from, to: args.to, value: args.value });
    } catch {}
  }
  return transfers;
}

async function findPool(receipt) {
  const logAddresses = (receipt.logs || []).map((entry) => String(entry.address || "").toLowerCase());
  for (const fee of FEES) {
    try {
      const pool = await publicClient.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [CAKE2, WBNB, fee] });
      if (isAddress(pool) && pool.toLowerCase() !== ZERO && logAddresses.includes(pool.toLowerCase())) return { pool, fee };
    } catch {}
  }
  return null;
}

async function classify(txHash, wallet) {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") return null;
  const transfers = decodeTransfers(receipt);
  const normalizedWallet = String(wallet).toLowerCase();
  const cakeOut = transfers.filter((entry) => entry.token.toLowerCase() === CAKE2.toLowerCase() && entry.from.toLowerCase() === normalizedWallet && entry.value > 0n).reduce((sum, entry) => sum + entry.value, 0n);
  const cakeIn = transfers.filter((entry) => entry.token.toLowerCase() === CAKE2.toLowerCase() && entry.to.toLowerCase() === normalizedWallet && entry.value > 0n).reduce((sum, entry) => sum + entry.value, 0n);
  const wbnbIn = transfers.filter((entry) => entry.token.toLowerCase() === WBNB.toLowerCase() && entry.to.toLowerCase() === normalizedWallet && entry.value > 0n).reduce((sum, entry) => sum + entry.value, 0n);
  const wbnbOut = transfers.filter((entry) => entry.token.toLowerCase() === WBNB.toLowerCase() && entry.from.toLowerCase() === normalizedWallet && entry.value > 0n).reduce((sum, entry) => sum + entry.value, 0n);
  const pool = await findPool(receipt);
  return { receipt, pool, cakeOut, cakeIn, wbnbIn, wbnbOut, entry: cakeOut > 0n && wbnbIn > 0n, exit: wbnbOut > 0n && cakeIn > 0n };
}

async function loadProviderResult(supabase, chainJobId, providerWallet) {
  const agentQuery = await supabase.from("agents").select("id,agent_id,name").ilike("owner", providerWallet).limit(1).maybeSingle();
  if (agentQuery.error) throw new Error(agentQuery.error.message);
  if (!agentQuery.data) return null;
  const endpointQuery = await supabase.from("agent_endpoints").select("endpoint_url,protocol,status,metadata,version").eq("agent_id", String(agentQuery.data.id)).order("last_checked_at", { ascending: false }).limit(20);
  if (endpointQuery.error) throw new Error(endpointQuery.error.message);
  for (const endpoint of endpointQuery.data || []) {
    const operation = await resolveProviderOperation(endpoint, "result");
    if (!operation) continue;
    try {
      const result = await invokeProviderOperation(operation, { chain_job_id: chainJobId, job_id: chainJobId, agent_id: agentQuery.data.agent_id, client_wallet: providerWallet, network: "bsc-testnet" });
      return { rawText: result.rawText, endpoint: result.endpoint, agentName: agentQuery.data.name, operation };
    } catch {}
  }
  return null;
}

async function calculatePnl(execution) {
  if (!execution?.entry || !execution.pool) return null;
  try {
    const [slot0, cakeDecimals, wbnbDecimals] = await Promise.all([
      publicClient.readContract({ address: execution.pool.pool, abi: POOL_ABI, functionName: "slot0" }),
      publicClient.readContract({ address: CAKE2, abi: TOKEN_ABI, functionName: "decimals" }),
      publicClient.readContract({ address: WBNB, abi: TOKEN_ABI, functionName: "decimals" }),
    ]);
    const sqrtPriceX96 = slot0[0];
    const rawPrice = Number(sqrtPriceX96 * sqrtPriceX96) / Number(2n ** 192n);
    if (!(rawPrice > 0)) return null;
    const cakeIsToken0 = CAKE2.toLowerCase() < WBNB.toLowerCase();
    const decimalsAdjustment = 10 ** (cakeIsToken0 ? Number(cakeDecimals) - Number(wbnbDecimals) : Number(wbnbDecimals) - Number(cakeDecimals));
    const adjusted = rawPrice * decimalsAdjustment;
    const wbnbPerCake = cakeIsToken0 ? adjusted : 1 / adjusted;
    const cakePerWbnb = 1 / wbnbPerCake;
    const openWbnb = Number(formatUnits(execution.wbnbIn, Number(wbnbDecimals)));
    const costCake = Number(formatUnits(execution.cakeOut, Number(cakeDecimals)));
    const markCake = openWbnb * cakePerWbnb;
    const unrealized = markCake - costCake;
    return { mode: "unrealized", pool: execution.pool, remainingWbnb: formatUnits(execution.wbnbIn, Number(wbnbDecimals)), remainingCostBasisCake2: formatUnits(execution.cakeOut, Number(cakeDecimals)), markedValueCake2: fixed(markCake), unrealizedPnlCake2: fixed(unrealized), realizedPnlCake2: "0", totalPnlCake2: fixed(unrealized), pnlPercentage: costCake > 0 ? fixed((unrealized / costCake) * 100, 4) : null };
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });
  const raw = typeof req.query?.job === "string" ? req.query.job.trim() : "";
  if (!/^\d+$/.test(raw)) return res.status(400).json({ error: "job is required" });
  const chainJobId = Number(raw);

  try {
    const chainJob = await publicClient.readContract({ address: COMMERCE, abi: JOB_ABI, functionName: "getJob", args: [BigInt(chainJobId)] });
    if (!chainJob || chainJob.id === 0n) return res.status(404).json({ error: "ERC-8183 job not found" });
    if (String(chainJob.client).toLowerCase() !== String(auth.user.wallet_address).toLowerCase()) return res.status(403).json({ error: "This job is not owned by the connected client wallet" });

    const supabase = serverClient();
    const jobQuery = await supabase.from("jobs").select("id,chain_job_id,client_wallet,mission_task_id").eq("chain_job_id", chainJobId).maybeSingle();
    if (jobQuery.error) throw new Error(jobQuery.error.message);
    if (!jobQuery.data) return res.status(404).json({ error: "Marketplace job record not found" });

    const requestQuery = await supabase.from("execution_capital_requests").select("id,user_execution_wallet,agent_session_key,status,evidence").eq("job_id", jobQuery.data.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (requestQuery.error) throw new Error(requestQuery.error.message);
    const request = requestQuery.data || null;
    const storedEvidence = object(request?.evidence);
    let txHash = isHash(storedEvidence?.last_execution?.transaction_hash) ? storedEvidence.last_execution.transaction_hash : null;
    let source = txHash ? "execution_capital_request" : "";
    let resultVerified = false;

    if (!txHash) {
      const providerResult = await loadProviderResult(supabase, chainJobId, String(chainJob.provider));
      if (providerResult) {
        const rawText = providerResult.rawText || "";
        const computed = keccak256(new TextEncoder().encode(rawText));
        const deliverableMatches = String(chainJob.deliverable).toLowerCase() === computed.toLowerCase();
        let content;
        try { content = JSON.parse(rawText); } catch { content = rawText; }
        const candidate = findTransactionHash(content);
        if (candidate && deliverableMatches) { txHash = candidate; source = "verified_provider_result"; resultVerified = true; }
      }
    }

    if (!txHash && [2, 3].includes(Number(chainJob.status))) {
      const archivedQuery = await supabase.from("erc8183_deliverable_archives").select("content_base64,onchain_deliverable_hash,verified").eq("chain_id", 97).ilike("commerce_address", COMMERCE).eq("job_id", chainJobId).order("captured_at", { ascending: false }).limit(1).maybeSingle();
      if (archivedQuery.data?.verified && archivedQuery.data.content_base64) {
        const bytes = new Uint8Array(Buffer.from(archivedQuery.data.content_base64, "base64"));
        if (String(archivedQuery.data.onchain_deliverable_hash).toLowerCase() === keccak256(bytes).toLowerCase()) {
          let content;
          try { content = JSON.parse(new TextDecoder().decode(bytes)); } catch { content = new TextDecoder().decode(bytes); }
          const candidate = findTransactionHash(content);
          if (candidate) { txHash = candidate; source = "verified_deliverable_archive"; resultVerified = true; }
        }
      }
    }

    if (!txHash) return res.status(200).json({ ok: true, observed: false, job_id: chainJobId, network: "bsc-testnet", chain_id: 97, source: "agentmarket_independent_bsc_rpc_verification", message: "No verified provider execution transaction is available yet." });

    const executionWallet = isAddress(request?.user_execution_wallet) ? request.user_execution_wallet : String(auth.user.wallet_address);
    let verified = null;
    try { verified = await classify(txHash, executionWallet); } catch {}
    if (!verified) return res.status(200).json({ ok: true, observed: false, job_id: chainJobId, network: "bsc-testnet", chain_id: 97, transaction_hash: txHash, source, message: "A provider execution transaction was identified, but its successful BSC Testnet receipt could not yet be independently verified." });

    const resultPnl = await calculatePnl(verified);
    const tx = await publicClient.getTransaction({ hash: txHash });
    const execution = { status: verified.receipt.status, block_number: verified.receipt.blockNumber.toString(), block_hash: verified.receipt.blockHash, gas_used: verified.receipt.gasUsed.toString(), execution_wallet: executionWallet, tx_from: tx.from, tx_to: tx.to, entry: verified.entry, exit: verified.exit, receipt_verified: true };
    const market = { verified_onchain: Boolean(verified.entry || verified.exit), token_in: CAKE2, token_out: WBNB, token_in_symbol: "CAKE2", token_out_symbol: "WBNB", token_in_amount: verified.entry ? formatUnits(verified.cakeOut, 18) : verified.exit ? formatUnits(verified.cakeIn, 18) : null, token_out_amount: verified.entry ? formatUnits(verified.wbnbIn, 18) : verified.exit ? formatUnits(verified.wbnbOut, 18) : null, fee: verified.pool?.fee ?? null, pool: verified.pool?.pool ?? null };

    try {
      await supabase.from("execution_capital_execution_evidence").upsert({ execution_id: `provider-execution-${chainJobId}`, job_id: jobQuery.data.id, transaction_hash: txHash, chain_id: 97, executor_status: "verified_onchain", receipt_verified: true, evidence: { source, execution, market, pnl: resultPnl } }, { onConflict: "execution_id" });
    } catch {}

    return res.status(200).json({ ok: true, observed: true, job_id: chainJobId, network: "bsc-testnet", chain_id: 97, transaction_hash: txHash, source, result_verified: resultVerified, execution, market, pnl: resultPnl });
  } catch (error) {
    console.error("Execution evidence verification failed", { chainJobId, error });
    return res.status(500).json({ error: error instanceof Error ? error.message : "Execution evidence verification failed", route: "execution-evidence", job_id: chainJobId });
  }
}
