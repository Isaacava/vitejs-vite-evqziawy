import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const COMMERCE_ABI = [{
  type: "function",
  name: "jobCounter",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "uint256" }],
}, {
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
      { name: "description", type: "string" },
      { name: "budget", type: "uint256" },
      { name: "expiredAt", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "hook", type: "address" },
      { name: "submittedAt", type: "uint256" },
      { name: "deliverable", type: "bytes32" },
    ],
  }],
}] as const;

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http("https://bsc-testnet-rpc.publicnode.com"),
});

const STATUS: Record<number, string> = {
  0: "OPEN",
  1: "FUNDED",
  2: "SUBMITTED",
  3: "COMPLETED",
  4: "REJECTED",
  5: "EXPIRED",
};

const TERMINAL = new Set(["COMPLETED", "REJECTED", "EXPIRED"]);
const BATCH_SIZE = 25;
const MAX_SCAN = 2000;
const JSON_LABEL_KEYS = ["title", "mission_title", "task_title", "name", "goal", "description", "summary", "label"];

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

function cleanLabel(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  let text = value.trim();
  if (!text) return fallback;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!(text.startsWith("{") || text.startsWith("["))) break;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "string") {
        text = parsed.trim();
        continue;
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        for (const key of JSON_LABEL_KEYS) {
          const candidate = record[key];
          if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
        }
        const nested = record.mission;
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
          for (const key of JSON_LABEL_KEYS) {
            const candidate = (nested as Record<string, unknown>)[key];
            if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
          }
        }
      }
      break;
    } catch {
      break;
    }
  }

  return text;
}

