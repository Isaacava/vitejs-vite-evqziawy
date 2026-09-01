import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { serverClient } from "../../src/server/authHandlers.js";
import { PROVIDER_ERC8183_TESTNET } from "../../src/lib/erc8183ProviderTestnet.js";

const NETWORK = "bsc-testnet" as const;
const CHAIN_ID = 97 as const;
const RPC_URL = process.env.BSC_TESTNET_RPC_URL || process.env.VITE_BSC_RPC_URL || "https://bsc-testnet-rpc.publicnode.com";
const COMMERCE = PROVIDER_ERC8183_TESTNET.commerce;
const ROUTER = PROVIDER_ERC8183_TESTNET.router;

const COMMERCE_ABI = [{
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
}] as const;

const ROUTER_ABI = [{
  type: "function",
  name: "settle",
  stateMutability: "nonpayable",
  inputs: [{ name: "jobId", type: "uint256" }, { name: "optParams", type: "bytes" }],
  outputs: [],
}] as const;

const ROUTER_POLICY_ABI = [{
  type: "function",
  name: "jobPolicy",
  stateMutability: "view",
  inputs: [{ name: "jobId", type: "uint256" }],
  outputs: [{ type: "address" }],
}] as const;

const POLICY_ABI = [{
  type: "function",
  name: "check",
  stateMutability: "view",
  inputs: [{ name: "jobId", type: "uint256" }],
  outputs: [{ name: "verdict", type: "uint8" }],
}] as const;

const publicClient = createPublicClient({ chain: bscTestnet, transport: http(RPC_URL) });
const CHAIN_STATUS: Record<number, "open" | "funded" | "submitted" | "completed" | "rejected" | "expired"> = {
  0: "open",
  1: "funded",
  2: "submitted",
  3: "completed",
  4: "rejected",
  5: "expired",
};

function authorized(req: VercelRequest) {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false;
  const bearer = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  const headerSecret = typeof req.headers["x-cron-secret"] === "string" ? req.headers["x-cron-secret"] : "";
  return bearer === `Bearer ${configured}` || headerSecret === configured;
}

function getOperator() {
  const raw = process.env.ERC8183_SETTLEMENT_PRIVATE_KEY?.trim();
  if (!raw || !/^0x[a-fA-F0-9]{64}$/.test(raw)) throw new Error("ERC8183_SETTLEMENT_PRIVATE_KEY is not configured");
  const account = privateKeyToAccount(raw as Hex);
  const wallet = createWalletClient({ account, chain: bscTestnet, transport: http(RPC_URL) });
  return { account, wallet };
}

