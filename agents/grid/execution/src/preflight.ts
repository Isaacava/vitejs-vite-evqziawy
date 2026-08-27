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
  if (!tokenInBalanceOk) throw new Error(`tokenIn balance ${tokenInBalance.toString()} is below amountIn ${amountIn.toString()}`);
  if (!tokenInAllowanceOk) throw new Error(`tokenIn allowance ${tokenInAllowance.toString()} is below amountIn ${amountIn.toString()}`);

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
    },
    broadcast: false,
    note: "Read-only BSC Testnet preflight. No transaction is broadcast by this endpoint.",
  };
}
