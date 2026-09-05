import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, keccak256, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";
import { invokeProviderOperation, resolveProviderOperation } from "./provider-operation.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const COMMERCE_ABI = [{
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

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseContent(bytes: Uint8Array): unknown {
  const text = new TextDecoder().decode(bytes);
  try { return JSON.parse(text); } catch { return text; }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
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
    const nested = findTransactionHash(record[key]);
    if (nested) return nested;
  }
  return null;
}

async function bridgeDeliverableTransactionPointer(supabase: ReturnType<typeof serverClient>, jobId: number, content: unknown) {
  const transactionHash = findTransactionHash(content);
  if (!transactionHash) return;
  const { data: request, error: requestError } = await supabase
    .from("execution_capital_requests")
    .select("id")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (requestError) throw new Error(requestError.message);
  if (!request?.id) return;
  const { error: evidenceError } = await supabase.from("execution_capital_execution_evidence").upsert({
    execution_capital_request_id: request.id,
    job_id: jobId,
    chain_id: 97,
    execution_id: `deliverable-pointer-${jobId}`,
    calls_id: null,
    executor_status: "candidate_from_verified_deliverable",
    transaction_hash: transactionHash,
    receipt: null,
    receipt_verified: false,
    calls: [],
    source: "verified_deliverable_pointer",
  }, { onConflict: "execution_capital_request_id,execution_id" });
  if (evidenceError) throw new Error(evidenceError.message);
}

