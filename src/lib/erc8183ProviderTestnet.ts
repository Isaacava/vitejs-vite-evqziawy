import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";

export const PROVIDER_ERC8183_TESTNET = {
  chainId: 97,
  commerce: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address,
  router: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address,
  policy: "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6" as Address,
} as const;

export const PROVIDER_COMMERCE_ABI = [
  {
    type: "function",
    name: "jobCounter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [{ name: "job", type: "tuple", components: [
      { name: "id", type: "uint256" },
      { name: "client", type: "address" },
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "description", type: "string" },
      { name: "budget", type: "uint256" },
      { name: "expiredAt", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "hook", type: "address" },
      { name: "submittedAt", type: "uint256" },
      { name: "deliverable", type: "bytes32" },
    ] }],
  },
  {
    type: "function",
    name: "submit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "deliverable", type: "bytes32" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const providerPublicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(),
});
