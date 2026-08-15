import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";

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
const STATUS: Record<number, string> = { 0: "OPEN", 1: "FUNDED", 2: "SUBMITTED", 3: "COMPLETED", 4: "REJECTED", 5: "EXPIRED" };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  try {
    const supabase = serverClient();
    const { data: missions, error: missionError } = await supabase
      .from("missions")
      .select("id,title,goal,status,budget,created_at,updated_at")
      .eq("user_id", auth.user.id)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (missionError) throw new Error(missionError.message);

    const missionIds = (missions ?? []).map((mission) => mission.id);
    if (!missionIds.length) return res.status(200).json({ ok: true, network: "bsc-testnet", chain_id: 97, jobs: [] });

    const { data: tasks, error: taskError } = await supabase
      .from("mission_tasks")
      .select("id,mission_id,title,status,budget,chain_job_id,created_at,updated_at")
      .in("mission_id", missionIds)
      .order("updated_at", { ascending: false });
    if (taskError) throw new Error(taskError.message);

    const taskIds = (tasks ?? []).map((task) => task.id);
    const { data: jobs, error: jobError } = taskIds.length
      ? await supabase
          .from("jobs")
          .select("id,mission_task_id,provider_agent_id,client_wallet,status,budget,chain_job_id,chain_status,created_at,funded_at,submitted_at,terminal_at,updated_at")
          .in("mission_task_id", taskIds)
          .not("chain_job_id", "is", null)
          .order("updated_at", { ascending: false })
      : { data: [], error: null };
    if (jobError) throw new Error(jobError.message);

    const missionById = new Map((missions ?? []).map((mission) => [mission.id, mission]));
    const taskById = new Map((tasks ?? []).map((task) => [task.id, task]));
    const jobsOut: Array<Record<string, unknown>> = [];

    for (const job of jobs ?? []) {
      if (job.chain_job_id == null) continue;
      let chainJob: any;
      try {
        chainJob = await publicClient.readContract({
          address: COMMERCE,
          abi: COMMERCE_ABI,
          functionName: "getJob",
          args: [BigInt(job.chain_job_id)],
        });
      } catch {
        continue;
      }
      if (!chainJob || chainJob.id === 0n) continue;
      if (String(chainJob.client).toLowerCase() !== String(auth.user.wallet_address).toLowerCase()) continue;

      const task = taskById.get(job.mission_task_id);
      const mission = task ? missionById.get(task.mission_id) : undefined;
      if (!mission) continue;

      const chainStatus = STATUS[Number(chainJob.status)] || "UNKNOWN";
      jobsOut.push({
        id: job.id,
        mission_id: mission.id,
        mission_title: mission.title ?? "Untitled mission",
        mission_status: mission.status ?? "unknown",
        task_title: task?.title ?? "Marketplace task",
        job_status: job.status,
        chain_job_id: job.chain_job_id,
        chain_status: chainStatus,
        budget: job.budget,
        client_wallet: job.client_wallet,
        created_at: job.created_at,
        funded_at: job.funded_at,
        submitted_at: job.submitted_at,
        terminal_at: job.terminal_at,
        updated_at: job.updated_at,
        recoverable: !["COMPLETED", "REJECTED", "EXPIRED"].includes(chainStatus),
        verified_testnet: true,
      });
    }

    return res.status(200).json({ ok: true, network: "bsc-testnet", chain_id: 97, jobs: jobsOut });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load Testnet job history" });
  }
}