function resultLooksUsable(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const body = object(value);
  return body.result !== undefined || body.output !== undefined || body.content !== undefined || body.deliverable !== undefined || body.status !== undefined || body.transaction_hash !== undefined || body.transactionHash !== undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  const rawJobId = typeof req.query.job === "string" ? req.query.job : "";
  if (!/^\d+$/.test(rawJobId)) return res.status(400).json({ error: "Invalid chain job ID" });

  try {
    const chainJob: any = await publicClient.readContract({
      address: COMMERCE,
      abi: COMMERCE_ABI,
      functionName: "getJob",
      args: [BigInt(rawJobId)],
    });
    if (!chainJob || chainJob.id === 0n) return res.status(404).json({ error: "ERC-8183 job not found" });
    if (![2, 3].includes(Number(chainJob.status))) {
      return res.status(409).json({ error: "Job does not have a submitted deliverable yet", chain_status: Number(chainJob.status) });
    }
    if (String(chainJob.client).toLowerCase() !== String(auth.user.wallet_address).toLowerCase()) {
      return res.status(403).json({ error: "This job is not owned by the connected client wallet" });
    }

    const supabase = serverClient();
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id,agent_id,owner,uri,name,metadata")
      .ilike("owner", String(chainJob.provider))
      .limit(1)
      .maybeSingle();
    if (agentError) throw new Error(agentError.message);

    const { data: archived, error: archiveError } = await supabase
      .from("erc8183_deliverable_archives")
      .select("chain_id,commerce_address,job_id,provider_address,client_address,submission_tx_hash,onchain_deliverable_hash,captured_at,capture_source,provider_endpoint,content_type,response_bytes,content_base64,verified,verification_error")
      .eq("chain_id", 97)
      .ilike("commerce_address", COMMERCE)
      .eq("job_id", Number(chainJob.id))
      .maybeSingle();
    if (archiveError) throw new Error(archiveError.message);

    if (archived?.verified && archived.content_base64) {
      const bytes = decodeBase64(archived.content_base64);
      const computedHash = keccak256(bytes) as Hex;
      if (String(chainJob.deliverable).toLowerCase() === computedHash.toLowerCase()) {
        const content = parseContent(bytes);
        await bridgeDeliverableTransactionPointer(supabase, Number(chainJob.id), content);
        return res.status(200).json({
          ok: true,
          chain_job_id: Number(chainJob.id),
          chain_status: Number(chainJob.status),
          provider: chainJob.provider,
          client: chainJob.client,
          submitted_at: Number(chainJob.submittedAt),
          onchain_deliverable_hash: chainJob.deliverable,
          computed_deliverable_hash: computedHash,
          verified: true,
          response_bytes: bytes.length,
          endpoint: archived.provider_endpoint,
          agent_id: agent?.agent_id ?? null,
          agent_name: agent?.name ?? null,
          content,
          evidence_source: "agentmarket_archive",
          captured_at: archived.captured_at,
          capture_source: archived.capture_source,
          archive_available: true,
        });
      }
    }

    if (!agent) {
      return res.status(200).json({
        ok: true,
        chain_job_id: Number(chainJob.id),
        chain_status: Number(chainJob.status),
        provider: chainJob.provider,
        client: chainJob.client,
        submitted_at: Number(chainJob.submittedAt),
        onchain_deliverable_hash: chainJob.deliverable,
        computed_deliverable_hash: null,
        verified: false,
        response_bytes: null,
        endpoint: archived?.provider_endpoint ?? null,
        agent_id: null,
        agent_name: null,
        content: null,
        evidence_source: "onchain_only",
        archive_available: Boolean(archived),
        verification_error: archived?.verification_error ?? "No registered AgentMarket endpoint for this provider.",
      });
    }

    const { data: endpoints, error: endpointError } = await supabase
      .from("agent_endpoints")
      .select("endpoint_url,protocol,status,metadata")
      .eq("agent_id", String(agent.id))
      .order("last_checked_at", { ascending: false })
      .limit(20);
    if (endpointError) throw new Error(endpointError.message);

    let lastError = archived?.verification_error ?? "Provider result is not available yet.";
    for (const endpoint of endpoints || []) {
      const operation = await resolveProviderOperation(endpoint as Record<string, unknown>, "result");
      if (!operation) continue;
      try {
        const result = await invokeProviderOperation(operation, {
          chain_job_id: Number(chainJob.id),
          job_id: rawJobId,
          agent_id: agent.agent_id,
          client_wallet: auth.user.wallet_address,
          network: "bsc-testnet",
        });
        if (!resultLooksUsable(result.body)) {
          lastError = "Provider result operation returned no usable result payload.";
          continue;
        }
        const body = object(result.body);
        const candidateContent = body.content ?? body.output ?? body.result ?? result.body;
        const encoded = JSON.stringify(candidateContent);
        const bytes = new TextEncoder().encode(encoded);
        const computedHash = keccak256(bytes) as Hex;
        const verified = String(chainJob.deliverable).toLowerCase() === computedHash.toLowerCase();
        if (verified) await bridgeDeliverableTransactionPointer(supabase, Number(chainJob.id), candidateContent);
        return res.status(200).json({
          ok: true,
          chain_job_id: Number(chainJob.id),
          chain_status: Number(chainJob.status),
          provider: chainJob.provider,
          client: chainJob.client,
          submitted_at: Number(chainJob.submittedAt),
          onchain_deliverable_hash: chainJob.deliverable,
          computed_deliverable_hash: computedHash,
          verified,
          response_bytes: bytes.length,
          endpoint: operation.endpoint,
          agent_id: agent.agent_id,
          agent_name: agent.name,
          content: candidateContent,
          evidence_source: "provider_declared_operation",
          operation: { action: operation.action, endpoint: operation.endpoint, method: operation.method, transport: operation.transport, name: operation.name },
          archive_available: Boolean(archived),
          verification_error: verified ? null : `Hash mismatch: computed ${computedHash}, on-chain ${chainJob.deliverable}`,
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Provider result operation failed";
      }
    }

    return res.status(200).json({
      ok: true,
      chain_job_id: Number(chainJob.id),
      chain_status: Number(chainJob.status),
      provider: chainJob.provider,
      client: chainJob.client,
      submitted_at: Number(chainJob.submittedAt),
      onchain_deliverable_hash: chainJob.deliverable,
      computed_deliverable_hash: null,
      verified: false,
      response_bytes: null,
      endpoint: archived?.provider_endpoint ?? null,
      agent_id: agent.agent_id,
      agent_name: agent.name,
      content: null,
      evidence_source: "provider_operation_pending",
      archive_available: Boolean(archived),
      verification_error: lastError,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to verify provider result" });
  }
}
