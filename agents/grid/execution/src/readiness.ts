import { createPublicClient, http, keccak256, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

const ALTANA_KEYSTORE_ADDRESS = "0x6b8361C29d05D498b1a12B54A37310f94171E94A" as const;
const TESTNET_CAKE2 = "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551" as const;
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
const ERC20_READ_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "remaining", type: "uint256" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;

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
  const router = (process.env.PANCAKE_TESTNET_ROUTER || "").trim();
  const configuredToken = (process.env.GRID_DEFAULT_TOKEN_IN || TESTNET_CAKE2).trim();
  const requiredAmountRaw = (process.env.GRID_TESTNET_EXECUTION_AMOUNT_RAW || "1000000000000000000").trim();
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
    execution_token: false,
    execution_amount: false,
    token_balance: false,
    token_allowance: false,
  };

  const reasons: string[] = [];
  let sessionKeyId: string | null = null;
  let sessionKeyAddress: string | null = null;
  let executionToken: Address | null = null;
  let executionTokenSymbol: string | null = null;
  let executionTokenDecimals: number | null = null;
  let requiredAmount: bigint | null = null;
  let tokenBalance: bigint | null = null;
  let tokenAllowance: bigint | null = null;

  if (!isAddress(configuredToken)) {
    reasons.push("GRID_DEFAULT_TOKEN_IN is missing or invalid");
  } else if (configuredToken.toLowerCase() !== TESTNET_CAKE2.toLowerCase()) {
    reasons.push(`Grid Testnet execution token must be canonical CAKE2 ${TESTNET_CAKE2}; configured token is ${configuredToken}`);
  } else {
    executionToken = configuredToken as Address;
    checks.execution_token = true;
  }

  if (!/^\d+$/.test(requiredAmountRaw) || BigInt(requiredAmountRaw) <= 0n) {
    reasons.push("GRID_TESTNET_EXECUTION_AMOUNT_RAW must be a positive raw token amount");
  } else {
    requiredAmount = BigInt(requiredAmountRaw);
    checks.execution_amount = true;
  }

  try {
    const chainId = await publicClient.getChainId();
    checks.chain_id = chainId === 97;
    checks.rpc = true;
    if (chainId !== 97) reasons.push(`RPC reported chain ${chainId}, expected BSC Testnet chain 97`);

    if (!isAddress(router)) {
      reasons.push("PANCAKE_TESTNET_ROUTER is missing or invalid");
    } else {
      const bytecode = await publicClient.getBytecode({ address: router as Address });
      checks.pancake_router = Boolean(bytecode && bytecode !== "0x");
      if (!checks.pancake_router) reasons.push("Configured PancakeSwap Testnet router has no deployed bytecode");
    }

    if (executionToken) {
      try {
        const [symbol, decimals] = await Promise.all([
          publicClient.readContract({ address: executionToken, abi: ERC20_READ_ABI, functionName: "symbol" }),
          publicClient.readContract({ address: executionToken, abi: ERC20_READ_ABI, functionName: "decimals" }),
        ]);
        executionTokenSymbol = String(symbol);
        executionTokenDecimals = Number(decimals);
        if (executionTokenSymbol !== "CAKE2") reasons.push(`Canonical CAKE2 contract reports symbol ${executionTokenSymbol}, not CAKE2`);
        if (executionTokenDecimals !== 18) reasons.push(`Canonical CAKE2 contract reports ${executionTokenDecimals} decimals, expected 18 for the controlled test amount`);
      } catch (error) {
        reasons.push(error instanceof Error ? `CAKE2 token metadata check failed: ${error.message}` : "CAKE2 token metadata check failed");
      }
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
        args: [walletAddress as Address, sessionKeyId as `0x${string}`],
      });
      if (!checks.keystore_authorization) {
        reasons.push("Altana KeyStore does not currently report Grid's session key as authorized for this execution wallet");
      }
    }

    if (executionToken && requiredAmount && isAddress(router) && checks.pancake_router && checks.execution_token && checks.execution_amount) {
      tokenBalance = await publicClient.readContract({
        address: executionToken,
        abi: ERC20_READ_ABI,
        functionName: "balanceOf",
        args: [walletAddress as Address],
      });
      tokenAllowance = await publicClient.readContract({
        address: executionToken,
        abi: ERC20_READ_ABI,
        functionName: "allowance",
        args: [walletAddress as Address, router as Address],
      });
      checks.token_balance = tokenBalance >= requiredAmount;
      checks.token_allowance = tokenAllowance >= requiredAmount;
      if (!checks.token_balance) reasons.push(`CAKE2 balance ${tokenBalance.toString()} is below required amount ${requiredAmount.toString()}`);
      if (!checks.token_allowance) reasons.push(`CAKE2 allowance ${tokenAllowance.toString()} for router ${router} is below required amount ${requiredAmount.toString()}`);
    }
  } catch (error) {
    reasons.push(error instanceof Error ? `BSC Testnet execution readiness check failed: ${error.message}` : "BSC Testnet execution readiness check failed");
  }

  if (!checks.session_private_key) reasons.push("ALTANA_SESSION_PRIVATE_KEY is not configured");
  if (!checks.altana_session_expiry) reasons.push("ALTANA_SESSION_EXPIRY is not configured");
  if (!checks.allowed_targets) reasons.push("GRID_ALLOWED_TARGETS is not configured");
  if (!checks.allowed_selectors) reasons.push("GRID_ALLOWED_SELECTORS is not configured");

  return {
    ready: reasons.length === 0,
    chainId: 97,
    router: router || null,
    executionToken,
    executionTokenSymbol,
    executionTokenDecimals,
    requiredAmountRaw: requiredAmount?.toString() ?? null,
    tokenBalanceRaw: tokenBalance?.toString() ?? null,
    tokenAllowanceRaw: tokenAllowance?.toString() ?? null,
    keyStore: ALTANA_KEYSTORE_ADDRESS,
    walletAddress: walletAddress || null,
    sessionKeyAddress,
    sessionKeyId,
    checks,
    reasons,
  };
}
