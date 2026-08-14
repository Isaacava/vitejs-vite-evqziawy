import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";

export const ERC8183_TESTNET = {
  commerce: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address,
  router: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address,
  policy: "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6" as Address,
} as const;

export const bscTestnetClient = createPublicClient({
  chain: bscTestnet,
  transport: http(),
});

export const ERC20_READ_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export const COMMERCE_READ_ABI = [
  {
    type: "function",
    name: "paymentToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;