async function syncTerminalJob(
  supabase: ReturnType<typeof serverClient>,
  job: { id: string; mission_id: string; user_id: string },
  chainJobId: string,
  txHash: Hex,
  blockNumber: bigint,
  chainStatus: string,
  evaluator: Address,
) {
  const now = new Date().toISOString();
  const { data: existingTx } = await supabase.from("transactions").select("id").eq("tx_hash", txHash).maybeSingle();
  if (!existingTx) {
    const { error } = await supabase.from("transactions").insert({
      mission_id: job.mission_id,
      job_id: job.id,
      tx_hash: txHash,
      chain_id: CHAIN_ID,
      kind: "settlement",
      status: "confirmed",
      block_number: Number(blockNumber),
      metadata: { chain_job_id: chainJobId, chain_status: chainStatus, network: NETWORK, source: "auto_settlement_worker" },
    });
    if (error) throw new Error(error.message);
  }

  const { error: jobError } = await supabase.from("jobs").update({
    chain_status: chainStatus,
    chain_last_synced_at: now,
    chain_tx_hash: txHash,
    terminal_at: now,
    updated_at: now,
  }).eq("id", job.id);
  if (jobError) throw new Error(jobError.message);

  const verdict = chainStatus === "completed" ? "approve" : "reject";
  const { data: evaluation } = await supabase.from("evaluations").select("id").eq("job_id", job.id).maybeSingle();
  const evidence = {
    source: "erc8183_chain",
    tx_hash: txHash,
    chain_job_id: chainJobId,
    chain_status: chainStatus,
    block_number: Number(blockNumber),
    chain_id: CHAIN_ID,
    network: NETWORK,
    settlement: "permissionless_operator",
  };
  if (evaluation?.id) {
    await supabase.from("evaluations").update({ verdict, evidence, updated_at: now }).eq("id", evaluation.id);
  } else {
    await supabase.from("evaluations").insert({
      job_id: job.id,
      verdict,
      evaluator_address: evaluator,
      evidence,
      notes: "Terminal ERC-8183 state verified by the AgentMarket settlement worker.",
    });
  }

  const paymentStatus = chainStatus === "completed" ? "released" : "refunded";
  const { data: payment } = await supabase.from("payments").select("id").eq("job_id", job.id).maybeSingle();
  if (payment?.id) await supabase.from("payments").update({ status: paymentStatus, tx_hash: txHash, updated_at: now }).eq("id", payment.id);

  await supabase.from("user_activity").insert({
    user_id: job.user_id,
    mission_id: job.mission_id,
    job_id: job.id,
    type: "settlement_synced",
    title: `Settlement ${chainStatus}`,
    description: `AgentMarket automatically finalized the BSC Testnet ERC-8183 job: ${chainStatus}.`,
    metadata: { tx_hash: txHash, chain_job_id: chainJobId, chain_status: chainStatus, block_number: Number(blockNumber), chain_id: CHAIN_ID, network: NETWORK, source: "auto_settlement_worker" },
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized settlement worker request" });

  try {
    const supabase = serverClient();
    const { account, wallet } = getOperator();
    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("id,mission_id,user_id,chain_job_id,chain_status,status")
      .eq("chain_status", "submitted")
      .not("chain_job_id", "is", null)
      .limit(50);
    if (error) throw new Error(error.message);

    const results: Array<Record<string, unknown>> = [];

    for (const job of jobs || []) {
      const chainJobId = String(job.chain_job_id || "");
      if (!/^\d+$/.test(chainJobId)) continue;

      try {
        const chainJob = await publicClient.readContract({
          address: COMMERCE,
          abi: COMMERCE_ABI,
          functionName: "getJob",
          args: [BigInt(chainJobId)],
        }) as unknown as {
          id: bigint;
          evaluator: Address;
          status: number;
          deliverable: Hex;
        };

        const status = Number(chainJob.status);
        if (CHAIN_STATUS[status] !== "submitted") {
          results.push({ job_id: job.id, chain_job_id: chainJobId, action: "sync_only", status: CHAIN_STATUS[status] || `status_${status}` });
          continue;
        }
        if (!chainJob.deliverable || /^0x0+$/i.test(chainJob.deliverable)) {
          results.push({ job_id: job.id, chain_job_id: chainJobId, action: "wait", reason: "missing_deliverable" });
          continue;
        }

        const policyAddress = await publicClient.readContract({
          address: ROUTER,
          abi: ROUTER_POLICY_ABI,
          functionName: "jobPolicy",
          args: [BigInt(chainJobId)],
        }) as Address;

        const verdict = Number(await publicClient.readContract({
          address: policyAddress,
          abi: POLICY_ABI,
          functionName: "check",
          args: [BigInt(chainJobId)],
        }));

        if (verdict === 0) {
          results.push({ job_id: job.id, chain_job_id: chainJobId, action: "wait", policy: "pending" });
          continue;
        }

        const simulation = await publicClient.simulateContract({
          address: ROUTER,
          abi: ROUTER_ABI,
          functionName: "settle",
          args: [BigInt(chainJobId), "0x"],
          account: account.address,
        });
        const txHash = await wallet.writeContract(simulation.request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== "success") throw new Error("Settlement transaction reverted");

        const terminal = await publicClient.readContract({
          address: COMMERCE,
          abi: COMMERCE_ABI,
          functionName: "getJob",
          args: [BigInt(chainJobId)],
        }) as unknown as { id: bigint; evaluator: Address; status: number; deliverable: Hex };
        const terminalStatus = CHAIN_STATUS[Number(terminal.status)];
        if (!["completed", "rejected", "expired"].includes(terminalStatus || "")) {
          throw new Error(`Settlement receipt confirmed but job ${chainJobId} is still non-terminal`);
        }

        await syncTerminalJob(supabase, job, chainJobId, txHash, receipt.blockNumber, terminalStatus!, terminal.evaluator);
        results.push({ job_id: job.id, chain_job_id: chainJobId, action: "settled", policy: verdict === 1 ? "approve" : "reject", chain_status: terminalStatus, tx_hash: txHash, operator: account.address });
      } catch (cause) {
        results.push({ job_id: job.id, chain_job_id: chainJobId, action: "error", error: cause instanceof Error ? cause.message : "Settlement attempt failed" });
      }
    }

    return res.status(200).json({ ok: true, network: NETWORK, chain_id: CHAIN_ID, commerce: COMMERCE, router: ROUTER, operator: account.address, inspected: jobs?.length || 0, results });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Automatic settlement worker failed", network: NETWORK, chain_id: CHAIN_ID });
  }
}
