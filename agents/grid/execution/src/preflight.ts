import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { buildPancakeExactInputSingle, buildPancakeTestnetConfig, type PancakeExactInputSingleParams } from "./pancakeSwap.js";

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

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

export async function pancakeSwapPreflight(input: Record<string, unknown>) {
  const config = buildPancakeTestnetConfig();
  const router = address(input.router ?? config.router, "router");
  const tokenIn = address(input.tokenIn, "tokenIn");
  const tokenOut = address(input.tokenOut, "tokenOut");
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

  // Simulate the exact calldata with the execution wallet as msg.sender.
  // This is still read-only: no transaction is broadcast. It catches pool/
  // liquidity/router reverts before the actual Altana execution is requested,
  // replacing opaque downstream "0x" failures with the real revert reason.
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
    call,
    checks: {
      token_in_balance: tokenInBalance.toString(),
      token_in_allowance: tokenInAllowance.toString(),
      token_in_balance_ok: tokenInBalanceOk,
      token_in_allowance_ok: tokenInAllowanceOk,
      simulation_ok: true,
    },
    simulation_return_data: simulationData,
    broadcast: false,
    note: "Read-only BSC Testnet preflight. Balance, allowance and exact swap calldata are simulated; no transaction is broadcast by this endpoint.",
  };
}
