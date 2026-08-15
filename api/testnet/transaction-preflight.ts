import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, formatUnits, http, parseUnits, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const CHAIN_ID = 97;
const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const ROUTER = "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address;
const POLICY = "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6" as Address;

const COMMERCE_ABI = [
  { type: "function", name: "paymentToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "jobCounter", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

const client = createPublicClient({ chain: bscTestnet, transport: http() });

function validAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function check(name: string, passed: boolean, detail: string) {
  return { name, passed, detail };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });

  const missionId = typeof req.body?.mission_id === "string" ? req.body.mission_id.trim() : "";
  const quoteId = typeof req.body?.quote_id === "string" ? req.body.quote_id.trim() : "";
  const clientAddress = req.body?.client_address;

  if (!missionId || !quoteId || !validAddress(clientAddress)) {
    return res.status(400).json({ error: "mission_id, quote_id and client_address are required" });
  }
  if (clientAddress.toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
    return res.status(403).json({ error: "client_address does not match the authenticated wallet" });
  }

  try {
    const supabase = serverClient();
    const checks: Array<{ name: string; passed: boolean; detail: string }> = [];

    const [commerceCode, routerCode, policyCode] = await Promise.all([
      client.getCode({ address: COMMERCE }),
      client.getCode({ address: ROUTER }),
      client.getCode({ address: POLICY }),
    ]);
    checks.push(check("BSC Testnet contracts", Boolean(commerceCode && commerceCode !== "0x") && Boolean(routerCode && routerCode !== "0x") && Boolean(policyCode && policyCode !== "0x"), "ERC-8183 Commerce, Router and Policy must have deployed bytecode on chain 97."));

    const { data: mission, error: missionError } = await supabase
      .from("missions")
      .select("id,user_id,status")
      .eq("id", missionId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (missionError) throw new Error(missionError.message);
    checks.push(check("Mission ownership", Boolean(mission), mission ? "Authenticated user owns the Testnet mission." : "Mission does not belong to the authenticated user."));

    const { data: quote, error: quoteError } = await supabase
      .from("marketplace_quotes")
      .select("quote_id,agent_id,requester_wallet,price,currency,quote_hash,status,expires_at,chain_id,environment")
      .eq("quote_id", quoteId)
      .maybeSingle();
    if (quoteError) throw new Error(quoteError.message);

    const quoteAccepted = Boolean(quote && quote.status === "accepted" && quote.chain_id === CHAIN_ID && quote.environment === "testnet" && quote.requester_wallet?.toLowerCase() === clientAddress.toLowerCase() && quote.quote_hash && new Date(quote.expires_at).getTime() > Date.now());
    checks.push(check("Accepted Testnet quote", quoteAccepted, quoteAccepted ? `Quote ${quoteId} is accepted, unexpired and anchored to the Testnet wallet.` : "Quote must be accepted, unexpired, chain 97, testnet, wallet-bound and hashed."));

    let agentReady = false;
    if (quote?.agent_id) {
      const { data: agent, error: agentError } = await supabase
        .from("agents")
        .select("id,agent_id,owner,status,verification_status,chain")
        .eq("id", quote.agent_id)
        .maybeSingle();
      if (agentError) throw new Error(agentError.message);

      const { data: endpoint, error: endpointError } = await supabase
        .from("agent_endpoints")
        .select("status,last_checked_at")
        .eq("agent_id", quote.agent_id)
        .order("last_checked_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (endpointError) throw new Error(endpointError.message);

      agentReady = Boolean(agent && agent.chain === "bsc-testnet" && agent.verification_status !== "revoked" && endpoint?.status === "online" && validAddress(agent.owner));
    }
    checks.push(check("Grid Agent ready", agentReady, agentReady ? "Selected provider is a verified BSC Testnet agent with an online endpoint." : "Selected provider must be a verified Testnet agent with a valid owner and current online endpoint."));

    const token = await client.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "paymentToken", authorizationList: [] });
    const [decimals, symbol, balance, allowance] = await Promise.all([
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals", authorizationList: [] }),
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol", authorizationList: [] }),
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [clientAddress], authorizationList: [] }),
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [clientAddress, COMMERCE], authorizationList: [] }),
    ]);

    const budgetRaw = quoteAccepted && quote?.price ? parseUnits(String(quote.price), Number(decimals)) : 0n;
    const hasBalance = budgetRaw > 0n && BigInt(balance) >= budgetRaw;
    const hasAllowance = budgetRaw > 0n && BigInt(allowance) >= budgetRaw;
    checks.push(check("Testnet payment balance", hasBalance, hasBalance ? `${formatUnits(BigInt(balance), Number(decimals))} ${symbol} available; enough for the accepted quote.` : `Need at least ${formatUnits(budgetRaw, Number(decimals))} ${symbol}; current balance is ${formatUnits(BigInt(balance), Number(decimals))} ${symbol}.`));
    checks.push(check("Payment allowance", hasAllowance, hasAllowance ? `Allowance covers the accepted ${symbol} budget.` : `Approval is required before funding; current allowance is ${formatUnits(BigInt(allowance), Number(decimals))} ${symbol}.`));

    const jobCounter = await client.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "jobCounter", authorizationList: [] });
    checks.push(check("ERC-8183 Commerce readable", jobCounter >= 0n, `Commerce contract is readable on Testnet; current job counter is ${jobCounter.toString()}.`));

    const ready = checks.every((item) => item.passed);
    return res.status(200).json({
      ok: true,
      ready,
      network: "bsc-testnet",
      chain_id: CHAIN_ID,
      environment: "testnet",
      wallet: clientAddress,
      quote: quote ? { quote_id: quote.quote_id, status: quote.status, price: String(quote.price), currency: quote.currency, quote_hash: quote.quote_hash, expires_at: quote.expires_at } : null,
      payment: { token, symbol, decimals: Number(decimals), balance_raw: String(balance), balance_formatted: formatUnits(BigInt(balance), Number(decimals)), allowance_raw: String(allowance), allowance_formatted: formatUnits(BigInt(allowance), Number(decimals)), required_raw: budgetRaw.toString(), required_formatted: formatUnits(budgetRaw, Number(decimals)) },
      checks,
      next: ready ? "Open the Testnet quote execution screen and begin the wallet transaction sequence." : "Fix the failed checks before attempting a Testnet transaction.",
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to run Testnet transaction preflight" });
  }
}
