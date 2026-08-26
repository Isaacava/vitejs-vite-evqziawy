import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(
    process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com",
  ),
});

function configuredList(name: string) {
  return (process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function getExecutionReadiness() {
  const checks = {
    chain_id: false,
    rpc: false,
    session_private_key: Boolean(process.env.ALTANA_SESSION_PRIVATE_KEY),
    shared_secret: Boolean(process.env.GRID_EXECUTION_SHARED_SECRET),
    allowed_targets: configuredList("GRID_ALLOWED_TARGETS").length > 0,
    allowed_selectors: configuredList("GRID_ALLOWED_SELECTORS").length > 0,
    pancake_router: false,
  };

  const reasons: string[] = [];
  const router = process.env.PANCAKE_TESTNET_ROUTER || "";

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
  } catch (error) {
    reasons.push(error instanceof Error ? `BSC Testnet RPC check failed: ${error.message}` : "BSC Testnet RPC check failed");
  }

  if (!checks.session_private_key) reasons.push("ALTANA_SESSION_PRIVATE_KEY is not configured");
  if (!checks.shared_secret) reasons.push("GRID_EXECUTION_SHARED_SECRET is not configured");
  if (!checks.allowed_targets) reasons.push("GRID_ALLOWED_TARGETS is not configured");
  if (!checks.allowed_selectors) reasons.push("GRID_ALLOWED_SELECTORS is not configured");

  return {
    ready: reasons.length === 0,
    chainId: 97,
    router: router || null,
    checks,
    reasons,
  };
}
