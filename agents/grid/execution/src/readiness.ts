import { createPublicClient, http, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

const ALTANA_KEYSTORE_ADDRESS = "0x6b8361C29d05D498b1a12B54A37310f94171E94A" as const;
const KEYSTORE_ABI = [{
  type: "function",
  name: "isValidKey",
  stateMutability: "view",
  inputs: [
    { name: "wallet", type: "address" },
    { name: "keyId", type: "bytes32" },
  ],
  outputs: [{ name: "valid", type: "bool" }],
}] as const;

function configuredList(name: string) {
  return (process.env[name] || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function normalizedPrivateKey() {
  const raw = (process.env.ALTANA_SESSION_PRIVATE_KEY || "").trim();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

export async function getExecutionReadiness() {
  const privateKey = normalizedPrivateKey();
  const walletAddress = (process.env.ALTANA_WALLET_ADDRESS || "").trim();
  const router = process.env.PANCAKE_TESTNET_ROUTER || "";
  const checks = {
    chain_id: false,
    rpc: false,
    session_private_key: Boolean(privateKey),
    altana_wallet_address: isAddress(walletAddress),
    altana_session_expiry: Boolean(process.env.ALTANA_SESSION_EXPIRY),
    keystore_authorization: false,
    allowed_targets: configuredList("GRID_ALLOWED_TARGETS").length > 0,
    allowed_selectors: configuredList("GRID_ALLOWED_SELECTORS").length > 0,
    pancake_router: false,
  };

  const reasons: string[] = [];
  let sessionKeyId: string | null = null;
  let sessionKeyAddress: string | null = null;

  try {
    const chainId = await publicClient.getChainId();
    checks.chain_id = chainId === 97;
    checks.rpc = true;
    if (chainId !== 97) reasons.push(`RPC reported chain ${chainId}, expected BSC Testnet chain 97`);

    if (!/^0x[a-fA-F0-9]{40}$/.test(router)) {
      reasons.push("PANCAKE_TESTNET_ROUTER is missing or invalid");
    } else {
      const bytecode = await publicClient.getBytecode({ address: router as `0x${string}` });
      checks.pancake_router = Boolean(bytecode && bytecode !== "0x");
      if (!checks.pancake_router) reasons.push("Configured PancakeSwap Testnet router has no deployed bytecode");
    }

    if (privateKey) {
      const account = privateKeyToAccount(privateKey as `0x${string}`);
      sessionKeyAddress = account.address;
      sessionKeyId = keccak256(account.publicKey);
    }

    if (!checks.altana_wallet_address) {
      reasons.push("ALTANA_WALLET_ADDRESS is missing or invalid");
    } else if (!sessionKeyId) {
      reasons.push("ALTANA_SESSION_PRIVATE_KEY is required to derive the session key ID");
    } else {
      checks.keystore_authorization = await publicClient.readContract({
        address: ALTANA_KEYSTORE_ADDRESS,
        abi: KEYSTORE_ABI,
        functionName: "isValidKey",
        args: [walletAddress as `0x${string}`, sessionKeyId as `0x${string}`],
      });
      if (!checks.keystore_authorization) {
        reasons.push("Altana KeyStore does not currently report Grid's session key as authorized for this execution wallet");
      }
    }
  } catch (error) {
    reasons.push(error instanceof Error ? `BSC Testnet authorization check failed: ${error.message}` : "BSC Testnet authorization check failed");
  }

  if (!checks.session_private_key) reasons.push("ALTANA_SESSION_PRIVATE_KEY is not configured");
  if (!checks.altana_session_expiry) reasons.push("ALTANA_SESSION_EXPIRY is not configured");
  if (!checks.allowed_targets) reasons.push("GRID_ALLOWED_TARGETS is not configured");
  if (!checks.allowed_selectors) reasons.push("GRID_ALLOWED_SELECTORS is not configured");

  return {
    ready: reasons.length === 0,
    chainId: 97,
    router: router || null,
    keyStore: ALTANA_KEYSTORE_ADDRESS,
    walletAddress: walletAddress || null,
    sessionKeyAddress,
    sessionKeyId,
    checks,
    reasons,
  };
}
