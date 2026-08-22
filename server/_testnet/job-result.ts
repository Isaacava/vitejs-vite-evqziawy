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

const publicClient = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet-rpc.publicnode.com") });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  const rawJobId = typeof req.query.job === "string" ? req.query.job : "";
  if (!/^\d+$/.test(rawJobId)) return res.status(400).json({ error: "Invalid chain job ID" });

  try {
    const chainJob: any = await publicClient.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "getJob", args: [BigInt(rawJobId)] });
    if (!chainJob || chainJob.id === 0n) return res.status(404).json({ error: "ERC-8183 job not found" });
    if (![2, 3].includes(Number(chainJob.status))) return res.status(409).json({ error: "Job does not have a submitted deliverable yet", chain_status: Number(chainJob.status) });
    if (String(chainJob.client).toLowerCase() !== String(auth.user.wallet_address).toLowerCase()) return res.status(403).json({ error: "This job is not owned by the connected client wallet" });

    const supabase = serverClient();
    const { data: agent, error: agentError } = await supabase.from("agents").select("agent_id,owner,uri,name,metadata").ilike("owner", String(chainJob.provider)).limit(1).maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ error: "No registered AgentMarket endpoint for this provider" });

    let endpoint = agent.uri;
    const metadata = agent.metadata && typeof agent.metadata === "object" ? agent.metadata as Record<string, unknown> : null;
    if (metadata && typeof metadata.endpoint === "string") endpoint = metadata.endpoint;
    if (metadata && typeof metadata.url === "string") endpoint = metadata.url;
    if (!endpoint) return res.status(404).json({ error: "Provider has no public ERC-8183 endpoint" });
    endpoint = String(endpoint).replace(/\/$/, "");

    const response = await fetch(`${endpoint}/job/${rawJobId}/response`, { headers: { Accept: "application/json, text/plain;q=0.9, */*" }, cache: "no-store" });
    if (!response.ok) return res.status(502).json({ error: `Provider result endpoint returned HTTP ${response.status}` });

    const bytes = new Uint8Array(await response.arrayBuffer());
    const computedHash = keccak256(bytes) as Hex;
    const text = new TextDecoder().decode(bytes);
    let content: unknown = text;
    try { content = JSON.parse(text); } catch { /* preserve text */ }

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
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to verify provider result" });
  }
}
