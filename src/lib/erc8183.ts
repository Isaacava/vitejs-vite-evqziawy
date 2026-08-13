import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type EIP1193Provider,
} from "viem";
import { bscTestnet } from "viem/chains";

/*
 * Official BNB Agentic Commerce / ERC-8183
 * BSC Testnet deployment addresses.
 *
 * Source of truth:
 * bnb-chain/apex-contracts/scripts/addresses.ts
 */
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
 * AgenticCommerce ABI
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

  {
    type: "function",
    name: "paymentToken",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
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
        name: "",
        type: "uint256",
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
        name: "",
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
] as const;

/*
 * EvaluatorRouter ABI
 *
 * registerJob(jobId, policy) is called on
 * the Router, not AgenticCommerce.
 *
 * The official Router also exposes jobPolicy()
 * which we'll use to verify registration.
 */
export const ROUTER_ABI = [
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
    name: "jobPolicy",
    stateMutability: "view",
    inputs: [
      {
        name: "jobId",
        type: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "address",
      },
    ],
  },

  {
    type: "function",
    name: "policyWhitelist",
    stateMutability: "view",
    inputs: [
      {
        name: "policy",
        type: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
      },
    ],
  },

  {
    type: "function",
    name: "commerce",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
      },
    ],
  },
] as const;

/*
 * ERC-20 ABI
 */
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
        name: "",
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
        name: "",
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
        name: "",
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
        name: "",
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
        name: "",
        type: "string",
      },
    ],
  },
] as const;

/*
 * Public BSC Testnet client.
 */
export const publicClient =
  createPublicClient({
    chain: bscTestnet,
    transport: http(
      "https://data-seed-prebsc-1-s1.bnbchain.org:8545"
    ),
  });

/*
 * Wallet client helper.
 */
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
