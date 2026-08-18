import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { bsc } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../src/server/authHandlers.js";

const COMMERCE = "0xea4daa3100a767e86fded867729ae7446476eba6" as Address;
const ROUTER = "0x51895229e12f9876011789b04f8698af06ccd6da" as Address;

const COMMERCE_ABI = [
  {
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
  },
] as const;

type ChainJob = {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  expiredAt: bigint;
  description: string;
  budget: bigint;
  status: number | bigint;
  deliverable: string;
  hook: Address;
};

const client = createPublicClient({ chain: bsc, transport: http() });
const CHAIN_STATUS: Record<number, "open" | "funded" | "submitted" | "completed" | "rejected" | "expired"> = {
  0: "open",
  1: "funded",
  2: "submitted",
  3: "completed",
  4: "rejected",
  5: "expired",
};

function isTerminal(status: number) {
  return status === 3 || status === 4 || status === 5;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  const missionId = typeof req.body?.mission_id === "string" ? req.body.mission_id.trim() : "";
  const jobId = typeof req.body?.job_id === "string" ? req.body.job_id.trim() : "";
  const chainJobId = typeof req.body?.chain_job_id === "string" ? req.body.chain_job_id.trim() : "";
  const txHash = typeof req.body?.tx_hash === "string" ? req.body.tx_hash.trim() : "";

  if (!missionId || !jobId || !/^\d+$/.test(chainJobId) || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return res.status(400).json({ error: "mission_id, job_id, chain_job_id and tx_hash are required" });
  }

  const supabase = serverClient();
  const { data: mission, error: missionError } = await supabase
    .from("missions")
    .select("id,user_id,status")
    .eq("id", missionId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (missionError) throw new Error(missionError.message);
  if (!mission) return res.status(404).json({ error: "Mission not found" });

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id,mission_task_id,provider_agent_id,chain_job_id,chain_status,status,budget,payment_token")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) return res.status(404).json({ error: "Marketplace job not found" });
  if (String(job.chain_job_id || "") !== chainJobId) return res.status(409).json({ error: "Chain job id does not match the marketplace job" });

  const { data: task, error: taskError } = await supabase
    .from("mission_tasks")
    .select("id,mission_id")
    .eq("id", job.mission_task_id)
    .eq("mission_id", mission.id)
    .maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task) return res.status(403).json({ error: "Job does not belong to this mission" });

  const receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
  if (receipt.status !== "success") {
    return res.status(409).json({ error: "Settlement transaction reverted", tx_hash: txHash, status: receipt.status });
  }
  if (!receipt.to || receipt.to.toLowerCase() !== ROUTER.toLowerCase()) {
    return res.status(409).json({ error: "Transaction target is not the production ERC-8183 router", expected_target: ROUTER, actual_target: receipt.to });
  }

  const chainJob = (await client.readContract({
    address: COMMERCE,
    abi: COMMERCE_ABI,
    functionName: "getJob",
    args: [BigInt(chainJobId)],
  } as never)) as unknown as ChainJob;
  if (!chainJob || chainJob.id === 0n) return res.status(409).json({ error: "Chain job was not found" });
  if (chainJob.client.toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
    return res.status(403).json({ error: "Chain job client does not match the authenticated wallet" });
  }

  const status = Number(chainJob.status);
  const chainStatus = CHAIN_STATUS[status];
  if (!chainStatus) return res.status(409).json({ error: "Unknown ERC-8183 job status", onchain_status: status });
  if (!isTerminal(status)) {
    return res.status(409).json({ error: "Settlement receipt confirmed, but the chain job is not terminal", chain_status: chainStatus, onchain_status: status });
  }

  const existingTx = await supabase.from("transactions").select("id").eq("tx_hash", txHash).maybeSingle();
  if (!existingTx.data) {
    const { error: txError } = await supabase.from("transactions").insert({
      mission_id: mission.id,
      job_id: job.id,
      tx_hash: txHash,
      chain_id: 56,
      kind: "settlement",
      status: "confirmed",
      block_number: Number(receipt.blockNumber),
      metadata: { chain_job_id: chainJobId, chain_status: chainStatus, network: "bsc-mainnet" },
    });
    if (txError) throw new Error(txError.message);
  }

  const now = new Date().toISOString();
  const { error: jobUpdateError } = await supabase
    .from("jobs")
    .update({
      chain_status: chainStatus,
      chain_last_synced_at: now,
      chain_tx_hash: txHash,
      deliverable: chainJob.deliverable || null,
      terminal_at: now,
      updated_at: now,
    })
    .eq("id", job.id);
  if (jobUpdateError) throw new Error(jobUpdateError.message);

  const verdict = chainStatus === "completed" ? "approve" : "reject";
  const { data: evaluation } = await supabase
    .from("evaluations")
    .select("id")
    .eq("job_id", job.id)
    .maybeSingle();
  if (evaluation?.id) {
    await supabase.from("evaluations").update({
      verdict,
      evidence: {
        source: "erc8183_chain",
        tx_hash: txHash,
        chain_job_id: chainJobId,
        chain_status: chainStatus,
        block_number: Number(receipt.blockNumber),
        deliverable: chainJob.deliverable || null,
        chain_id: 56,
      },
      updated_at: now,
    }).eq("id", evaluation.id);
  } else {
    await supabase.from("evaluations").insert({
      job_id: job.id,
      verdict,
      evaluator_address: chainJob.evaluator,
      evidence: {
        source: "erc8183_chain",
        tx_hash: txHash,
        chain_job_id: chainJobId,
        chain_status: chainStatus,
        block_number: Number(receipt.blockNumber),
        deliverable: chainJob.deliverable || null,
        chain_id: 56,
      },
      notes: "Terminal outcome verified from the BSC Mainnet ERC-8183 job state.",
    });
  }

  const paymentStatus = chainStatus === "completed" ? "released" : "refunded";
  const { data: payment } = await supabase.from("payments").select("id").eq("job_id", job.id).maybeSingle();
  if (payment?.id) {
    await supabase.from("payments").update({ status: paymentStatus, tx_hash: txHash, updated_at: now }).eq("id", payment.id);
  }

  if (job.provider_agent_id) {
    const score = chainStatus === "completed" ? 100 : 0;
    const existingRep = await supabase.from("reputation").select("id").eq("job_id", job.id).maybeSingle();
    if (!existingRep.data) {
      await supabase.from("reputation").insert({
        agent_id: job.provider_agent_id,
        job_id: job.id,
        score,
        source: "platform",
        feedback: {
          outcome: chainStatus,
          verified: true,
          tx_hash: txHash,
          chain_job_id: chainJobId,
          chain_id: 56,
        },
      });
    }
  }

  await supabase.from("user_activity").insert({
    user_id: auth.user.id,
    mission_id: mission.id,
    job_id: job.id,
    type: "settlement_synced",
    title: `Settlement ${chainStatus}`,
    description: `Verified terminal ERC-8183 state on BSC Mainnet: ${chainStatus}.`,
    metadata: { tx_hash: txHash, chain_job_id: chainJobId, chain_status: chainStatus, block_number: Number(receipt.blockNumber), chain_id: 56 },
  });

  return res.status(200).json({
    ok: true,
    network: "bsc-mainnet",
    chain_id: 56,
    tx_hash: txHash,
    block_number: receipt.blockNumber.toString(),
    chain_job_id: chainJobId,
    chain_status: chainStatus,
    evaluation_verdict: verdict,
    payment_status: paymentStatus,
    reputation_recorded: !!job.provider_agent_id,
    note: "Production terminal state was updated only after successful mainnet router receipt verification and a terminal ERC-8183 job read.",
  });
}
