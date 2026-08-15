import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const COMMERCE_ABI = [{
  type: "function",
  name: "getJob",
  stateMutability: "view",
  inputs: [{ name: "jobId", type: "uint256" }],
  outputs: [{
    name: "job",
    type: "tuple",
    components: [
      { name: "id", type: "uint256" },
      { name: "client", type: "address" },
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "expiredAt", type: "uint256" },
      { name: "description", type: "string" },
      { name: "budget", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "deliverable", type: "string" },
      { name: "hook", type: "address" },
    ],
  }],
}] as const;

const publicClient = createPublicClient({ chain: bscTestnet, transport: http() });
const STATUS: Record<number, string> = {
  0: "OPEN",
  1: "FUNDED",
  2: "SUBMITTED",
  3: "COMPLETED",
  4: "REJECTED",
  5: "EXPIRED",
};

function nextStep(chainStatus: string, hasChainJob: boolean) {
  if (!hasChainJob) return "create";
  if (chainStatus === "OPEN") return "register";
  if (chainStatus === "FUNDED") return "provider_execution";
  if (chainStatus === "SUBMITTED") return "settle_or_dispute";
  if (chainStatus === "EXPIRED") return "claim_refund";
  if (chainStatus === "COMPLETED" || chainStatus === "REJECTED") return "terminal";
  return "inspect_onchain_state";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });

  const jobId = typeof req.query.job_id === "string" ? req.query.job_id.trim() : "";
  if (!jobId) return res.status(400).json({ error: "job_id is required" });

  try {
    const supabase = serverClient();
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id,mission_task_id,client_wallet,status,chain_job_id,chain_status,deliverable,submitted_at,terminal_at,updated_at")
      .eq("id", jobId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return res.status(404).json({ error: "Marketplace job not found" });

    const task = job.mission_task_id
      ? (await supabase.from("mission_tasks").select("id,mission_id").eq("id", job.mission_task_id).maybeSingle()).data
      : null;
    if (!task?.mission_id) return res.status(403).json({ error: "Job is not attached to a mission" });

    const { data: mission, error: missionError } = await supabase
      .from("missions")
      .select("id,user_id,client_wallet")
      .eq("id", task.mission_id)
      .maybeSingle();
    if (missionError) throw new Error(missionError.message);
    if (!mission || mission.user_id !== auth.user.id) return res.status(403).json({ error: "You do not own this job" });

    let chainJob: any = null;
    let chainStatus = "not_created";
    const storedChainJobId = job.chain_job_id != null ? String(job.chain_job_id) : "";
    if (storedChainJobId) {
      chainJob = await publicClient.readContract({
        address: COMMERCE,
        abi: COMMERCE_ABI,
        functionName: "getJob",
        args: [BigInt(storedChainJobId)],
      });
      if (!chainJob || chainJob.id === 0n) return res.status(409).json({ error: "Stored chain job ID does not resolve on BSC Testnet", chain_job_id: storedChainJobId });
      if (chainJob.client.toLowerCase() !== String(auth.user.wallet_address).toLowerCase()) return res.status(403).json({ error: "On-chain job client does not match the authenticated wallet" });
      chainStatus = STATUS[Number(chainJob.status)] || "UNKNOWN";
    }

    const persistedStatus = job.chain_status || "not_created";
    const needsSync = storedChainJobId && persistedStatus !== chainStatus;

    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: 97,
      marketplace_job: {
        id: job.id,
        status: job.status,
        chain_job_id: job.chain_job_id,
        chain_status: persistedStatus,
        updated_at: job.updated_at,
      },
      onchain_job: chainJob ? {
        id: chainJob.id.toString(),
        client: chainJob.client,
        provider: chainJob.provider,
        evaluator: chainJob.evaluator,
        budget: chainJob.budget.toString(),
        status: Number(chainJob.status),
        status_name: chainStatus,
        expired_at: new Date(Number(chainJob.expiredAt) * 1000).toISOString(),
        deliverable: chainJob.deliverable,
        description: chainJob.description,
      } : null,
      recovery: {
        next_step: nextStep(chainStatus, Boolean(storedChainJobId)),
        requires_chain_sync: Boolean(needsSync),
        source_of_truth: "bsc-testnet",
        can_resume: chainStatus !== "COMPLETED" && chainStatus !== "REJECTED",
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected server error" });
  }
}
