import { encodeFunctionData, type Address, type Hex } from "viem";
import type { GridCall } from "./types.js";

const SMART_ROUTER_V3_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
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
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function address(value: string, field: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${field} must be a valid EVM address`);
  return value as Address;
}

function positive(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${field} must be a non-negative integer raw amount`);
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error(`${field} must be greater than zero`);
  return parsed;
}

export type PancakeExactInputSingleParams = {
  router: Address;
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  recipient: Address;
  amountIn: bigint;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96?: bigint;
  nativeValue?: bigint;
};

export function buildPancakeApproval(
  token: string,
  router: string,
  amount: string,
): GridCall {
  const tokenAddress = address(token, "token");
  const routerAddress = address(router, "router");
  const rawAmount = positive(amount, "amount");
  return {
    to: tokenAddress,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [routerAddress, rawAmount],
    }),
  };
}

export function buildPancakeExactInputSingle(params: PancakeExactInputSingleParams): GridCall {
  if (!Number.isInteger(params.fee) || params.fee < 0 || params.fee > 1_000_000) {
    throw new Error("PancakeSwap fee must be an integer between 0 and 1000000");
  }
  if (params.amountIn <= 0n) throw new Error("amountIn must be greater than zero");
  if (params.amountOutMinimum < 0n) throw new Error("amountOutMinimum cannot be negative");
  if (params.sqrtPriceLimitX96 !== undefined && (params.sqrtPriceLimitX96 < 0n || params.sqrtPriceLimitX96 >= 2n ** 160n)) {
    throw new Error("sqrtPriceLimitX96 must fit uint160");
  }
  if (params.nativeValue !== undefined && params.nativeValue < 0n) throw new Error("nativeValue cannot be negative");

  const router = address(params.router, "router");
  const tokenIn = address(params.tokenIn, "tokenIn");
  const tokenOut = address(params.tokenOut, "tokenOut");
  const recipient = address(params.recipient, "recipient");

  const data = encodeFunctionData({
    abi: SMART_ROUTER_V3_ABI,
    functionName: "exactInputSingle",
    args: [{
      tokenIn,
      tokenOut,
      fee: params.fee,
      recipient,
      amountIn: params.amountIn,
      amountOutMinimum: params.amountOutMinimum,
      sqrtPriceLimitX96: params.sqrtPriceLimitX96 ?? 0n,
    }],
  });

  return {
    to: router,
    data,
    ...(params.nativeValue === undefined ? {} : { value: params.nativeValue }),
  };
}

export function buildPancakeTestnetConfig(env: NodeJS.ProcessEnv = process.env) {
  const rawRouter = env.PANCAKE_TESTNET_ROUTER?.trim() || "";
  if (!rawRouter) throw new Error("PANCAKE_TESTNET_ROUTER must be configured for the Grid Testnet executor");
  const router = address(rawRouter, "PANCAKE_TESTNET_ROUTER");
  const fee = Number(env.PANCAKE_TESTNET_POOL_FEE || "500");
  if (!Number.isInteger(fee) || fee < 0 || fee > 1_000_000) throw new Error("PANCAKE_TESTNET_POOL_FEE is invalid");

  return {
    chainId: 97 as const,
    router,
    fee,
    note: "BSC Testnet only. Router and pool fee come from the isolated Grid executor configuration; token addresses and execution amounts must be supplied explicitly.",
  };
}

export function selectorFor(call: GridCall): Hex {
  return call.data.slice(0, 10) as Hex;
}
