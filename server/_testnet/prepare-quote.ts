import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, encodeFunctionData, formatUnits, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const ROUTER = "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address;
const POLICY = "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6" as Address;
const CHAIN_ID = 97;
const JOB_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

const COMMERCE_ABI = [
  { type: "function", name: "createJob", stateMutability: "nonpayable", inputs: [
    { name: "provider", type: "address" }, { name: "evaluator", type: "address" },
    { name: "expiredAt", type: "uint256" }, { name: "description", type: "string" }, { name: "hook", type: "address" },
  ], outputs: [{ name: "jobId", type: "uint256" }] },
  { type: "function", name: "paymentToken", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;
const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;
const ROUTER_ABI = [{ type: "function", name: "registerJob", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "policy", type: "address" }], outputs: [] }] as const;
const client = createPublicClient({ chain: bscTestnet, transport: http() });

function validAddress(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  try {
    const quoteId = typeof req.body?.quote_id === "string" ? req.body.quote_id.trim() : "";
    const clientAddress = req.body?.client_address;
    const missionId = typeof req.body?.mission_id === "string" ? req.body.mission_id.trim() : "";
    if (!quoteId || !missionId || !validAddress(clientAddress)) return res.status(400).json({ error: "quote_id, mission_id and client_address are required" });
    if (clientAddress.toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "client_address does not match the authenticated wallet" });

    const supabase = serverClient();
    const { data: mission, error: missionError } = await supabase.from("missions").select("id,user_id,goal,status").eq("id", missionId).eq("user_id", auth.user.id).maybeSingle();
    if (missionError) throw new Error(missionError.message);
    if (!mission) return res.status(404).json({ error: "Mission not found" });

    const { data: quote, error: quoteError } = await supabase.from("marketplace_quotes").select("quote_id,agent_id,requester_wallet,goal,request_metadata,price,currency,provider_quote,quote_hash,status,expires_at,chain_id,environment").eq("quote_id", quoteId).maybeSingle();
    if (quoteError) throw new Error(quoteError.message);
    if (!quote) return res.status(404).json({ error: "Quote not found" });
    if (quote.status !== "accepted") return res.status(409).json({ error: `Quote is ${quote.status}; accept it before preparing the job` });
    if (quote.chain_id !== CHAIN_ID || quote.environment !== "testnet") return res.status(409).json({ error: "Quote is not a BSC Testnet quote" });
    if (!quote.quote_hash) return res.status(409).json({ error: "Accepted quote is missing its integrity hash" });
    if (quote.requester_wallet.toLowerCase() !== clientAddress.toLowerCase()) return res.status(403).json({ error: "Quote belongs to another wallet" });
    if (new Date(quote.expires_at).getTime() <= Date.now()) return res.status(409).json({ error: "Accepted quote has expired" });

    const { data: task, error: taskError } = await supabase.from("mission_tasks").select("id,agent_id").eq("mission_id", missionId).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task?.agent_id || task.agent_id !== quote.agent_id) return res.status(409).json({ error: "Accepted quote does not match the mission's selected agent" });

    const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,owner,name,status,verification_status,chain").eq("id", task.agent_id).maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent || agent.chain !== "bsc-testnet" || !validAddress(agent.owner)) return res.status(409).json({ error: "Selected provider is not a valid Testnet agent" });
    if (agent.verification_status === "revoked") return res.status(409).json({ error: "Selected provider identity is revoked" });

    const endpoint = await supabase.from("agent_endpoints").select("status,last_checked_at").eq("agent_id", agent.id).order("last_checked_at", { ascending: false }).limit(1).maybeSingle();
    if (endpoint.error) throw new Error(endpoint.error.message);
    if (!endpoint.data || endpoint.data.status !== "online") return res.status(409).json({ error: "Provider is no longer healthy on Testnet" });

    const token = await client.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "paymentToken" });
    const [decimals, symbol, balance, allowance] = await Promise.all([
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [clientAddress] }),
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [clientAddress, COMMERCE] }),
    ]);

    const rawBudget = BigInt(String(quote.price));
    if (rawBudget <= 0n) return res.status(409).json({ error: "Accepted provider quote has a non-positive price" });
    if (BigInt(balance) < rawBudget) return res.status(409).json({ error: `Insufficient Testnet settlement-token balance. Required ${formatUnits(rawBudget, Number(decimals))} ${symbol}.`, required_raw: rawBudget.toString(), balance_raw: String(balance) });

    // ERC-8183 Testnet createJob rejects very short expiries. Keep the provider
    // quote expiry separate from the on-chain job lifetime and use a 30-day job.
    const expiryUnix = Math.floor(Date.now() / 1000) + JOB_LIFETIME_SECONDS;
    const description = JSON.stringify({ marketplace: "AgentMarket", network: "bsc-testnet", chain_id: CHAIN_ID, mission_id: missionId, quote_id: quote.quote_id, quote_hash: quote.quote_hash, price: formatUnits(rawBudget, Number(decimals)), price_raw: rawBudget.toString(), currency: quote.currency, goal: quote.goal, params: quote.request_metadata });
    const createJobData = encodeFunctionData({ abi: COMMERCE_ABI, functionName: "createJob", args: [agent.owner, ROUTER, BigInt(expiryUnix), description, ROUTER] });
    const registerTemplate = encodeFunctionData({ abi: ROUTER_ABI, functionName: "registerJob", args: [0n, POLICY] });

    return res.status(200).json({
      ok: true, network: "bsc-testnet", chain_id: CHAIN_ID, environment: "testnet",
      mission: { id: mission.id, status: mission.status, goal: mission.goal },
      quote: { quote_id: quote.quote_id, price_raw: rawBudget.toString(), price: formatUnits(rawBudget, Number(decimals)), currency: quote.currency, quote_hash: quote.quote_hash, expires_at: quote.expires_at, status: quote.status },
      agent: { agent_id: agent.agent_id, name: agent.name, provider: agent.owner, status: agent.status, verification_status: agent.verification_status },
      commerce: { address: COMMERCE, evaluator: ROUTER, hook: ROUTER, default_policy: POLICY },
      payment: { token, symbol, decimals: Number(decimals), budget_raw: rawBudget.toString(), balance_raw: String(balance), allowance_raw: String(allowance), balance_formatted: formatUnits(BigInt(balance), Number(decimals)), allowance_formatted: formatUnits(BigInt(allowance), Number(decimals)) },
      job_description: description,
      wallet_steps: ["createJob", "registerJob with confirmed jobId", "setBudget with confirmed jobId and quoted budget", "approve payment token if allowance is insufficient", "fund with the same quoted budget"],
      transactions: {
        create_job: { to: COMMERCE, data: createJobData },
        register_job: { to: ROUTER, data: registerTemplate, data_builder: "Replace placeholder jobId 0 with the confirmed createJob receipt jobId." },
        set_budget: { to: COMMERCE, data_builder: `encode setBudget(jobId, ${rawBudget.toString()}, 0x)` },
        approve: BigInt(allowance) < rawBudget ? { to: token, data_builder: `encode approve(${COMMERCE}, ${rawBudget.toString()})` } : { data_builder: "No approval transaction required; current allowance covers the accepted quote." },
        fund: { to: COMMERCE, data_builder: `encode fund(jobId, ${rawBudget.toString()}, 0x)` },
      },
      note: "This plan is quote-gated. The on-chain description, budget, and provider are derived from the accepted Testnet provider quote.",
    });
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to prepare the accepted Testnet quote" }); }
}
