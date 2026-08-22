import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, keccak256, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";

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
  transport: http("https://bsc-testnet-rpc.publicnode.com"),
});

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseContent(bytes: Uint8Array): unknown {
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
      return res.status(409).json({
        error: "Job does not have a submitted deliverable yet",
        chain_status: Number(chainJob.status),
      });
    }
    if (String(chainJob.client).toLowerCase() !== String(auth.user.wallet_address).toLowerCase()) {
      return res.status(403).json({ error: "This job is not owned by the connected client wallet" });
    }

    const supabase = serverClient();
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("agent_id,owner,uri,name,metadata")
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
      const verified = String(chainJob.deliverable).toLowerCase() === computedHash.toLowerCase();

      if (verified) {
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
          content: parseContent(bytes),
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

    let endpoint = agent.uri;
    const metadata = agent.metadata && typeof agent.metadata === "object"
      ? agent.metadata as Record<string, unknown>
      : null;
    if (metadata && typeof metadata.endpoint === "string") endpoint = metadata.endpoint;
    if (metadata && typeof metadata.url === "string") endpoint = metadata.url;

    if (!endpoint) {
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
        endpoint: null,
        agent_id: agent.agent_id,
        agent_name: agent.name,
        content: null,
        evidence_source: "onchain_only",
        archive_available: Boolean(archived),
        verification_error: archived?.verification_error ?? "Provider has no public ERC-8183 endpoint.",
      });
    }

    endpoint = String(endpoint).replace(/\/$/, "");
    const response = await fetch(`${endpoint}/job/${rawJobId}/response`, {
      headers: { Accept: "application/json, text/plain;q=0.9, */*" },
      cache: "no-store",
    });

    if (!response.ok) {
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
        endpoint,
        agent_id: agent.agent_id,
        agent_name: agent.name,
        content: null,
        evidence_source: "onchain_only",
        archive_available: Boolean(archived),
        verification_error: archived?.verification_error ?? `Provider result endpoint returned HTTP ${response.status}`,
      });
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const computedHash = keccak256(bytes) as Hex;
    const text = new TextDecoder().decode(bytes);
    let content: unknown = text;
    try {
      content = JSON.parse(text);
    } catch {
      // Preserve non-JSON content.
    }

    const verified = String(chainJob.deliverable).toLowerCase() === computedHash.toLowerCase();
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
      endpoint,
      agent_id: agent.agent_id,
      agent_name: agent.name,
      content,
      evidence_source: "provider_live",
      archive_available: Boolean(archived),
      verification_error: verified ? null : `Hash mismatch: computed ${computedHash}, on-chain ${chainJob.deliverable}`,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to verify provider result",
    });
  }
}
