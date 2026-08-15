import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";
import { PROVIDER_COMMERCE_ABI, PROVIDER_ERC8183_TESTNET } from "../../src/lib/erc8183ProviderTestnet.js";

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(),
});

const STATUS_NAMES = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;
const MARKETPLACE_STATUS: Record<(typeof STATUS_NAMES)[number], "created" | "funded" | "submitted" | "completed" | "rejected" | "expired"> = {
  OPEN: "created",
  FUNDED: "funded",
  SUBMITTED: "submitted",
  COMPLETED: "completed",
  REJECTED: "rejected",
  EXPIRED: "expired",
};

type ChainJob = {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  hook: Address;
  submittedAt: bigint;
  deliverable: `0x${string}`;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  const jobId = typeof req.query.job_id === "string" ? req.query.job_id.trim() : "";
  const missionId = typeof req.query.mission_id === "string" ? req.query.mission_id.trim() : "";
  const marketplaceJobId = typeof req.query.marketplace_job_id === "string" ? req.query.marketplace_job_id.trim() : "";

  if (!jobId || !/^\d+$/.test(jobId)) return res.status(400).json({ error: "job_id is required" });
  if (!missionId || !marketplaceJobId) return res.status(400).json({ error: "mission_id and marketplace_job_id are required" });

  try {
    const supabase = serverClient();
    const { data: mission, error: missionError } = await supabase
      .from("missions")
      .select("id,user_id,status")
      .eq("id", missionId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (missionError) throw new Error(missionError.message);
    if (!mission) return res.status(404).json({ error: "Mission not found" });

    const { data: marketplaceJob, error: jobError } = await supabase
      .from("jobs")
      .select("id,mission_task_id,chain_job_id,chain_status,status")
      .eq("id", marketplaceJobId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!marketplaceJob) return res.status(404).json({ error: "Marketplace job not found" });

    const { data: task, error: taskError } = await supabase
      .from("mission_tasks")
      .select("id,mission_id")
      .eq("id", marketplaceJob.mission_task_id)
      .eq("mission_id", mission.id)
      .maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task) return res.status(403).json({ error: "Job does not belong to this mission" });

    const chainJob = await publicClient.readContract({
      address: PROVIDER_ERC8183_TESTNET.commerce,
      abi: PROVIDER_COMMERCE_ABI,
      functionName: "getJob",
      args: [BigInt(jobId)],
      authorizationList: [],
    }) as unknown as ChainJob;

    if (!chainJob || chainJob.id === 0n) return res.status(404).json({ error: "ERC-8183 job not found", job_id: jobId });
    if (chainJob.client.toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "ERC-8183 job client does not match the authenticated wallet" });
    if (marketplaceJob.chain_job_id != null && String(marketplaceJob.chain_job_id) !== jobId) return res.status(409).json({ error: "Marketplace job is linked to a different on-chain job", expected: marketplaceJob.chain_job_id, received: jobId });

    const statusName = STATUS_NAMES[chainJob.status];
    if (!statusName) return res.status(409).json({ error: "Unknown ERC-8183 job status", onchain_status: chainJob.status });
    const mappedStatus = MARKETPLACE_STATUS[statusName];

    const update = {
      chain_job_id: Number(chainJob.id),
      chain_status: mappedStatus,
      updated_at: new Date().toISOString(),
    };
    const { data: updatedJob, error: updateError } = await supabase
      .from("jobs")
      .update(update)
      .eq("id", marketplaceJob.id)
      .select("id,mission_task_id,status,chain_job_id,chain_status,updated_at")
      .single();
    if (updateError) throw new Error(updateError.message);

    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: PROVIDER_ERC8183_TESTNET.chainId,
      job: {
        id: chainJob.id.toString(),
        client: chainJob.client,
        provider: chainJob.provider,
        evaluator: chainJob.evaluator,
        description: chainJob.description,
        budget: chainJob.budget.toString(),
        expired_at: new Date(Number(chainJob.expiredAt) * 1000).toISOString(),
        status: chainJob.status,
        status_name: statusName,
        submitted_at: chainJob.submittedAt > 0n ? new Date(Number(chainJob.submittedAt) * 1000).toISOString() : null,
        deliverable_hash: chainJob.deliverable,
      },
      marketplace_job: updatedJob,
      note: "Testnet-only job status. Reads and synchronizes only BSC Testnet ERC-8183 state.",
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to read Testnet ERC-8183 job status" });
  }
}
