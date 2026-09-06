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
] }] }] as const;
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

type EndpointRecord = { endpoint_url: string; protocol: string; status: string; metadata?: unknown; version?: string | null };

const isAddress = (v: unknown): v is string => typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v);
const isHash = (v: unknown): v is string => typeof v === "string" && /^0x[a-fA-F0-9]{64}$/.test(v);
const obj = (v: unknown): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
const formatUnits = (v: bigint, d: number) => { const b = 10n ** BigInt(d); const w = v / b; const f = (v % b).toString().padStart(d, "0").replace(/0+$/, ""); return f ? `${w}.${f}` : w.toString(); };
const fixed = (v: number, d = 10) => Number.isFinite(v) ? v.toFixed(d).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1") : null;

function findTransactionHash(value: unknown): string | null {
  if (isHash(value)) return value;
  if (typeof value === "string") { try { return findTransactionHash(JSON.parse(value)); } catch { return null; } }
  if (!value || typeof value !== "object") return null;
  const r = obj(value);
  for (const k of ["transaction_hash", "transactionHash", "tx_hash", "txHash"]) if (isHash(r[k])) return r[k];
  for (const k of ["execution_result", "receipt", "response", "content", "result", "metadata"]) { const h = findTransactionHash(r[k]); if (h) return h; }
  return null;
}

function decodeTransfers(receipt: any) {
  const out: any[] = [];
  for (const log of receipt.logs || []) {
    try {
      const decoded = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics, strict: false });
      const a = obj(decoded.args);
      if (decoded.eventName === "Transfer" && isAddress(log.address) && isAddress(a.from) && isAddress(a.to) && typeof a.value === "bigint") out.push({ token: log.address, from: a.from, to: a.to, value: a.value });
    } catch {}
  }
  return out;
}

async function findPool(receipt: any) {
  const logAddresses = (receipt.logs || []).map((x: any) => String(x.address || "").toLowerCase());
  for (const fee of FEES) {
    try {
      const pool = await publicClient.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [CAKE2, WBNB, fee] });
      if (isAddress(pool) && pool.toLowerCase() !== ZERO && logAddresses.includes(pool.toLowerCase())) return { pool, fee };
    } catch {}
  }
  return null;
}

async function classify(txHash: string, wallet: string) {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
  if (receipt.status !== "success") return null;
  const transfers = decodeTransfers(receipt);
  const w = wallet.toLowerCase();
  const cakeOut = transfers.filter(x => x.token.toLowerCase() === CAKE2.toLowerCase() && x.from.toLowerCase() === w && x.value > 0n).reduce((s, x) => s + x.value, 0n);
  const cakeIn = transfers.filter(x => x.token.toLowerCase() === CAKE2.toLowerCase() && x.to.toLowerCase() === w && x.value > 0n).reduce((s, x) => s + x.value, 0n);
  const wbnbIn = transfers.filter(x => x.token.toLowerCase() === WBNB.toLowerCase() && x.to.toLowerCase() === w && x.value > 0n).reduce((s, x) => s + x.value, 0n);
  const wbnbOut = transfers.filter(x => x.token.toLowerCase() === WBNB.toLowerCase() && x.from.toLowerCase() === w && x.value > 0n).reduce((s, x) => s + x.value, 0n);
  const pool = await findPool(receipt);
  return { receipt, pool, cakeOut, cakeIn, wbnbIn, wbnbOut, entry: cakeOut > 0n && wbnbIn > 0n, exit: wbnbOut > 0n && cakeIn > 0n };
}

async function providerResult(supabase: ReturnType<typeof serverClient>, chainJobId: number, wallet: string) {
  const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,name").ilike("owner", wallet).limit(1).maybeSingle();
  if (agentError) throw new Error(agentError.message);
  if (!agent) return null;
  const { data: endpoints, error: endpointError } = await supabase.from("agent_endpoints").select("endpoint_url,protocol,status,metadata,version").eq("agent_id", String(agent.id)).order("last_checked_at", { ascending: false }).limit(20);
  if (endpointError) throw new Error(endpointError.message);
  for (const endpoint of (endpoints || []) as EndpointRecord[]) {
    const operation = await resolveProviderOperation(endpoint, "result");
    if (!operation) continue;
    try {
      const result = await invokeProviderOperation(operation, { chain_job_id: chainJobId, job_id: chainJobId, agent_id: agent.agent_id, client_wallet: wallet, network: "bsc-testnet" });
      return { rawText: result.rawText, endpoint: result.endpoint, agentName: agent.name, operation };
    } catch {}
  }
  return null;
}

