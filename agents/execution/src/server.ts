import { createHmac } from "node:crypto";
import { BNB_TESTNET, createClient, signerFromPrivateKey } from "@altananetwork/sdk";
import type { Address, Hex } from "viem";
import { encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const PORT = Number(process.env.EXECUTION_PORT || 8788);
const AGENT = (process.env.EXECUTION_AGENT_KIND || "defi-agent").trim().toLowerCase();
const NETWORK = (process.env.NETWORK || "bsc-testnet").trim().toLowerCase();
const CHAIN_ID = 97;

const ERC20_ABI = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }] as const;
const PANCAKE_V3_ABI = [{
  type: "function",
  name: "exactInputSingle",
  stateMutability: "payable",
  inputs: [{
    name: "params",
    type: "tuple",
    components: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "recipient", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMinimum", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
  }],
  outputs: [{ name: "amountOut", type: "uint256" }],
}] as const;

function isAddress(value: string): value is Address { return /^0x[a-fA-F0-9]{40}$/.test(value); }
function isHex(value: string): value is Hex { return /^0x[a-fA-F0-9]*$/.test(value); }
function normalizePrivateKey(value: string): `0x${string}` {
  const raw = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error("ALTANA_SESSION_PRIVATE_KEY must be a 32-byte hex private key");
  return `0x${raw}`;
}
function addresses(name: string): Address[] {
  return (process.env[name] || "").split(",").map(v => v.trim()).filter(Boolean).map(v => {
    if (!isAddress(v)) throw new Error(`${name} contains an invalid address`);
    return v as Address;
  });
}
function selectors(name: string): Hex[] {
  return (process.env[name] || "").split(",").map(v => v.trim()).filter(Boolean).map(v => {
    if (!isHex(v) || v.length !== 10) throw new Error(`${name} contains an invalid selector`);
    return v as Hex;
  });
}
function deriveJobSessionPrivateKey(jobId: number): `0x${string}` {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new Error("jobId must be a positive integer");
  const master = normalizePrivateKey(process.env.ALTANA_SESSION_PRIVATE_KEY || "");
  return `0x${createHmac("sha256", master.slice(2)).update(`${AGENT}-job-session:${jobId}`).digest("hex")}`;
}
function descriptor(jobId: number, walletAddress: string) {
  if (!isAddress(walletAddress)) throw new Error("walletAddress must be a valid EVM address");
  const sessionPrivateKey = deriveJobSessionPrivateKey(jobId);
  const account = privateKeyToAccount(sessionPrivateKey);
  const sessionAddress = account.address;
  const sessionPublicKey = account.publicKey as Hex;
  const declaredAddress = (process.env.ALTANA_SESSION_ADDRESS || "").trim();
  if (declaredAddress && sessionAddress.toLowerCase() !== declaredAddress.toLowerCase()) throw new Error("Derived session address does not match ALTANA_SESSION_ADDRESS");
  const declaredPublicKey = (process.env.ALTANA_SESSION_PUBLIC_KEY || "").trim();
  if (declaredPublicKey && sessionPublicKey.toLowerCase() !== declaredPublicKey.toLowerCase()) throw new Error("Derived session public key does not match ALTANA_SESSION_PUBLIC_KEY");
  const expiry = Number(process.env.ALTANA_SESSION_EXPIRY || 0);
  if (!Number.isSafeInteger(expiry) || expiry <= Math.floor(Date.now() / 1000)) throw new Error("ALTANA_SESSION_EXPIRY is missing or expired");
  const spendToken = (process.env.ALTANA_SESSION_SPEND_TOKEN || "").trim();
  if (!isAddress(spendToken)) throw new Error("ALTANA_SESSION_SPEND_TOKEN must be configured");
  const spendLimit = BigInt(process.env.ALTANA_SESSION_SPEND_LIMIT || "0");
  if (spendLimit <= 0n) throw new Error("ALTANA_SESSION_SPEND_LIMIT must be positive");
  const nativeSpendLimit = BigInt(process.env.ALTANA_SESSION_NATIVE_SPEND_LIMIT || "0");
  if (nativeSpendLimit <= 0n) throw new Error("ALTANA_SESSION_NATIVE_SPEND_LIMIT must be positive");
  const allowedCalls = addresses("ALTANA_ALLOWED_TARGETS");
  const allowedSelectors = selectors("ALTANA_ALLOWED_SELECTORS");
  if (allowedCalls.length === 0 || allowedSelectors.length === 0) throw new Error("Altana target and selector allowlists are required");
  return { walletAddress: walletAddress as Address, sessionAddress, sessionPublicKey, sessionPrivateKey, expiry, spendToken: spendToken as Address, spendLimit, nativeSpendLimit, allowedCalls, allowedSelectors };
}
function assertAllowed(to: Address, data: Hex, d: ReturnType<typeof descriptor>) {
  if (!d.allowedCalls.some(v => v.toLowerCase() === to.toLowerCase())) throw new Error(`Execution target ${to} is not allowlisted`);
  if (!d.allowedSelectors.some(v => data.slice(0, 10).toLowerCase() === v.toLowerCase())) throw new Error(`Execution selector ${data.slice(0, 10)} is not allowlisted`);
}
function buildSwapCalls(body: Record<string, unknown>, d: ReturnType<typeof descriptor>) {
  const tokenIn = String(body.tokenIn || "");
  const tokenOut = String(body.tokenOut || "");
  const router = String(process.env.ALTANA_SWAP_ROUTER || "");
  const fee = Number(body.fee ?? process.env.ALTANA_SWAP_FEE ?? 2500);
  const amountIn = BigInt(String(body.amountIn || "0"));
  const amountOutMinimum = BigInt(String(body.amountOutMinimum || "0"));
  const recipient = String(body.recipient || d.walletAddress);
  if (!isAddress(tokenIn) || !isAddress(tokenOut) || !isAddress(router) || !isAddress(recipient)) throw new Error("Swap addresses are invalid");
  if (!Number.isInteger(fee) || fee < 0 || fee > 0xffffff) throw new Error("Swap fee is invalid");
  if (amountIn <= 0n) throw new Error("amountIn must be positive");
  if (recipient.toLowerCase() !== d.walletAddress.toLowerCase()) throw new Error("recipient must equal the authorized wallet");
  if (amountIn > d.spendLimit) throw new Error("amountIn exceeds the Altana spend cap");
  const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [router as Address, amountIn] });
  const swapData = encodeFunctionData({ abi: PANCAKE_V3_ABI, functionName: "exactInputSingle", args: [{ tokenIn: tokenIn as Address, tokenOut: tokenOut as Address, fee, recipient: recipient as Address, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n }] });
  const calls = [{ to: tokenIn as Address, data: approveData }, { to: router as Address, data: swapData }];
  calls.forEach(c => assertAllowed(c.to, c.data, d));
  return calls;
}
async function executeSwap(body: Record<string, unknown>) {
  if (NETWORK !== "bsc-testnet") throw new Error("Execution is restricted to BSC Testnet");
  const jobId = Number(body.jobId);
  const walletAddress = String(body.walletAddress || "");
  if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new Error("jobId is required");
  const d = descriptor(jobId, walletAddress);
  const calls = buildSwapCalls(body, d);
  const session = {
    walletAddress: d.walletAddress,
    signer: signerFromPrivateKey(d.sessionPrivateKey),
    publicKey: d.sessionPublicKey,
    permissions: { calls: d.allowedCalls.map(to => ({ to })), spend: [{ limit: d.spendLimit, period: "day" as const, token: d.spendToken }, { limit: d.nativeSpendLimit, period: "day" as const }] },
    expiry: d.expiry,
  };
  const client = createClient({ chains: [BNB_TESTNET] });
  const result = await client.execute({ session, calls, chainId: CHAIN_ID });
  if (result.status === "FAILED") throw new Error(`Altana execute failed for ${result.callsId}`);
  return { agent: AGENT, network: NETWORK, chain_id: CHAIN_ID, calls_id: result.callsId, transaction_hash: result.transactionHash ?? null, status: result.status, action: "swap" };
}
async function preflight(body: Record<string, unknown>) {
  const jobId = Number(body.jobId);
  const walletAddress = String(body.walletAddress || "");
  const d = descriptor(jobId, walletAddress);
  const calls = buildSwapCalls(body, d);
  return { broadcast: false, agent: AGENT, network: NETWORK, chain_id: CHAIN_ID, job_id: jobId, targets: calls.map(c => c.to), selectors: calls.map(c => c.data.slice(0, 10)), recipient: walletAddress };
}
function response(res: any, status: number, body: unknown) { const raw = JSON.stringify(body); res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(raw) }); res.end(raw); }
const server = await import("node:http").then(({ createServer }) => createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
    if (req.method === "GET" && url.pathname === "/health") return response(res, 200, { status: "ok", agent: AGENT, network: NETWORK, chain_id: CHAIN_ID });
    if (req.method === "GET" && url.pathname === "/execution-capabilities") return response(res, 200, { execution: "altana-scoped-session", wallet_provider: "altana", authorization_model: "scoped_session", protocol: "pancake-v3-swap", chain_id: CHAIN_ID, network: NETWORK, allowed_targets: addresses("ALTANA_ALLOWED_TARGETS"), allowed_selectors: selectors("ALTANA_ALLOWED_SELECTORS"), private_key_exposed: false });
    if ((req.method === "POST" && (url.pathname === "/preflight" || url.pathname === "/execute-swap"))) {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body !== "object") throw new Error("Request body must be an object");
      const result = url.pathname === "/preflight" ? await preflight(body) : await executeSwap(body);
      return response(res, 200, result);
    }
    return response(res, 404, { error: "not_found" });
  } catch (error) { return response(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
}));
server.listen(PORT, "127.0.0.1", () => console.log(`${AGENT} Altana execution listening on 127.0.0.1:${PORT}`));
