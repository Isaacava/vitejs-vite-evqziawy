import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  http,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../src/server/authHandlers.js";

const NETWORK = "bsc-testnet" as const;
const CHAIN_ID = 97 as const;

const DEFAULT_RPC_URL = "https://bsc-testnet-rpc.publicnode.com";
const RPC_URL = process.env.BSC_TESTNET_RPC_URL || process.env.VITE_BSC_RPC_URL || DEFAULT_RPC_URL;

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const ROUTER = "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address;
const POLICY = "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6" as Address;

const COMMERCE_ABI = [
  {
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "expiredAt", type: "uint256" },
      { name: "description", type: "string" },
      { name: "hook", type: "address" },
    ],
    outputs: [{ name: "jobId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setBudget",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "expectedBudget", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "JobCreated",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "provider", type: "address", indexed: true },
      { name: "evaluator", type: "address", indexed: false },
      { name: "expiredAt", type: "uint256", indexed: false },
      { name: "hook", type: "address", indexed: false },
    ],
    anonymous: false,
  },
] as const;

const ROUTER_ABI = [
  {
    type: "function",
    name: "registerJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "policy", type: "address" },
    ],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const TOKEN_ABI = [
  {
    type: "function",
    name: "paymentToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const JOB_READ_ABI = [
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
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
      },
    ],
  },
] as const;

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(RPC_URL),
});

function readContract(args: Record<string, unknown>) {
  return (publicClient.readContract as unknown as (value: Record<string, unknown>) => Promise<any>)(args);
}

const phaseTarget: Record<string, Address | "payment_token"> = {
  create: COMMERCE,
  register: ROUTER,
  set_budget: COMMERCE,
  fund: COMMERCE,
  approve: "payment_token",
};

