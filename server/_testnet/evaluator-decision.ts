import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, encodeFunctionData, http, keccak256, toHex, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const RPC_URL = process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com";

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
      { name: "description", type: "string" },
      { name: "budget", type: "uint256" },
      { name: "expiredAt", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "hook", type: "address" },
      { name: "submittedAt", type: "uint256" },
      { name: "deliverable", type: "bytes32" },
    ],
  }],
  },
  {
    type: "function",
    name: "complete",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "reason", type: "bytes32" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "reject",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "reason", type: "bytes32" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(RPC_URL),
});

const CHAIN_STATUS: Record<number, "open" | "funded" | "submitted" | "completed" | "rejected" | "expired"> = {
  0: "open",
  1: "funded",
  2: "submitted",
  3: "completed",
  4: "rejected",
  5: "expired",
};

function address(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function positiveScore(value: unknown) {
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });
  if (!address(auth.user.wallet_address)) return res.status(401).json({ error: "Authenticated wallet is invalid" });

  try {
    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const missionId = typeof body.mission_id === "string" ? body.mission_id.trim() : "";
    const jobId = typeof body.job_id === "string" ? body.job_id.trim() : "";
    const chainJobId = typeof body.chain_job_id === "string" ? body.chain_job_id.trim() : String(body.chain_job_id ?? "").trim();
    const verdict = typeof body.verdict === "string" ? body.verdict.trim().toLowerCase() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const score = positiveScore(body.score);

    if (!missionId || !jobId || !/^\d+$/.test(chainJobId)) {
      return res.status(400).json({ error: "mission_id, job_id and chain_job_id are required" });
    }
    if (verdict !== "approve" && verdict !== "reject") {
      return res.status(400).json({ error: "verdict must be approve or reject" });
    }
    if (reason.length > 2048) {
      return res.status(400).json({ error: "reason cannot exceed 2048 characters" });
    }

    const supabase = serverClient();
    const { data: mission, error: missionError } = await supabase
      .from("missions")
      .select("id,user_id")
      .eq("id", missionId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (missionError) throw new Error(missionError.message);
    if (!mission) return res.status(404).json({ error: "Mission not found" });

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id,mission_task_id,chain_job_id,status,chain_status")
      .eq("id", jobId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return res.status(404).json({ error: "Marketplace job not found" });
    if (String(job.chain_job_id || "") !== chainJobId) {
      return res.status(409).json({ error: "chain_job_id does not match the marketplace job" });
    }

    const { data: task, error: taskError } = await supabase
      .from("mission_tasks")
      .select("id,mission_id")
      .eq("id", job.mission_task_id)
      .eq("mission_id", mission.id)
      .maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task) return res.status(403).json({ error: "Job does not belong to this mission" });

    const chainJob = await publicClient.readContract({
      address: COMMERCE,
      abi: COMMERCE_ABI,
      functionName: "getJob",
      args: [BigInt(chainJobId)],
    });

    if (!chainJob || chainJob.id === 0n) return res.status(404).json({ error: "Chain job not found" });
    const onchainStatus = Number(chainJob.status);
    const chainStatus = CHAIN_STATUS[onchainStatus];
    if (!chainStatus) return res.status(409).json({ error: "Unknown ERC-8183 job status", onchain_status: onchainStatus });
    if (chainStatus !== "submitted") {
      return res.status(409).json({ error: `Evaluator decision requires a SUBMITTED job; current state is ${chainStatus.toUpperCase()}`, chain_status: chainStatus });
    }
    if (chainJob.client.toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      const evaluator = chainJob.evaluator.toLowerCase();
      if (evaluator !== auth.user.wallet_address.toLowerCase()) {
        return res.status(403).json({ error: "Authenticated wallet is not the on-chain evaluator for this job", evaluator: chainJob.evaluator });
      }
    }

    const evaluatorAddress = chainJob.evaluator.toLowerCase();
    if (evaluatorAddress === COMMERCE.toLowerCase()) {
      return res.status(409).json({ error: "This job uses a contract evaluator; use that evaluator's protocol-specific decision path instead of a direct wallet complete/reject transaction" });
    }
    if (evaluatorAddress !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ error: "Authenticated wallet is not the live ERC-8183 evaluator", evaluator: chainJob.evaluator });
    }

    const reasonHash: Hex = reason ? keccak256(toHex(reason)) : "0x0000000000000000000000000000000000000000000000000000000000000000";
    const functionName = verdict === "approve" ? "complete" : "reject";
    const data = encodeFunctionData({
      abi: COMMERCE_ABI,
      functionName,
      args: [BigInt(chainJobId), reasonHash, "0x"],
    });

    const now = new Date().toISOString();
    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: 97,
      mission_id: mission.id,
      job_id: job.id,
      chain_job_id: chainJobId,
      evaluator: chainJob.evaluator,
      provider: chainJob.provider,
      deliverable: chainJob.deliverable,
      current_status: chainStatus,
      verdict,
      score,
      reason: reason || null,
      reason_hash: reasonHash,
      transaction: {
        to: COMMERCE,
        data,
        value: "0x0",
        chain_id: 97,
        function: functionName,
      },
      prepared_at: now,
      broadcast: false,
      note: "Prepared only. The connected evaluator wallet must sign and broadcast this transaction. AgentMarket will verify the receipt and resulting chain state before recording the terminal outcome.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare evaluator decision";
    const status = /required|invalid|not found|requires|current state|does not belong|not the|evaluator/i.test(message) ? 409 : 500;
    return res.status(status).json({ error: message });
  }
}
