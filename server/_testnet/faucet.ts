import type { VercelRequest, VercelResponse } from "@vercel/node";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, fallback, formatUnits, http, parseEther, parseUnits, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const RPC_URLS = [
  "https://bsc-testnet-dataseed.bnbchain.org",
  "https://bsc-testnet.bnbchain.org",
  "https://bsc-testnet-rpc.publicnode.com",
] as const;
const U_TOKEN: Address = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565";
const CAKE2_TOKEN: Address = "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551";
const REQUIRED_TBNB = parseEther("0.02");
const REQUIRED_U = parseUnits("2", 18);
const REQUIRED_CAKE2 = parseUnits("5", 18);
const GAS_BUFFER = parseEther("0.0005");
const CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const rpcTransports = RPC_URLS.map((url) => http(url, { timeout: 7_000, retryCount: 1 }));
const rpcTransport = fallback(rpcTransports);
const publicClient = createPublicClient({ chain: bscTestnet, transport: rpcTransport });
const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "success", type: "bool" }] },
] as const;

function faucetKey(): Hex {
  const value = String(process.env.TESTNET_FAUCET_PRIVATE_KEY || "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error("TESTNET_FAUCET_PRIVATE_KEY is not configured as a 32-byte hex private key.");
  return value as Hex;
}
function isAddress(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
async function balances(address: Address) {
  const [tBNB, U, CAKE2] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: U_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
    publicClient.readContract({ address: CAKE2_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
  ]);
  return { tBNB, U, CAKE2 };
}
function fmt(value: bigint) { return formatUnits(value, 18); }

async function getStatus(wallet: Address) {
  const faucet = privateKeyToAccount(faucetKey());
  const [user, source] = await Promise.all([balances(wallet), balances(faucet.address)]);
  const missing = {
    tBNB: user.tBNB < REQUIRED_TBNB ? REQUIRED_TBNB - user.tBNB : 0n,
    U: user.U < REQUIRED_U ? REQUIRED_U - user.U : 0n,
    CAKE2: user.CAKE2 < REQUIRED_CAKE2 ? REQUIRED_CAKE2 - user.CAKE2 : 0n,
  };
  return {
    userWallet: wallet,
    user: { tBNB: fmt(user.tBNB), U: fmt(user.U), CAKE2: fmt(user.CAKE2) },
    required: { tBNB: "0.02", U: "2", CAKE2: "5" },
    missing: { tBNB: fmt(missing.tBNB), U: fmt(missing.U), CAKE2: fmt(missing.CAKE2) },
    ready: Object.values(missing).every((value) => value === 0n),
    faucet: {
      available: source.tBNB >= missing.tBNB + GAS_BUFFER && source.U >= missing.U && source.CAKE2 >= missing.CAKE2,
      tBNB: fmt(source.tBNB), U: fmt(source.U), CAKE2: fmt(source.CAKE2),
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "Method not allowed" }); }
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth || !isAddress(auth.user.wallet_address)) return res.status(401).json({ error: "Authenticated AgentMarket wallet required" });
    const wallet = auth.user.wallet_address as Address;
    const status = await getStatus(wallet);
    if (req.method === "GET") return res.status(200).json({ ok: true, ...status });
    if (status.ready) return res.status(200).json({ ok: true, claimed: false, alreadyReady: true, ...status });
    if (!status.faucet.available) return res.status(503).json({ ok: false, error: "The testnet faucet is temporarily low on one or more required assets. You can continue onboarding and fund the wallet later.", ...status });

    const supabase = serverClient();
    const since = new Date(Date.now() - CLAIM_COOLDOWN_MS).toISOString();
    const { data: recent } = await supabase.from("testnet_faucet_claims").select("id,claimed_at").eq("user_id", auth.user.id).gte("claimed_at", since).order("claimed_at", { ascending: false }).limit(1).maybeSingle();
    if (recent) return res.status(429).json({ ok: false, error: "This wallet has already claimed test funds recently. Try again after the cooldown.", retryAfter: new Date(new Date(recent.claimed_at).getTime() + CLAIM_COOLDOWN_MS).toISOString(), ...status });

    const account = privateKeyToAccount(faucetKey());
    const walletClient = createWalletClient({ account, chain: bscTestnet, transport: rpcTransport });
    const current = await balances(wallet);
    const needTBNB = current.tBNB < REQUIRED_TBNB ? REQUIRED_TBNB - current.tBNB : 0n;
    const needU = current.U < REQUIRED_U ? REQUIRED_U - current.U : 0n;
    const needCAKE = current.CAKE2 < REQUIRED_CAKE2 ? REQUIRED_CAKE2 - current.CAKE2 : 0n;
    const source = await balances(account.address);
    if (source.tBNB < needTBNB + GAS_BUFFER || source.U < needU || source.CAKE2 < needCAKE) return res.status(503).json({ ok: false, error: "The faucet balance changed while preparing the claim. Please try again later.", ...await getStatus(wallet) });

    const transactions: Array<{ asset: string; hash: Hex }> = [];
    if (needTBNB > 0n) { const hash = await walletClient.sendTransaction({ account, to: wallet, value: needTBNB }); await publicClient.waitForTransactionReceipt({ hash }); transactions.push({ asset: "tBNB", hash }); }
    if (needU > 0n) { const hash = await walletClient.writeContract({ account, address: U_TOKEN, abi: ERC20_ABI, functionName: "transfer", args: [wallet, needU] }); await publicClient.waitForTransactionReceipt({ hash }); transactions.push({ asset: "U", hash }); }
    if (needCAKE > 0n) { const hash = await walletClient.writeContract({ account, address: CAKE2_TOKEN, abi: ERC20_ABI, functionName: "transfer", args: [wallet, needCAKE] }); await publicClient.waitForTransactionReceipt({ hash }); transactions.push({ asset: "CAKE2", hash }); }

    const finalStatus = await getStatus(wallet);
    if (!finalStatus.ready) return res.status(502).json({ ok: false, error: "Faucet transactions completed, but the wallet has not reached all required testnet balances yet.", transactions, ...finalStatus });
    const { error } = await supabase.from("testnet_faucet_claims").insert({ user_id: auth.user.id, wallet_address: wallet, claimed_at: new Date().toISOString() });
    if (error) console.error("Testnet faucet claim ledger insert failed", error);
    return res.status(200).json({ ok: true, claimed: true, transactions, ...finalStatus });
  } catch (error) {
    console.error("Testnet faucet failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Testnet faucet failed" });
  }
}
