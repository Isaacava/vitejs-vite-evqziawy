import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, formatUnits, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "./_auth.js";

const ACTIONS = new Set(["accept", "start", "submit", "approve", "reject", "cancel"]);
const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const COMMERCE_ABI = [{
  type: "function", name: "paymentToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }],
}, {
  type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }],
  outputs: [{ name: "job", type: "tuple", components: [
    { name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" },
  ] }],
}] as const;
const ERC20_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });
const ACTION_CHAIN_REQUIRED = ["accept", "start", "submit"];
const CHAIN_STATUS: Record<number, string> = { 0: "open", 1: "funded", 2: "submitted", 3: "completed", 4: "rejected", 5: "expired" };

function transition(status: string, action: string) {
  const map: Record<string, Record<string, string>> = { open: { accept: "accepted", cancel: "cancelled" }, funded: { accept: "accepted", cancel: "cancelled" }, accepted: { start: "in_progress", cancel: "cancelled" }, in_progress: { submit: "submitted", cancel: "cancelled" }, submitted: {}, disputed: {} };
  return map[status]?.[action] ?? null;
}

async function readChainSnapshot(chainJobId: number) {
  if (!Number.isFinite(chainJobId) || chainJobId <= 0) return null;
  try {
    const chainJob = await publicClient.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "getJob", args: [BigInt(chainJobId)] });
    const token = await publicClient.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "paymentToken" });
    const [decimals, symbol] = await Promise.all([
      publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
      publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
    ]);
    const status = CHAIN_STATUS[Number(chainJob.status)] || "unknown";
    const deliverable = chainJob.deliverable && chainJob.deliverable !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? chainJob.deliverable : null;
    return {
      chain_job_id: Number(chainJob.id), chain_status: status, chain_client: chainJob.client, chain_provider: chainJob.provider, chain_evaluator: chainJob.evaluator,
      chain_description: chainJob.description, chain_budget_raw: chainJob.budget.toString(), chain_budget: formatUnits(chainJob.budget, Number(decimals)), token_address: token,
      token_symbol: symbol, token_decimals: Number(decimals), chain_expired_at: Number(chainJob.expiredAt), chain_submitted_at: chainJob.submittedAt > 0n ? new Date(Number(chainJob.submittedAt) * 1000).toISOString() : null, chain_deliverable: deliverable,
    };
  } catch (error) { console.error("Failed to read ERC-8183 job snapshot", chainJobId, error); return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const supabase = serverClient();
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });

    if (req.method === "GET") {
      const id = typeof req.query.id === "string" ? req.query.id : "";
      if (!id) return res.status(400).json({ error: "id is required" });
      const { data: job, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,provider_agent_id,client_wallet,status,description,budget,chain_job_id,chain_status,chain_last_synced_at,chain_tx_hash,chain_error,deliverable,created_at,funded_at,accepted_at,submitted_at,terminal_at,updated_at").eq("id", id).maybeSingle();
      if (jobError) return res.status(500).json({ error: jobError.message });
      if (!job) return res.status(404).json({ error: "Job not found" });

      const taskResult = job.mission_task_id ? await supabase.from("mission_tasks").select("id,mission_id,agent_id,title,role,description,budget,status,chain_job_id").eq("id", job.mission_task_id).maybeSingle() : { data: null, error: null };
      if (taskResult.error) return res.status(500).json({ error: taskResult.error.message });
      const missionId = taskResult.data?.mission_id ?? null;
      if (!missionId) return res.status(403).json({ error: "Job is not attached to a user mission" });

      const { data: mission, error: missionError } = await supabase.from("missions").select("id,title,goal,category,budget,status,client_wallet,user_id,created_at,updated_at").eq("id", missionId).maybeSingle();
      if (missionError) return res.status(500).json({ error: missionError.message });
      if (!mission || mission.user_id !== auth.user.id) return res.status(403).json({ error: "You do not own this mission" });

      const [evaluationResult, paymentResult, executionCapitalResult, chain] = await Promise.all([
        supabase.from("evaluations").select("id,job_id,verdict,evaluator_address,evidence,notes,created_at,updated_at").eq("job_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("payments").select("id,job_id,mission_id,token_address,token_symbol,amount,status,tx_hash,created_at,updated_at").eq("job_id", id).maybeSingle(),
        supabase.from("execution_capital_requests").select("*").eq("job_id", id).maybeSingle(),
        job.chain_job_id ? readChainSnapshot(Number(job.chain_job_id)) : Promise.resolve(null),
      ]);
      if (executionCapitalResult.error) {
        const message = executionCapitalResult.error.message.toLowerCase();
        if (!message.includes("relation") && !message.includes("does not exist")) return res.status(500).json({ error: executionCapitalResult.error.message });
      }

      const providerAgentId = job.provider_agent_id || taskResult.data?.agent_id || null;
      const { data: providerAgent } = providerAgentId
        ? await supabase.from("agents").select("id,agent_id,name").eq("id", providerAgentId).maybeSingle()
        : { data: null };
      const safeMission = { ...mission };
      delete (safeMission as { user_id?: string }).user_id;
      const effectiveStatus = chain?.chain_status || job.chain_status || job.status;
      const effectiveBudget = chain?.chain_budget ?? job.budget ?? paymentResult.data?.amount ?? 0;
      const effectiveDeliverable = chain?.chain_deliverable || job.deliverable || null;
      const effectivePayment = { ...(paymentResult.data || {}), token_symbol: chain?.token_symbol || paymentResult.data?.token_symbol || "tBNB", amount: chain?.chain_budget ?? paymentResult.data?.amount ?? job.budget ?? 0 };

      return res.status(200).json({
        job: { ...job, status: effectiveStatus, budget: effectiveBudget, chain_status: chain?.chain_status || job.chain_status, deliverable: effectiveDeliverable, chain_live: Boolean(chain) },
        task: taskResult.data ? { ...taskResult.data, agent: providerAgent || null } : null,
        agent: providerAgent || null,
        mission: safeMission,
        evaluation: evaluationResult.data,
        payment: effectivePayment,
        execution_capital: executionCapitalResult.data || null,
        chain, network: "bsc-testnet", chain_id: 97, source_of_truth: chain ? "erc8183_commerce" : "supabase_job",
      });
    }

    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "Method not allowed" }); }
    const id = typeof req.body?.job_id === "string" ? req.body.job_id.trim() : "";
    const action = typeof req.body?.action === "string" ? req.body.action.trim() : "";
    const deliverable = typeof req.body?.deliverable === "string" ? req.body.deliverable.trim() : "";
    if (!id) return res.status(400).json({ error: "job_id is required" });
    if (!ACTIONS.has(action)) return res.status(400).json({ error: "Unsupported job action" });
    if (action === "approve" || action === "reject") return res.status(409).json({ error: "On-chain evaluation and settlement are not yet wired here. No payment or terminal state was changed.", protocol: { action, onChainRequired: true, chainJobRequired: true } });

    const { data: job, error: jobError } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
    if (jobError) return res.status(500).json({ error: jobError.message });
    if (!job) return res.status(404).json({ error: "Job not found" });
    const task = job.mission_task_id ? (await supabase.from("mission_tasks").select("id,mission_id,agent_id").eq("id", job.mission_task_id).maybeSingle()).data : null;
    if (!task?.mission_id) return res.status(403).json({ error: "Job is not attached to a user mission" });
    const { data: mission, error: missionError } = await supabase.from("missions").select("id,user_id,client_wallet").eq("id", task.mission_id).maybeSingle();
    if (missionError) return res.status(500).json({ error: missionError.message });
    if (!mission || mission.user_id !== auth.user.id) return res.status(403).json({ error: "You do not own this mission" });
    const liveChain = job.chain_job_id ? await readChainSnapshot(Number(job.chain_job_id)) : null;
    if (liveChain && ACTION_CHAIN_REQUIRED.includes(action)) return res.status(409).json({ error: "This job is backed by a live ERC-8183 chain record. Use the protocol-specific Testnet execution flow; the mission console is read-only for lifecycle state.", protocol: { action, onChainRequired: true, chainJobId: Number(job.chain_job_id), chainStatus: liveChain.chain_status } });
    const nextStatus = transition(job.status, action);
    if (!nextStatus) return res.status(409).json({ error: `Cannot ${action} a job in ${job.status} state` });
    if (action === "submit" && !deliverable) return res.status(400).json({ error: "deliverable is required for submit" });
    const now = new Date().toISOString(); const jobPatch: Record<string, unknown> = { status: nextStatus, updated_at: now };
    if (action === "accept") jobPatch.accepted_at = now; if (action === "submit") { jobPatch.submitted_at = now; jobPatch.deliverable = deliverable; } if (action === "cancel") jobPatch.terminal_at = now;
    const { data: updatedJob, error: updateError } = await supabase.from("jobs").update(jobPatch).eq("id", id).select("*").single();
    if (updateError) return res.status(500).json({ error: updateError.message });
    if (job.mission_task_id) { const taskStatus: Record<string, string> = { accepted: "accepted", in_progress: "in_progress", submitted: "submitted", cancelled: "cancelled" }; const nextTaskStatus = taskStatus[nextStatus]; if (nextTaskStatus) await supabase.from("mission_tasks").update({ status: nextTaskStatus, updated_at: now }).eq("id", job.mission_task_id); }
    const missionStatus = nextStatus === "in_progress" ? "in_progress" : nextStatus === "submitted" ? "awaiting_review" : nextStatus === "cancelled" ? "cancelled" : null;
    if (missionStatus) await supabase.from("missions").update({ status: missionStatus, updated_at: now }).eq("id", task.mission_id).eq("user_id", auth.user.id);
    if (action === "submit") await supabase.from("evaluations").upsert({ job_id: id, verdict: "pending", notes: null, evidence: { deliverable }, updated_at: now }, { onConflict: "job_id" });
    return res.status(200).json({ job: updatedJob });
  } catch (error) { console.error("jobs handler failed", error); return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to process job" }); }
}
