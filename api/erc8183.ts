import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, encodeFunctionData, formatUnits, http, parseUnits, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../src/server/authHandlers.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const ROUTER = "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address;
const POLICY = "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6" as Address;
const COMMERCE_ABI = [{ type: "function", name: "createJob", stateMutability: "nonpayable", inputs: [{ name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "expiredAt", type: "uint256" }, { name: "description", type: "string" }, { name: "hook", type: "address" }], outputs: [{ name: "jobId", type: "uint256" }] }, { type: "function", name: "setBudget", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [] }, { type: "function", name: "fund", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "expectedBudget", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [] }] as const;
const ROUTER_ABI = [{ type: "function", name: "registerJob", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "policy", type: "address" }], outputs: [] }] as const;
const ERC20_ABI = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }, { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] }, { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }, { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }] as const;
const TOKEN_ABI = [{ type: "function", name: "paymentToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http() });

function readContract(args: Record<string, unknown>) {
  return (publicClient.readContract as unknown as (value: Record<string, unknown>) => Promise<any>)(args);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });
  try {
    const missionId = typeof req.body?.mission_id === "string" ? req.body.mission_id.trim() : "";
    const clientAddress = typeof req.body?.client_address === "string" ? req.body.client_address.trim() : "";
    const budget = typeof req.body?.budget === "string" ? req.body.budget.trim() : String(req.body?.budget ?? "");
    if (!missionId || !/^0x[a-fA-F0-9]{40}$/.test(clientAddress) || !budget) return res.status(400).json({ error: "mission_id, authenticated client_address and budget are required" });
    if (clientAddress.toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "client_address must match the authenticated wallet" });
    const supabase = serverClient();
    const { data: mission, error: missionError } = await supabase.from("missions").select("id,goal,status,budget,user_id").eq("id", missionId).eq("user_id", auth.user.id).maybeSingle();
    if (missionError) throw new Error(missionError.message);
    if (!mission) return res.status(404).json({ error: "Mission not found" });
    const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,agent_id,budget").eq("mission_id", mission.id).limit(1).maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task?.agent_id) return res.status(409).json({ error: "Mission has no assigned provider" });
    const { data: agent, error: agentError } = await supabase.from("agents").select("agent_id,owner,name,verification_status,status").eq("id", task.agent_id).maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent?.owner || !/^0x[a-fA-F0-9]{40}$/.test(agent.owner)) return res.status(409).json({ error: "Selected provider has no valid wallet" });
    const token = await readContract({ address: COMMERCE, abi: TOKEN_ABI, functionName: "paymentToken" });
    const [decimals, symbol, balance, allowance] = await Promise.all([
      readContract({ address: token as Address, abi: ERC20_ABI, functionName: "decimals" }),
      readContract({ address: token as Address, abi: ERC20_ABI, functionName: "symbol" }),
      readContract({ address: token as Address, abi: ERC20_ABI, functionName: "balanceOf", args: [clientAddress as Address] }),
      readContract({ address: token as Address, abi: ERC20_ABI, functionName: "allowance", args: [clientAddress as Address, COMMERCE] }),
    ]);
    const rawBudget = parseUnits(budget, Number(decimals));
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 60 * 60);
    const createJobData = encodeFunctionData({ abi: COMMERCE_ABI, functionName: "createJob", args: [agent.owner as Address, ROUTER, expiresAt, mission.goal, ROUTER] });
    const registerTemplate = encodeFunctionData({ abi: ROUTER_ABI, functionName: "registerJob", args: [0n, POLICY] });
    const setBudgetTemplate = encodeFunctionData({ abi: COMMERCE_ABI, functionName: "setBudget", args: [0n, rawBudget, "0x"] });
    const fundTemplate = encodeFunctionData({ abi: COMMERCE_ABI, functionName: "fund", args: [0n, rawBudget, "0x"] });
    return res.status(200).json({
      ok: true,
      network: "bsc-testnet",
      chain_id: 97,
      mission: { id: mission.id, status: mission.status },
      agent: { agent_id: agent.agent_id, name: agent.name, provider: agent.owner, status: agent.status, verification_status: agent.verification_status },
      commerce: { address: COMMERCE, evaluator: ROUTER, hook: ROUTER, default_policy: POLICY },
      payment: { token, symbol, decimals, budget_raw: rawBudget.toString(), balance_raw: String(balance), allowance_raw: String(allowance), balance_formatted: formatUnits(BigInt(balance), Number(decimals)), allowance_formatted: formatUnits(BigInt(allowance), Number(decimals)) },
      expiry: new Date(Number(expiresAt) * 1000).toISOString(),
      wallet_steps: ["createJob", "registerJob using the returned jobId", "setBudget using the returned jobId", BigInt(allowance) < rawBudget ? "approve payment token to Commerce" : "approval already sufficient", "fund using the returned jobId"],
      transactions: {
        create_job: { to: COMMERCE, data: createJobData },
        register_job: { to: ROUTER, data: registerTemplate, data_builder: "Replace placeholder jobId 0 with the confirmed createJob receipt jobId." },
        set_budget: { to: COMMERCE, data: setBudgetTemplate, data_builder: "Replace placeholder jobId 0 with the confirmed createJob receipt jobId." },
        approve: BigInt(allowance) < rawBudget ? { to: token, data_builder: "Encode ERC-20 approve(Commerce, budgetRaw) in the user wallet." } : { data_builder: "No approval transaction required." },
        fund: { to: COMMERCE, data: fundTemplate, data_builder: "Replace placeholder jobId 0 with the confirmed createJob receipt jobId." },
      },
      note: "Preparation only. The browser wallet must sign each state-changing transaction; the server never receives a private key and does not mark the mission funded until chain confirmation is recorded.",
    });
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to prepare ERC-8183 job" }); }
}
