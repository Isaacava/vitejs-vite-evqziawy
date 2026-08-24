import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
const RPC_URL = process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com";
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(RPC_URL) });

const IDENTITY_ABI = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getAgentWallet", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ type: "address" }] },
] as const;

const JOB_ABI = [{
  type: "function",
  name: "jobCounter",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "uint256" }],
}, {
  type: "function",
  name: "getJob",
  stateMutability: "view",
  inputs: [{ name: "jobId", type: "uint256" }],
  outputs: [{
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

type Job = {
  id: bigint;
  client: Address;
  provider: Address;
  status: number;
};

type Agent = {
  id: string;
  agent_id: string;
  owner: string;
  metadata: Record<string, unknown> | null;
};

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function statusName(status: number) {
  return ({ 0: "open", 1: "funded", 2: "submitted", 3: "completed", 4: "rejected", 5: "expired" } as Record<number, string>)[status] || "unknown";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (process.env.NODE_ENV === "production" && !cronSecret) {
    return res.status(503).json({ error: "CRON_SECRET must be configured before agent statistics sync is enabled" });
  }

  try {
    const supabase = serverClient();
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select("id,agent_id,owner,metadata")
      .eq("chain", "bsc-testnet")
      .not("agent_id", "is", null);
    if (agentsError) throw new Error(agentsError.message);

    const agentRows = (agents || []) as Agent[];
    if (agentRows.length === 0) {
      return res.status(200).json({ ok: true, network: "bsc-testnet", chain_id: 97, agents_scanned: 0, agents_updated: 0, jobs_scanned: 0 });
    }

    const identityResults = await publicClient.multicall({
      contracts: agentRows.map((agent) => ({
        address: IDENTITY_REGISTRY,
        abi: IDENTITY_ABI,
        functionName: "getAgentWallet" as const,
        args: [BigInt(agent.agent_id)],
      })),
      allowFailure: true,
    });

    const providerToAgents = new Map<string, Agent[]>();
    for (let i = 0; i < agentRows.length; i += 1) {
      const agent = agentRows[i];
      const walletResult = identityResults[i];
      const configuredWallet = walletResult?.status === "success" ? walletResult.result as Address : null;
      const provider = (configuredWallet && configuredWallet !== "0x0000000000000000000000000000000000000000" ? configuredWallet : agent.owner) as Address;
      const key = provider.toLowerCase();
      providerToAgents.set(key, [...(providerToAgents.get(key) || []), agent]);
    }

    const counter = BigInt(await publicClient.readContract({ address: COMMERCE, abi: JOB_ABI, functionName: "jobCounter", authorizationList: [] }));
    const jobsByProvider = new Map<string, Job[]>();
    const BATCH_SIZE = 50;
    let jobsScanned = 0;

    for (let start = 0n; start <= counter; start += BigInt(BATCH_SIZE)) {
      const end = start + BigInt(BATCH_SIZE - 1) > counter ? counter : start + BigInt(BATCH_SIZE - 1);
      const ids: bigint[] = [];
      for (let id = start; id <= end; id += 1n) ids.push(id);
      const results = await publicClient.multicall({
        contracts: ids.map((jobId) => ({ address: COMMERCE, abi: JOB_ABI, functionName: "getJob" as const, args: [jobId] })),
        allowFailure: true,
      });
      for (const result of results) {
        if (result.status !== "success") continue;
        const job = result.result as Job;
        if (!job || job.id === 0n) continue;
        jobsScanned += 1;
        const key = job.provider.toLowerCase();
        jobsByProvider.set(key, [...(jobsByProvider.get(key) || []), job]);
      }
    }

    const now = new Date().toISOString();
    let updated = 0;

    for (const agent of agentRows) {
      const walletResult = identityResults[agentRows.indexOf(agent)];
      const configuredWallet = walletResult?.status === "success" ? walletResult.result as Address : null;
      const provider = (configuredWallet && configuredWallet !== "0x0000000000000000000000000000000000000000" ? configuredWallet : agent.owner).toLowerCase();
      const agentJobs = jobsByProvider.get(provider) || [];

      const counts = agentJobs.reduce((acc, job) => {
        const status = statusName(Number(job.status));
        acc.total += 1;
        if (status === "open") acc.open += 1;
        if (status === "funded") acc.funded += 1;
        if (status === "submitted") acc.submitted += 1;
        if (status === "completed") acc.completed += 1;
        if (status === "rejected") acc.rejected += 1;
        if (status === "expired") acc.expired += 1;
        if (["completed", "rejected", "expired"].includes(status)) acc.terminal += 1;
        return acc;
      }, { total: 0, open: 0, funded: 0, submitted: 0, completed: 0, rejected: 0, expired: 0, terminal: 0 });

      const cached = {
        source: "erc8183_commerce",
        network: "bsc-testnet",
        chain_id: 97,
        synced_at: now,
        provider_address: provider,
        total_jobs: counts.total,
        completed_jobs: counts.completed,
        submitted_jobs: counts.submitted,
        funded_jobs: counts.funded,
        open_jobs: counts.open,
        rejected_jobs: counts.rejected,
        expired_jobs: counts.expired,
        terminal_jobs: counts.terminal,
        success_rate: counts.terminal > 0 ? Number(((counts.completed / counts.terminal) * 100).toFixed(1)) : null,
      };

      const nextMetadata = { ...(agent.metadata || {}), onchain_stats: cached };
      const { error } = await supabase.from("agents").update({ metadata: nextMetadata, last_indexed_at: now }).eq("id", agent.id);
      if (error) throw new Error(`Agent ${agent.agent_id}: ${error.message}`);
      updated += 1;
    }

    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: 97,
      source: "erc8183_commerce",
      agents_scanned: agentRows.length,
      agents_updated: updated,
      jobs_scanned: jobsScanned,
      job_counter: counter.toString(),
      synced_at: now,
    });
  } catch (error) {
    console.error("BSC Testnet agent statistics sync failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Agent statistics sync failed" });
  }
}
