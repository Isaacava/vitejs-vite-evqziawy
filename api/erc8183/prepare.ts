import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { encodeFunctionData, type Address } from "viem";
import {
  COMMERCE_ABI,
  ERC20_ABI,
  ERC8183_ADDRESSES,
  publicClient,
  ROUTER_ABI,
} from "../../src/lib/erc8183.js";

function supabaseServer() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

function address(value: unknown, field: string): Address {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${field} must be a valid EVM address`);
  }
  return value as Address;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const missionId = typeof req.body?.mission_id === "string" ? req.body.mission_id : "";
    const clientAddress = address(req.body?.client_address, "client_address");
    const budget = typeof req.body?.budget === "string" ? BigInt(req.body.budget) : BigInt(req.body?.budget || 0);
    const ttlSeconds = Math.max(300, Math.min(Number(req.body?.ttl_seconds || 24 * 60 * 60), 7 * 24 * 60 * 60));

    if (!missionId) throw new Error("mission_id is required");
    if (budget <= 0n) throw new Error("budget must be greater than zero");

    const supabase = supabaseServer();
    const { data: mission, error: missionError } = await supabase
      .from("missions")
      .select("id, goal, status")
      .eq("id", missionId)
      .maybeSingle();
    if (missionError) throw new Error(missionError.message);
    if (!mission) return res.status(404).json({ error: "Mission not found" });

    const { data: task, error: taskError } = await supabase
      .from("mission_tasks")
      .select("id, agent_id, task_type")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task?.agent_id) throw new Error("Mission does not have an assigned agent");

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("agent_id, owner, name, status, verification_status")
      .eq("id", task.agent_id)
      .maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent?.owner) throw new Error("Assigned agent does not have a provider wallet");

    const provider = address(agent.owner, "agent.owner");
    const paymentToken = await publicClient.readContract({
      address: ERC8183_ADDRESSES.commerce,
      abi: COMMERCE_ABI,
      functionName: "paymentToken",
    });
    const [tokenSymbol, tokenDecimals] = await Promise.all([
      publicClient.readContract({ address: paymentToken, abi: ERC20_ABI, functionName: "symbol" }),
      publicClient.readContract({ address: paymentToken, abi: ERC20_ABI, functionName: "decimals" }),
    ]);

    const expiry = BigInt(Math.floor(Date.now() / 1000) + ttlSeconds);
    const description = mission.goal || `AgentMarket mission ${missionId}`;
    const emptyBytes = "0x" as const;

    const createJobData = encodeFunctionData({
      abi: COMMERCE_ABI,
      functionName: "createJob",
      args: [provider, ERC8183_ADDRESSES.router, expiry, description, ERC8183_ADDRESSES.router],
    });

    return res.status(200).json({
      ok: true,
      network: "bsc-mainnet",
      mission: {
        id: mission.id,
        status: mission.status,
      },
      agent: {
        agent_id: agent.agent_id,
        name: agent.name,
        provider,
        status: agent.status,
        verification_status: agent.verification_status,
      },
      commerce: {
        address: ERC8183_ADDRESSES.commerce,
        evaluator: ERC8183_ADDRESSES.router,
        hook: ERC8183_ADDRESSES.router,
        default_policy: ERC8183_ADDRESSES.policy,
      },
      payment: {
        token: paymentToken,
        symbol: tokenSymbol,
        decimals: tokenDecimals,
        budget_raw: budget.toString(),
      },
      expiry: expiry.toString(),
      wallet_steps: [
        "createJob",
        "registerJob",
        "setBudget",
        "approve payment token",
        "fund",
      ],
      transactions: {
        createJob: {
          to: ERC8183_ADDRESSES.commerce,
          value: "0x0",
          data: createJobData,
        },
        registerJob: {
          to: ERC8183_ADDRESSES.router,
          value: "0x0",
          data_builder: "encode registerJob(jobId, policy) after createJob receipt",
          policy: ERC8183_ADDRESSES.policy,
        },
        setBudget: {
          to: ERC8183_ADDRESSES.commerce,
          value: "0x0",
          data_builder: `encode setBudget(jobId, ${budget.toString()}, ${emptyBytes}) after createJob receipt`,
        },
        approve: {
          to: paymentToken,
          value: "0x0",
          data_builder: `encode approve(${ERC8183_ADDRESSES.commerce}, ${budget.toString()}) when allowance is insufficient`,
        },
        fund: {
          to: ERC8183_ADDRESSES.commerce,
          value: "0x0",
          data_builder: `encode fund(jobId, ${budget.toString()}, ${emptyBytes}) after budget + approval`,
        },
      },
      note: "This endpoint prepares the transaction plan only. The user's wallet must sign each transaction and the application should persist confirmed receipts before marking the mission funded.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare ERC-8183 mission";
    return res.status(400).json({ error: message });
  }
}
