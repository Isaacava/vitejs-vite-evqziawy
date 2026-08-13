import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbi,
  type Address,
  type EIP1193Provider,
} from "viem";
import { bscTestnet } from "viem/chains";

/**
 * Official BNB Agentic Commerce contracts
 * on BSC Testnet.
 *
 * Source:
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

export const COMMERCE_ABI = parseAbi([
  "function createJob(address provider,address evaluator,uint256 expiredAt,string description,address hook) returns (uint256 jobId)",
  "function registerJob(uint256 jobId,address policy)",
  "function setBudget(uint256 jobId,uint256 amount)",
  "function fund(uint256 jobId)",
  "function getJob(uint256 jobId) view returns (tuple(uint256 id,address client,address provider,address evaluator,string description,uint256 budget,uint256 expiredAt,uint8 status,address hook,uint256 submittedAt,bytes32 deliverable))",
  "function paymentToken() view returns (address)",
]);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const publicClient =
  createPublicClient({
    chain: bscTestnet,
    transport: http(),
  });

export function getWalletClient(
  provider: EIP1193Provider,
  account: Address,
) {
  return createWalletClient({
    account,
    chain: bscTestnet,
    transport: custom(provider),
  });
}