function serializeChainJob(job: ChainJob) {
  const chainStatus = STATUS[Number(job.status)] || "UNKNOWN";
  const description = cleanLabel(job.description, `Testnet mission #${Number(job.id)}`);
  return {
    chain_job_id: Number(job.id),
    chain_status: chainStatus,
    client_wallet: job.client,
    provider: job.provider,
    evaluator: job.evaluator,
    description,
    budget_raw: job.budget.toString(),
    expired_at: Number(job.expiredAt),
    submitted_at: job.submittedAt > 0n ? new Date(Number(job.submittedAt) * 1000).toISOString() : null,
    deliverable_hash: job.deliverable,
    recoverable: !TERMINAL.has(chainStatus),
    verified_testnet: true,
    source_of_truth: "erc8183_commerce",
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  try {
    const wallet = String(auth.user.wallet_address).toLowerCase();
    const jobCounter = await publicClient.readContract({
      address: COMMERCE,
      abi: COMMERCE_ABI,
      functionName: "jobCounter",
    });

    const latest = Number(jobCounter);
    if (!Number.isFinite(latest) || latest <= 0) {
      return res.status(200).json({ ok: true, network: "bsc-testnet", chain_id: 97, source_of_truth: "erc8183_commerce", jobs: [] });
    }

    const start = Math.max(1, latest - MAX_SCAN + 1);
    const ids = Array.from({ length: latest - start + 1 }, (_, index) => BigInt(start + index));
    const chainJobs: ChainJob[] = [];

    for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
      const batch = ids.slice(offset, offset + BATCH_SIZE);
      const results = await Promise.all(batch.map(async (id) => {
        try {
          return await publicClient.readContract({
            address: COMMERCE,
            abi: COMMERCE_ABI,
            functionName: "getJob",
            args: [id],
          });
        } catch {
          return null;
        }
      }));

      for (const job of results) {
        if (job && job.id > 0n) chainJobs.push(job as ChainJob);
      }
    }

    const userChainJobs = chainJobs.filter((job) =>
      job.client.toLowerCase() === wallet || job.provider.toLowerCase() === wallet,
    );

    const supabase = serverClient();
    const chainIds = userChainJobs.map((job) => Number(job.id));
    const { data: dbJobs } = await supabase
      .from("jobs")
      .select("id,mission_task_id,provider_agent_id,budget,status,created_at,funded_at,submitted_at,terminal_at,updated_at,chain_job_id")
      .not("chain_job_id", "is", null)
      .in("chain_job_id", chainIds);

    const jobByChainId = new Map((dbJobs ?? []).map((job) => [Number(job.chain_job_id), job]));
    const taskIds = Array.from(new Set((dbJobs ?? []).map((job) => job.mission_task_id).filter(Boolean)));
    const providerAgentIds = Array.from(new Set((dbJobs ?? []).map((job) => job.provider_agent_id).filter(Boolean)));

    const { data: tasks } = taskIds.length
      ? await supabase
          .from("mission_tasks")
          .select("id,mission_id,title")
          .in("id", taskIds)
      : { data: [] };

    const missionIds = Array.from(new Set((tasks ?? []).map((task) => task.mission_id).filter(Boolean)));
    const { data: missions } = missionIds.length
      ? await supabase
          .from("missions")
          .select("id,title,status")
          .in("id", missionIds)
      : { data: [] };

    const { data: providerAgents } = providerAgentIds.length
      ? await supabase
          .from("agents")
          .select("id,agent_id,name,owner")
          .in("id", providerAgentIds)
      : { data: [] };

    const taskById = new Map((tasks ?? []).map((task) => [task.id, task]));
    const missionById = new Map((missions ?? []).map((mission) => [mission.id, mission]));
    const agentById = new Map((providerAgents ?? []).map((agent) => [agent.id, agent]));
    const agentByOwner = new Map((providerAgents ?? []).filter((agent) => typeof agent.owner === "string").map((agent) => [String(agent.owner).toLowerCase(), agent]));

    const jobs = userChainJobs
      .sort((a, b) => Number(b.id - a.id))
      .map((chainJob) => {
        const chain = serializeChainJob(chainJob);
        const db = jobByChainId.get(Number(chainJob.id));
        const task = db ? taskById.get(db.mission_task_id) : undefined;
        const mission = task ? missionById.get(task.mission_id) : undefined;
        const providerAgent = db?.provider_agent_id ? agentById.get(db.provider_agent_id) : agentByOwner.get(chainJob.provider.toLowerCase());
        const submitted = ["SUBMITTED", "COMPLETED", "REJECTED"].includes(chain.chain_status);
        const missionTitle = cleanLabel(mission?.title, chain.description);
        const taskTitle = cleanLabel(task?.title, missionTitle);

        return {
          ...chain,
          id: db?.id ?? null,
          mission_id: mission?.id ?? null,
          mission_title: missionTitle,
          mission_status: mission?.status ?? null,
          task_title: taskTitle,
          job_status: chain.chain_status.toLowerCase(),
          budget: db?.budget ?? null,
          agent: providerAgent ? { id: providerAgent.id, agent_id: providerAgent.agent_id, name: providerAgent.name } : null,
          submitted_at: submitted && chainJob.submittedAt > 0n ? new Date(Number(chainJob.submittedAt) * 1000).toISOString() : null,
          created_at: db?.created_at ?? null,
          funded_at: db?.funded_at ?? null,
          terminal_at: TERMINAL.has(chain.chain_status) ? (db?.terminal_at ?? null) : null,
          updated_at: db?.updated_at ?? null,
          marketplace_recorded: Boolean(db),
        };
      });

    const counts = jobs.reduce(
      (acc, job) => {
        if (job.chain_status === "COMPLETED" || job.chain_status === "REJECTED" || job.chain_status === "EXPIRED") acc.terminal += 1;
        else if (job.chain_status === "SUBMITTED") acc.submitted += 1;
        else acc.active += 1;
        return acc;
      },
      { active: 0, submitted: 0, terminal: 0 },
    );

    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: 97,
      source_of_truth: "erc8183_commerce",
      scanned_range: { from: start, to: latest },
      counts,
      jobs,
    });
  } catch (error) {
    console.error("Testnet chain-first job history failed", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to load Testnet chain job history",
      source_of_truth: "erc8183_commerce",
    });
  }
}