async function syncReceipt(
  req: VercelRequest,
  res: VercelResponse,
  auth: Awaited<ReturnType<typeof getAuthenticatedUser>>,
) {
  const missionId = typeof req.body?.mission_id === "string" ? req.body.mission_id.trim() : "";
  const jobId = typeof req.body?.job_id === "string" ? req.body.job_id.trim() : "";
  const phase = typeof req.body?.phase === "string" ? req.body.phase.trim().toLowerCase() : "";
  const txHash = typeof req.body?.tx_hash === "string" ? req.body.tx_hash.trim() : "";
  let chainJobId = typeof req.body?.chain_job_id === "string" ? req.body.chain_job_id.trim() : "";

  if (
    !missionId ||
    !jobId ||
    !txHash ||
    !(txHash.startsWith("0x") && txHash.length === 66) ||
    !phaseTarget[phase]
  ) {
    return res.status(400).json({ error: "mission_id, job_id, phase and tx_hash are required" });
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

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hex });
  if (receipt.status !== "success") {
    return res.status(409).json({
      error: "Blockchain transaction reverted",
      tx_hash: txHash,
      status: receipt.status,
      network: NETWORK,
      chain_id: CHAIN_ID,
    });
  }

  const expectedTarget = phaseTarget[phase];
  const target =
    expectedTarget === "payment_token"
      ? ((await readContract({
          address: COMMERCE,
          abi: TOKEN_ABI,
          functionName: "paymentToken",
        })) as Address)
      : expectedTarget;

  if (!receipt.to || receipt.to.toLowerCase() !== target.toLowerCase()) {
    return res.status(409).json({
      error: "Transaction target does not match the requested ERC-8183 Testnet phase",
      expected_target: target,
      actual_target: receipt.to,
      network: NETWORK,
      chain_id: CHAIN_ID,
    });
  }

  if (phase === "create" && !chainJobId) {
    const parsed = parseEventLogs({
      abi: COMMERCE_ABI,
      eventName: "JobCreated",
      logs: receipt.logs,
      strict: false,
    })[0];
    const args = parsed?.args as
      | { jobId?: bigint; client?: Address; provider?: Address }
      | undefined;
    if (!args?.jobId) {
      return res.status(409).json({
        error: "createJob receipt is successful but no JobCreated event with jobId was found",
        tx_hash: txHash,
      });
    }
    if (args.client && args.client.toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ error: "JobCreated client does not match the authenticated wallet" });
    }
    chainJobId = args.jobId.toString();
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id,mission_task_id,status,chain_job_id,chain_status")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) return res.status(404).json({ error: "Marketplace job not found" });

  const { data: task, error: taskError } = await supabase
    .from("mission_tasks")
    .select("id,mission_id")
    .eq("id", job.mission_task_id)
    .eq("mission_id", mission.id)
    .maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task) return res.status(403).json({ error: "Job does not belong to this mission" });

  let confirmedChainStatus = job.chain_status || "not_created";
  let confirmedJob: any = null;
  if (chainJobId) {
    confirmedJob = await readContract({
      address: COMMERCE,
      abi: JOB_READ_ABI,
      functionName: "getJob",
      args: [BigInt(chainJobId)],
    });
    if (!confirmedJob || confirmedJob.id === 0n) {
      return res.status(409).json({ error: "Chain job was not found", chain_job_id: chainJobId });
    }
    if (confirmedJob.client.toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ error: "Chain job client does not match the authenticated wallet" });
    }
  }

  if (phase === "create") confirmedChainStatus = "created";
  else if (phase === "register") confirmedChainStatus = "registered";
  else if (phase === "set_budget") confirmedChainStatus = "budget_set";
  else if (phase === "fund") {
    if (!confirmedJob || Number(confirmedJob.status) !== 1) {
      return res.status(409).json({
        error: "Fund transaction confirmed, but Commerce job is not FUNDED",
        chain_job_id: chainJobId,
        onchain_status: confirmedJob ? Number(confirmedJob.status) : null,
      });
    }
    confirmedChainStatus = "funded";
  }

  const update: Record<string, unknown> = {
    chain_status: confirmedChainStatus,
    updated_at: new Date().toISOString(),
  };
  if (chainJobId) update.chain_job_id = Number(chainJobId);

  const { data: updatedJob, error: updateError } = await supabase
    .from("jobs")
    .update(update)
    .eq("id", job.id)
    .select("id,mission_task_id,status,chain_job_id,chain_status,updated_at")
    .single();
  if (updateError) throw new Error(updateError.message);

  await supabase.from("user_activity").insert({
    user_id: auth.user.id,
    mission_id: mission.id,
    job_id: job.id,
    type: "chain_receipt_confirmed",
    title: `${phase} transaction confirmed`,
    description: `Verified on BSC Testnet: ${txHash}`,
    metadata: {
      phase,
      tx_hash: txHash,
      chain_job_id: chainJobId || null,
      block_number: receipt.blockNumber.toString(),
      receipt_status: receipt.status,
      chain_id: CHAIN_ID,
      network: NETWORK,
    },
  });

  return res.status(200).json({
    ok: true,
    phase,
    network: NETWORK,
    chain_id: CHAIN_ID,
    tx_hash: txHash,
    block_number: receipt.blockNumber.toString(),
    receipt_status: receipt.status,
    job: updatedJob,
    onchain_job: confirmedJob
      ? {
          id: confirmedJob.id.toString(),
          status: Number(confirmedJob.status),
          budget: confirmedJob.budget.toString(),
          provider: confirmedJob.provider,
          client: confirmedJob.client,
        }
      : null,
    note: "Database state advanced only after a successful BSC Testnet receipt and matching Testnet ERC-8183 contract target.",
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  try {
    if (req.body?.action === "sync_receipt") return await syncReceipt(req, res, auth);

    const missionId = typeof req.body?.mission_id === "string" ? req.body.mission_id.trim() : "";
    const clientAddress = typeof req.body?.client_address === "string" ? req.body.client_address.trim() : "";
    const budget = typeof req.body?.budget === "string" ? req.body.budget.trim() : String(req.body?.budget ?? "");

    if (!missionId || !/^0x[a-fA-F0-9]{40}$/.test(clientAddress) || !budget) {
      return res.status(400).json({ error: "mission_id, authenticated client_address and budget are required" });
    }
    if (clientAddress.toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ error: "client_address must match the authenticated wallet" });
    }

    const supabase = serverClient();
    const { data: mission, error: missionError } = await supabase
      .from("missions")
      .select("id,goal,status,budget,user_id")
      .eq("id", missionId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (missionError) throw new Error(missionError.message);
    if (!mission) return res.status(404).json({ error: "Mission not found" });

    const { data: task, error: taskError } = await supabase
      .from("mission_tasks")
      .select("id,agent_id,budget")
      .eq("mission_id", mission.id)
      .limit(1)
      .maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task) return res.status(409).json({ error: "Mission has no task" });

    const token = (await readContract({ address: COMMERCE, abi: TOKEN_ABI, functionName: "paymentToken" })) as Address;
    const tokenData = await Promise.all([
      readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
      readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
      readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [clientAddress as Address] }),
      readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [clientAddress as Address, COMMERCE] }),
    ]);

    const decimals = Number(tokenData[0]);
    const symbol = String(tokenData[1]);
    const balance = tokenData[2] as bigint;
    const allowance = tokenData[3] as bigint;
    const requestedBudget = parseUnits(budget, decimals);

    if (requestedBudget <= 0n) return res.status(400).json({ error: "budget must be greater than zero" });
    if (requestedBudget > balance) {
      return res.status(409).json({
        error: "Requested budget exceeds Testnet payment-token balance",
        balance: formatUnits(balance, decimals),
        symbol,
      });
    }

    const evaluator = ROUTER;
    const hook = ROUTER;
    const provider = String(req.body?.provider_address || "").trim() as Address;
    if (!/^0x[a-fA-F0-9]{40}$/.test(provider)) return res.status(400).json({ error: "provider_address is required" });

    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 60 * 60);
    const description = String(req.body?.description || mission.goal || "AgentMarket Testnet mission").trim();

    const createJobData = encodeFunctionData({
      abi: COMMERCE_ABI,
      functionName: "createJob",
      args: [provider, evaluator, expiresAt, description, hook],
    });
    const registerJobData = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: "registerJob",
      args: [0n, POLICY],
    });

    return res.status(200).json({
      network: NETWORK,
      chain_id: CHAIN_ID,
      rpc_url: RPC_URL,
      contracts: { commerce: COMMERCE, router: ROUTER, policy: POLICY, payment_token: token },
      payment: {
        symbol,
        decimals,
        balance: formatUnits(balance, decimals),
        allowance: formatUnits(allowance, decimals),
        requested_budget: budget,
        requested_budget_raw: requestedBudget.toString(),
      },
      transactions: {
        create_job: { to: COMMERCE, data: createJobData },
        register_job_template: { to: ROUTER, data: registerJobData },
      },
      note: "This endpoint is hard-locked to BSC Testnet. All chain reads use the configured Testnet RPC.",
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected Testnet ERC-8183 error",
      network: NETWORK,
      chain_id: CHAIN_ID,
    });
  }
}
