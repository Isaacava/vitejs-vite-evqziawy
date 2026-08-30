import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { buildPancakeExactInputSingle, buildPancakeTestnetConfig, type PancakeExactInputSingleParams } from "./pancakeSwap.js";

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

const PANCAKE_V3_FACTORY: Address = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const STANDARD_V3_FEE_TIERS = [100, 500, 2500, 10000] as const;

const PANCAKE_V3_FACTORY_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

const PANCAKE_V3_POOL_ABI = [
  {
    type: "function",
    name: "liquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
] as const;

const ERC20_STATE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "remaining", type: "uint256" }],
  },
] as const;

function address(value: unknown, field: string): Address {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${field} must be a valid EVM address`);
  return value as Address;
}

function rawInteger(value: unknown, field: string, positive = false): bigint {
  const text = String(value ?? "");
  if (!/^\d+$/.test(text)) throw new Error(`${field} must be an integer raw amount`);
  const result = BigInt(text);
  if (positive && result <= 0n) throw new Error(`${field} must be greater than zero`);
  return result;
}

function describeSimulationError(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const shortMessage = typeof value.shortMessage === "string" ? value.shortMessage : "";
    const details = typeof value.details === "string" ? value.details : "";
    const reason = typeof value.reason === "string" ? value.reason : "";
    const message = typeof value.message === "string" ? value.message : "";
    const parts = [shortMessage, reason, details, message].filter(Boolean);
    if (parts.length > 0) return [...new Set(parts)].join(" — ");
  }
  if (error instanceof Error) return error.message;
  return String(error || "unknown simulation error");
}

async function discoverV3Pools(tokenIn: Address, tokenOut: Address) {
  return Promise.all(
    STANDARD_V3_FEE_TIERS.map(async (tier) => {
      const pool = await publicClient.readContract({
        address: PANCAKE_V3_FACTORY,
        abi: PANCAKE_V3_FACTORY_ABI,
        functionName: "getPool",
        args: [tokenIn, tokenOut, tier],
      });

      if (pool.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
        return { fee: tier, pool: null as Address | null, liquidity: null as bigint | null };
      }

      const liquidity = await publicClient.readContract({
        address: pool,
        abi: PANCAKE_V3_POOL_ABI,
        functionName: "liquidity",
      });

      return { fee: tier, pool, liquidity };
    }),
  );
}

export async function pancakeSwapPreflight(input: Record<string, unknown>) {
  const config = buildPancakeTestnetConfig();
  const router = address(input.router ?? config.router, "router");
  const tokenIn = address(input.tokenIn ?? config.tokenIn, "tokenIn");
  const tokenOut = address(input.tokenOut ?? config.tokenOut, "tokenOut");
  const recipient = address(input.recipient, "recipient");
  const fee = Number(input.fee ?? config.fee);
  const amountIn = rawInteger(input.amountIn, "amountIn", true);
  const amountOutMinimum = rawInteger(input.amountOutMinimum ?? "0", "amountOutMinimum");

  if (!Number.isInteger(fee) || fee < 0 || fee > 1_000_000) throw new Error("fee must be an integer between 0 and 1000000");

  const bytecode = await publicClient.getBytecode({ address: router });
  if (!bytecode || bytecode === "0x") throw new Error("Configured PancakeSwap Testnet router has no deployed bytecode");
  const tokenInCode = await publicClient.getBytecode({ address: tokenIn });
  const tokenOutCode = await publicClient.getBytecode({ address: tokenOut });
  if (!tokenInCode || tokenInCode === "0x") throw new Error("tokenIn has no deployed BSC Testnet bytecode");
  if (!tokenOutCode || tokenOutCode === "0x") throw new Error("tokenOut has no deployed BSC Testnet bytecode");

  const pools = await discoverV3Pools(tokenIn, tokenOut);
  const selectedPool = pools.find((item) => item.fee === fee);
  const existingPools = pools.filter((item) => item.pool !== null);

  if (!selectedPool || !selectedPool.pool) {
    if (existingPools.length === 0) {
      throw new Error(
        `No PancakeSwap V3 pool exists for ${tokenIn}/${tokenOut} on BSC Testnet at fee ${fee}. None of the standard V3 fee tiers (100, 500, 2500, 10000) has a deployed pool. The declared execution scope must use a pair/fee with a real V3 pool before a swap can be executed.`,
      );
    }

    const available = existingPools
      .map((item) => `${item.fee} (${item.pool}, liquidity ${item.liquidity?.toString() ?? "unknown"})`)
      .join("; ");
    throw new Error(
      `No PancakeSwap V3 pool exists for ${tokenIn}/${tokenOut} at the declared fee ${fee}. Available V3 pools: ${available}. The marketplace will not silently change the provider-declared fee scope.`,
    );
  }

  if (selectedPool.liquidity === null || selectedPool.liquidity === 0n) {
    throw new Error(
      `PancakeSwap V3 pool ${selectedPool.pool} exists for ${tokenIn}/${tokenOut} at fee ${fee}, but its active liquidity is zero. The swap cannot be simulated or executed until that pool has usable liquidity.`,
    );
  }

  const [tokenInBalance, tokenInAllowance] = await Promise.all([
    publicClient.readContract({
      address: tokenIn,
      abi: ERC20_STATE_ABI,
      functionName: "balanceOf",
      args: [recipient],
    }),
    publicClient.readContract({
      address: tokenIn,
      abi: ERC20_STATE_ABI,
      functionName: "allowance",
      args: [recipient, router],
    }),
  ]);

  const params: PancakeExactInputSingleParams = {
    router,
    tokenIn,
    tokenOut,
    fee,
    recipient,
    amountIn,
    amountOutMinimum,
  };
  const call = buildPancakeExactInputSingle(params);
  const tokenInBalanceOk = tokenInBalance >= amountIn;
  const tokenInAllowanceOk = tokenInAllowance >= amountIn;

  if (!tokenInBalanceOk) {
    throw new Error(`tokenIn balance ${tokenInBalance.toString()} is below amountIn ${amountIn.toString()}`);
  }
  if (!tokenInAllowanceOk) {
    throw new Error(`tokenIn allowance ${tokenInAllowance.toString()} is below amountIn ${amountIn.toString()}`);
  }

  let simulationData: string | null = null;
  try {
    const simulation = await publicClient.call({
      account: recipient,
      to: router,
      data: call.data,
      value: call.value ?? 0n,
    });
    simulationData = simulation.data ?? null;
  } catch (error) {
    throw new Error(`PancakeSwap exactInputSingle simulation reverted: ${describeSimulationError(error)}`);
  }

  return {
    chainId: 97,
    router,
    tokenIn,
    tokenOut,
    recipient,
    fee,
    amountIn: amountIn.toString(),
    amountOutMinimum: amountOutMinimum.toString(),
    selector: call.data.slice(0, 10),
    pool: selectedPool.pool,
    pool_liquidity: selectedPool.liquidity?.toString() ?? null,
    available_pools: existingPools.map((item) => ({
      fee: item.fee,
      pool: item.pool,
      liquidity: item.liquidity?.toString() ?? null,
    })),
    call,
    checks: {
      token_in_balance: tokenInBalance.toString(),
      token_in_allowance: tokenInAllowance.toString(),
      token_in_balance_ok: tokenInBalanceOk,
      token_in_allowance_ok: tokenInAllowanceOk,
      pool_exists: true,
      pool_liquidity_ok: true,
      simulation_ok: true,
    },
    simulation_return_data: simulationData,
    broadcast: false,
    note: `Read-only BSC Testnet preflight. The provider defaults to ${config.tokenInSymbol}/${config.tokenOutSymbol}; factory pool discovery, active pool liquidity, balance, allowance and exact swap calldata are checked before simulation.`,
  };
}