async function pnl(execution: any) {
  if (!execution?.entry || !execution.pool) return null;
  try {
    const [slot0, cd, wd] = await Promise.all([
      publicClient.readContract({ address: execution.pool.pool, abi: POOL_ABI, functionName: "slot0" }),
      publicClient.readContract({ address: CAKE2, abi: TOKEN_ABI, functionName: "decimals" }),
      publicClient.readContract({ address: WBNB, abi: TOKEN_ABI, functionName: "decimals" }),
    ]);
    const sqrt = slot0[0];
    const raw = Number(sqrt * sqrt) / Number(2n ** 192n);
    if (!(raw > 0)) return null;
    const cakeIs0 = CAKE2.toLowerCase() < WBNB.toLowerCase();
    const adjusted = raw * (10 ** (cakeIs0 ? Number(cd) - Number(wd) : Number(wd) - Number(cd)));
    const wbnbPerCake = cakeIs0 ? adjusted : 1 / adjusted;
    const cakePerWbnb = 1 / wbnbPerCake;
    const openWbnb = Number(formatUnits(execution.wbnbIn, Number(wd)));
    const costCake = Number(formatUnits(execution.cakeOut, Number(cd)));
    const markCake = openWbnb * cakePerWbnb;
    const unrealized = markCake - costCake;
    return { mode: "unrealized", pool: execution.pool, remainingWbnb: formatUnits(execution.wbnbIn, Number(wd)), remainingCostBasisCake2: formatUnits(execution.cakeOut, Number(cd)), markedValueCake2: fixed(markCake), unrealizedPnlCake2: fixed(unrealized), realizedPnlCake2: "0", totalPnlCake2: fixed(unrealized), pnlPercentage: costCake > 0 ? fixed((unrealized / costCake) * 100, 4) : null };
  } catch { return null; }
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });
  const raw = typeof req.query?.job === "string" ? req.query.job.trim() : "";
  if (!/^\d+$/.test(raw)) return res.status(400).json({ error: "job is required" });
  const chainJobId = Number(raw);
  try {
    const chainJob: any = await publicClient.readContract({ address: COMMERCE, abi: JOB_ABI, functionName: "getJob", args: [BigInt(chainJobId)] });
    if (!chainJob || chainJob.id === 0n) return res.status(404).json({ error: "ERC-8183 job not found" });
    if (String(chainJob.client).toLowerCase() !== String(auth.user.wallet_address).toLowerCase()) return res.status(403).json({ error: "This job is not owned by the connected client wallet" });
    const supabase = serverClient();
    const { data: job, error: jobError } = await supabase.from("jobs").select("id,chain_job_id,client_wallet,mission_task_id").eq("chain_job_id", chainJobId).maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return res.status(404).json({ error: "Marketplace job record not found" });
    const { data: request, error: requestError } = await supabase.from("execution_capital_requests").select("id,user_execution_wallet,agent_session_key,status,evidence").eq("job_id", job.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (requestError) throw new Error(requestError.message);
    const storedEvidence = obj(request?.evidence);
    let txHash = isHash(storedEvidence?.last_execution?.transaction_hash) ? storedEvidence.last_execution.transaction_hash : null;
    let source = txHash ? "execution_capital_request" : "";

    if (!txHash) {
      const result = await providerResult(supabase, chainJobId, String(chainJob.provider));
      if (result) {
        const bytes = new TextEncoder().encode(result.rawText || "");
        const computed = keccak256(bytes);
        const deliverableMatches = String(chainJob.deliverable).toLowerCase() === computed.toLowerCase();
        const content = (() => { try { return JSON.parse(result.rawText); } catch { return result.rawText; } })();
        const candidate = findTransactionHash(content);
        if (candidate && deliverableMatches) {
          txHash = candidate;
          source = "verified_provider_result";
        }
      }
    }

    if (!txHash) {
      const status = Number(chainJob.status);
      if ([2, 3].includes(status)) {
        const { data: archived } = await supabase.from("erc8183_deliverable_archives").select("content_base64,onchain_deliverable_hash,verified").eq("chain_id", 97).ilike("commerce_address", COMMERCE).eq("job_id", chainJobId).order("captured_at", { ascending: false }).limit(1).maybeSingle();
        if (archived?.verified && archived.content_base64) {
          const bytes = new Uint8Array(Buffer.from(archived.content_base64, "base64"));
          if (String(archived.onchain_deliverable_hash).toLowerCase() === keccak256(bytes).toLowerCase()) {
            const content = (() => { try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return new TextDecoder().decode(bytes); } })();
            const candidate = findTransactionHash(content);
            if (candidate) { txHash = candidate; source = "verified_deliverable_archive"; }
          }
        }
      }
    }

    if (!txHash) return res.status(200).json({ ok: true, observed: false, job_id: chainJobId, network: "bsc-testnet", chain_id: 97, source: "agentmarket_independent_bsc_rpc_verification", message: "No verified provider execution transaction is available yet." });

    const executionWallet = isAddress(request?.user_execution_wallet) ? request.user_execution_wallet : String(auth.user.wallet_address);
    const verified = await classify(txHash, executionWallet);
    if (!verified) return res.status(200).json({ ok: true, observed: false, job_id: chainJobId, network: "bsc-testnet", chain_id: 97, transaction_hash: txHash, source: "agentmarket_independent_bsc_rpc_verification", message: "A provider execution transaction was identified, but its successful BSC Testnet receipt could not yet be independently verified." });

    const resultPnl = await pnl(verified);
    const tx = await publicClient.getTransaction({ hash: txHash as `0x${string}` });
    const body = {
      ok: true,
      observed: true,
      job_id: chainJobId,
      network: "bsc-testnet",
      chain_id: 97,
      transaction_hash: txHash,
      execution: {
        status: verified.receipt.status,
        block_number: verified.receipt.blockNumber.toString(),
        block_hash: verified.receipt.blockHash,
        gas_used: verified.receipt.gasUsed.toString(),
        effective_gas_price: verified.receipt.effectiveGasPrice.toString(),
        from: tx.from,
        to: tx.to,
        session_key: isAddress(request?.agent_session_key) ? request.agent_session_key : null,
        execution_wallet: executionWallet,
      },
      market: {
        verified_onchain: Boolean(verified.pool && (verified.cakeOut > 0n || verified.wbnbIn > 0n)),
        token_in: CAKE2,
        token_in_symbol: "CAKE2",
        token_in_amount: formatUnits(verified.cakeOut, 18),
        token_out: WBNB,
        token_out_symbol: "WBNB",
        token_out_amount: formatUnits(verified.wbnbIn, 18),
        fee: verified.pool?.fee ?? null,
        pool: verified.pool?.pool ?? null,
      },
      accounting: resultPnl ? {
        capital_deployed: formatUnits(verified.cakeOut, 18),
        capital_deployed_token: "CAKE2",
        realized_pnl: null,
        realized_pnl_token: null,
        unrealized_pnl: resultPnl.unrealizedPnlCake2,
        unrealized_pnl_token: "CAKE2",
        total_pnl: resultPnl.totalPnlCake2,
        total_pnl_token: "CAKE2",
        pnl_percentage: resultPnl.pnlPercentage,
        pnl_status: "live_mark_to_market",
        pnl_basis: "Verified execution cost basis marked against the current Pancake V3 pool spot price.",
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
        pnl_basis: "Verified execution was observed, but a matching Pancake V3 spot price was not available.",
      },
      source: "agentmarket_independent_bsc_rpc_verification",
      evidence_source: source,
    };

    await supabase.from("execution_capital_execution_evidence").upsert({
      execution_capital_request_id: request?.id ?? null,
      job_id: String(job.id),
      chain_id: 97,
      execution_id: `provider-execution-${chainJobId}`,
      calls_id: null,
      executor_status: "verified_onchain",
      transaction_hash: txHash,
      receipt: verified.receipt,
      receipt_verified: true,
      calls: [],
      source,
    }, { onConflict: "execution_capital_request_id,execution_id" });

    return res.status(200).json(body);
  } catch (error) {
    return res.status(503).json({ ok: false, observed: false, network: "bsc-testnet", chain_id: 97, source: "agentmarket_independent_bsc_rpc_verification", error: error instanceof Error ? error.message : "Unable to independently verify execution on BSC Testnet" });
  }
}
