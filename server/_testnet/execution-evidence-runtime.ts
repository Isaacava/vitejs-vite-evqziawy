import { createPublicClient, decodeEventLog, http, keccak256, type Address, type Hex } from "viem";
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
  for (const log of receipt?.logs || []) {
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
        transfers.push({ token: log.address, from: args.from, to: args.to, value: args.value });
      }
    } catch {
      // Ignore non-standard logs.
    }
  }
  return transfers;
}

function executionCapability(request: any) {
  const requestEvidence = object(request?.evidence);
  const capability = object(requestEvidence.execution_capability);
  const capabilityMarket = object(capability.execution_market);
  const sessionKey = isAddress(capability.session_key_address) ? capability.session_key_address : null;
  const allowedTargets = Array.isArray(capability.allowed_targets)
    ? capability.allowed_targets.filter(isAddress)
    : [];
  return { capability, capabilityMarket, sessionKey, allowedTargets };
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
      // Try the next discovered result operation.
    }
  }
  return null;
}

async function persistEvidence(
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

function walletTransferScore(wallet: string, transfers: TransferRecord[]) {
  const normalized = wallet.toLowerCase();
  const related = transfers.filter((transfer) => transfer.from.toLowerCase() === normalized || transfer.to.toLowerCase() === normalized);
  const totalValue = related.reduce((sum, transfer) => sum + transfer.value, 0n);
  return { count: related.length, totalValue };
}

function selectExecutionWallet(preferredWallets: string[], txFrom: string | null, transfers: TransferRecord[]) {
  const candidates = [...new Set([...preferredWallets, txFrom || ""].filter(isAddress).map((value) => value.toLowerCase()))];
  if (candidates.length === 0) return isAddress(txFrom) ? txFrom : null;
  let best: { wallet: string; count: number; totalValue: bigint } | null = null;
  for (const wallet of candidates) {
    const score = walletTransferScore(wallet, transfers);
    if (!best || score.count > best.count || (score.count === best.count && score.totalValue > best.totalValue)) {
      best = { wallet, ...score };
    }
  }
  return best?.wallet || null;
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

    const capability = executionCapability(request);
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

    let transactionHash: Hex | null = isHash(storedEvidence?.transaction_hash)
      ? storedEvidence.transaction_hash
      : isHash(lastExecution.transaction_hash)
        ? lastExecution.transaction_hash
        : null;
    let source = storedEvidence?.transaction_hash
      ? "execution_capital_execution_evidence"
      : lastExecution.transaction_hash
        ? "execution_capital_request"
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
        if (transactionHash) source = "provider_result";

        if (providerResult.rawText && isHash(chainJob.deliverable)) {
          const bytes = new TextEncoder().encode(providerResult.rawText);
          deliverableComputedHash = keccak256(bytes);
          deliverableMatches = deliverableComputedHash.toLowerCase() === String(chainJob.deliverable).toLowerCase();
          deliverableChecked = true;
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
          source = "deliverable_archive";
        }
        if (isHash(chainJob.deliverable)) {
          deliverableComputedHash = keccak256(bytes);
          deliverableMatches = deliverableComputedHash.toLowerCase() === String(chainJob.deliverable).toLowerCase();
          deliverableChecked = true;
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
        message: "No execution transaction hash is available yet.",
        observation_mode: "awaiting_transaction_hash",
        deliverable_verification: { checked: deliverableChecked, matches: deliverableMatches, computed_hash: deliverableComputedHash, expected_hash: chainJob.deliverable },
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
      await persistEvidence(
        supabase,
        request?.id || null,
        job.id,
        chainJobId,
        transactionHash,
        source || "execution_evidence",
        "receipt_pending",
        false,
        null,
        preferredWallets[0] || null,
        null,
        [],
      ).catch(() => undefined);
      return res.status(200).json({
        ok: true,
        observed: false,
        job_id: chainJobId,
        network: "bsc-testnet",
        chain_id: 97,
        transaction_hash: transactionHash,
        source: source || "execution_evidence",
        observation_mode: "receipt_pending",
        execution: { status: null, receipt_verified: false, execution_wallet: preferredWallets[0] || null, tx_from: null, tx_to: null },
        market: { verified_onchain: false, receipt_verified: false, transfer_count: 0, token_in: capability.capabilityMarket.token_in || null, token_out: capability.capabilityMarket.token_out || null, token_in_symbol: capability.capabilityMarket.token_in_symbol || null, token_out_symbol: capability.capabilityMarket.token_out_symbol || null },
        accounting: null,
        deliverable_verification: { checked: deliverableChecked, matches: deliverableMatches, computed_hash: deliverableComputedHash, expected_hash: chainJob.deliverable },
        message: error instanceof Error ? `Transaction identified; receipt is not observable yet: ${error.message}` : "Transaction identified; receipt is not observable yet.",
      });
    }

    const transfers = decodeTransfers(receipt);
    const executionWallet = selectExecutionWallet(preferredWallets, tx?.from || null, transfers);
    const receiptVerified = receipt?.status === "success";
    const executorStatus = receiptVerified ? "verified_onchain" : "failed";

    await persistEvidence(
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

    const walletTransfers = executionWallet
      ? transfers.filter((entry) => entry.from.toLowerCase() === executionWallet!.toLowerCase() || entry.to.toLowerCase() === executionWallet!.toLowerCase())
      : [];
    const assetAddresses = [...new Set(walletTransfers.map((entry) => entry.token.toLowerCase()))];
    const effectVerified = receiptVerified && walletTransfers.length > 0;

    return res.status(200).json({
      ok: true,
      observed: receiptVerified,
      job_id: chainJobId,
      network: "bsc-testnet",
      chain_id: 97,
      transaction_hash: transactionHash,
      source: source || "execution_evidence",
      observation_mode: effectVerified ? "receipt_and_transfer_activity" : receiptVerified ? "receipt_only" : "transaction_failed",
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
        token_in: capability.capabilityMarket.token_in || null,
        token_out: capability.capabilityMarket.token_out || null,
        token_in_symbol: capability.capabilityMarket.token_in_symbol || null,
        token_out_symbol: capability.capabilityMarket.token_out_symbol || null,
        token_in_amount: null,
        token_out_amount: null,
        fee: null,
        pool: null,
        transfer_count: transfers.length,
        execution_effects_verified: effectVerified,
        assets_involved: assetAddresses,
      },
      effects: {
        transfer_count: transfers.length,
        execution_wallet_transfer_count: walletTransfers.length,
        assets_involved: assetAddresses,
        transfers: transfers.map((entry) => ({ token: entry.token, from: entry.from, to: entry.to, value: entry.value.toString() })),
      },
      accounting: null,
      provider: providerResultUsed ? { endpoint: providerEndpoint, result_available: true } : { endpoint: archive?.provider_endpoint || null, result_available: false },
      deliverable_verification: {
        checked: deliverableChecked,
        matches: deliverableMatches,
        computed_hash: deliverableComputedHash,
        expected_hash: chainJob.deliverable,
        independent_of_execution_observation: true,
      },
      capability: {
        execution: capability.capability.execution || null,
        session_key: capability.sessionKey,
        allowed_target_count: capability.allowedTargets.length,
      },
    });
  } catch (error) {
    console.error("Execution evidence runtime failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to verify execution evidence" });
  }
}
