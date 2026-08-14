import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { getAddress, type Address } from "viem";
import { COMMERCE_ABI, ERC8183_ADDRESSES, publicClient } from "../../src/lib/erc8183.js";

const FUNDED_STATUS = 1;
const DEFAULT_SCAN = 32;
const MAX_SCAN = 100;

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function authorized(req: VercelRequest) {
  const secret = process.env.AGENT_RUNTIME_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.authorization === `Bearer ${secret}`;
}

function asAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${field} must be a valid EVM address`);
  }
  return getAddress(value);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) return res.status(401).json({ error: "Agent runtime unauthorized" });
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const agentId = typeof req.query.agent_id === "string" ? req.query.agent_id.trim() : "";
    if (!agentId) return res.status(400).json({ error: "agent_id is required" });

    const supabase = serverClient();
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id,agent_id,owner,name,status,verification_status")
      .eq("agent_id", agentId)
      .maybeSingle();

    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    if (!agent.owner) return res.status(409).json({ error: "Agent has no provider wallet" });

    const provider = asAddress(agent.owner, "agent.owner");
    const counter = await publicClient.readContract({
      address: ERC8183_ADDRESSES.commerce,
      abi: COMMERCE_ABI,
      functionName: "jobCounter",
    });

    const requested = Number(req.query.scan || DEFAULT_SCAN);
    const scan = Math.max(1, Math.min(Number.isFinite(requested) ? requested : DEFAULT_SCAN, MAX_SCAN));
    const latest = counter;
    const first = latest > BigInt(scan) ? latest - BigInt(scan) + 1n : 1n;

    const jobs = [];
    for (let jobId = latest; jobId >= first; jobId -= 1n) {
      const job = await publicClient.readContract({
        address: ERC8183_ADDRESSES.commerce,
        abi: COMMERCE_ABI,
        functionName: "getJob",
        args: [jobId],
      });

      if (job.id === 0n || job.provider.toLowerCase() !== provider.toLowerCase() || Number(job.status) !== FUNDED_STATUS) continue;
      jobs.push({
        id: job.id.toString(),
        client: job.client,
        provider: job.provider,
        evaluator: job.evaluator,
        description: job.description,
        budget: job.budget.toString(),
        expiredAt: job.expiredAt.toString(),
        status: Number(job.status),
        deliverable: job.deliverable,
      });
    }

    const chainIds = jobs.map((job) => Number(job.id)).filter(Number.isSafeInteger);
    if (chainIds.length) {
      const { data: dbJobs, error: dbError } = await supabase
        .from("jobs")
        .select("id,chain_job_id,status,provider_agent_id,mission_task_id")
        .in("chain_job_id", chainIds);
      if (dbError) throw new Error(dbError.message);

      const dbByChainId = new Map((dbJobs || []).map((job) => [String(job.chain_job_id), job]));
      for (const job of jobs) {
        const existing = dbByChainId.get(job.id);
        if (existing) continue;

        await supabase.from("notifications").insert({
          task_id: null,
          recipient: agent.id,
          kind: "erc8183_funded_job",
          title: "New funded ERC-8183 job",
          body: `Chain job #${job.id} is funded and assigned to ${agent.agent_id}.`,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      network: "bsc-mainnet",
      agent,
      provider,
      scanned: { from: first.toString(), to: latest.toString(), count: scan },
      funded_jobs: jobs,
      guidance: "Poll this endpoint from the provider runtime. Before submit, re-read the job and verify FUNDED status, provider assignment, expiry, and service-price/budget requirements.",
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to scan funded jobs" });
  }
}
