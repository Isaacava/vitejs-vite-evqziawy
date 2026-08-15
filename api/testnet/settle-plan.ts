import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";
import { PROVIDER_ERC8183_TESTNET } from "../../src/lib/erc8183ProviderTestnet.js";
import { ROUTER_ABI } from "../../src/lib/erc8183.js";

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(),
});

const TERMINAL_STATUSES = new Set([3, 4, 5]);
const SUBMITTED_STATUS = 2;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  const jobId = typeof req.query.job_id === "string" ? req.query.job_id.trim() : "";
  const missionId = typeof req.query.mission_id === "string" ? req.query.mission_id.trim() : "";
  const marketplaceJobId = typeof req.query.marketplace_job_id === "string" ? req.query.marketplace_job_id.trim() : "";
  if (!/^\d+$/.test(jobId) || !missionId || !marketplaceJobId) return res.status(400).json({ error: "job_id, mission_id and marketplace_job_id are required" });

  try {
    const supabase = serverClient();
    const { data: mission, error: missionError } = await supabase.from("missions").select("id,user_id").eq("id", missionId).eq("user_id", auth.user.id).maybeSingle();
    if (missionError) throw new Error(missionError.message);
    if (!mission) return res.status(404).json({ error: "Mission not found" });

    const { data: marketplaceJob, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,chain_job_id,chain_status").eq("id", marketplaceJobId).maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!marketplaceJob) return res.status(404).json({ error: "Marketplace job not found" });
    if (marketplaceJob.mission_task_id == null) return res.status(409).json({ error: "Marketplace job is not linked to a mission task" });

    const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,mission_id").eq("id", marketplaceJob.mission_task_id).eq("mission_id", mission.id).maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task) return res.status(403).json({ error: "Job does not belong to this mission" });
    if (marketplaceJob.chain_job_id != null && String(marketplaceJob.chain_job_id) !== jobId) return res.status(409).json({ error: "Marketplace job points to a different chain job" });

    const chainJob = await publicClient.readContract({
      address: PROVIDER_ERC8183_TESTNET.commerce,
      abi: [{
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
      }] as const,
      functionName: "getJob",
      args: [BigInt(jobId)],
    }) as unknown as { id: bigint; client: Address; status: number; submittedAt: bigint; deliverable: `0x${string}` };

    if (chainJob.id === 0n) return res.status(404).json({ error: "ERC-8183 job not found" });
    if (chainJob.client.toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "Chain job client does not match the authenticated wallet" });
    if (TERMINAL_STATUSES.has(chainJob.status)) return res.status(409).json({ error: "Job is already terminal", status: chainJob.status });
    if (chainJob.status !== SUBMITTED_STATUS) return res.status(409).json({ error: "Job is not ready for settlement", status: chainJob.status });
    if (!chainJob.deliverable || chainJob.deliverable === "0x0000000000000000000000000000000000000000000000000000000000000000") return res.status(409).json({ error: "Submitted job does not contain a deliverable hash" });

    const simulation = await publicClient.simulateContract({
      address: PROVIDER_ERC8183_TESTNET.router,
      abi: ROUTER_ABI,
      functionName: "settle",
      args: [BigInt(jobId), "0x"],
      account: auth.user.wallet_address as Address,
    });

    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: 97,
      job_id: jobId,
      marketplace_job_id: marketplaceJobId,
      transaction: { to: simulation.request.address, data: simulation.request.data, value: simulation.request.value?.toString() ?? "0x0" },
      onchain: { status: chainJob.status, submitted_at: chainJob.submittedAt.toString(), deliverable_hash: chainJob.deliverable },
      note: "Testnet-only settlement plan. The contract simulation succeeded for the authenticated wallet." 
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Settlement is not available";
    return res.status(409).json({ error: message, network: "bsc-testnet", chain_id: 97 });
  }
}
