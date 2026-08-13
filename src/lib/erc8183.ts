import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type EIP1193Provider,
} from "viem";
import { bscTestnet } from "viem/chains";

export const ERC8183_ADDRESSES = {
  commerce:
    "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address,

  router:
    "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address,

  policy:
    "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea" as Address,

  paymentToken:
    "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as Address,
} as const;

/*
 * Keep these as plain ABI objects.
 * This avoids parseAbi running during module startup.
 */
export const COMMERCE_ABI = [
  {
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "provider",
        type: "address",
      },
      {
        name: "evaluator",
        type: "address",
      },
      {
        name: "expiredAt",
        type: "uint256",
      },
      {
        name: "description",
        type: "string",
      },
      {
        name: "hook",
        type: "address",
      },
    ],
    outputs: [
      {
        name: "jobId",
        type: "uint256",
      },
    ],
  },
  {
    type: "function",
    name: "paymentToken",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "address",
      },
    ],
  },
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [
      {
        name: "jobId",
        type: "uint256",
      },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          {
            name: "id",
            type: "uint256",
          },
          {
            name: "client",
            type: "address",
          },
          {
            name: "provider",
            type: "address",
          },
          {
            name: "evaluator",
            type: "address",
          },
          {
            name: "description",
            type: "string",
          },
          {
            name: "budget",
            type: "uint256",
          },
          {
            name: "expiredAt",
            type: "uint256",
          },
          {
            name: "status",
            type: "uint8",
          },
          {
            name: "hook",
            type: "address",
          },
          {
            name: "submittedAt",
            type: "uint256",
          },
          {
            name: "deliverable",
            type: "bytes32",
          },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "jobCounter",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "uint256",
      },
    ],
  },
  {
    type: "function",
    name: "registerJob",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "jobId",
        type: "uint256",
      },
      {
        name: "policy",
        type: "address",
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setBudget",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "jobId",
        type: "uint256",
      },
      {
        name: "amount",
        type: "uint256",
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "jobId",
        type: "uint256",
      },
    ],
    outputs: [],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      {
        name: "account",
        type: "address",
      },
    ],
    outputs: [
      {
        type: "uint256",
      },
    ],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      {
        name: "owner",
        type: "address",
      },
      {
        name: "spender",
        type: "address",
      },
    ],
    outputs: [
      {
        type: "uint256",
      },
    ],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "spender",
        type: "address",
      },
      {
        name: "amount",
        type: "uint256",
      },
    ],
    outputs: [
      {
        type: "bool",
      },
    ],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "uint8",
      },
    ],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "string",
      },
    ],
  },
] as const;

export const publicClient =
  createPublicClient({
    chain: bscTestnet,
    transport: http(),
  });

export function getWalletClient(
  provider: EIP1193Provider,
  account: Address
) {
  return createWalletClient({
    account,
    chain: bscTestnet,
    transport: custom(provider),
  });
}
