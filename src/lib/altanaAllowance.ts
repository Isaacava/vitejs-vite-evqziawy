import { BNB_TESTNET, createClient } from "@altananetwork/sdk";
import { bscTestnet } from "viem/chains";
import { createPublicClient, encodeFunctionData, http, type Address } from "viem";
import { ensureAltanaWallet } from "./altanaWallet";

const chainId = 97 as const;
const ERC20_ALLOWANCE_ABI = [
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
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http(BNB_TESTNET.publicRpcUrl),
});

function isAddress(value: string): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export type AltanaAllowanceResult = {
  walletAddress: Address;
  token: Address;
  spender: Address;
  requestedAmount: bigint;
  allowance: bigint;
  transactionHash?: `0x${string}`;
  alreadyApproved: boolean;
};

/**
 * Ensure the user's own Altana execution wallet has an ERC-20 allowance for the
 * declared execution router. This is an admin-wallet operation, not an agent
 * session permission, so the agent session's contract allowlist never needs to
 * include the token contract itself.
 */
export async function ensureAltanaTokenAllowance(
  token: Address,
  spender: Address,
  requestedAmount: bigint,
): Promise<AltanaAllowanceResult> {
  if (!isAddress(token)) throw new Error("Execution token address is invalid.");
  if (!isAddress(spender)) throw new Error("Execution spender address is invalid.");
  if (requestedAmount <= 0n) throw new Error("Execution allowance amount must be greater than zero.");

  const resolved = ensureAltanaWallet();
  const currentAllowance = await publicClient.readContract({
    address: token,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "allowance",
    args: [resolved.walletAddress, spender],
  });

  if (currentAllowance >= requestedAmount) {
    return {
      walletAddress: resolved.walletAddress,
      token,
      spender,
      requestedAmount,
      allowance: currentAllowance,
      alreadyApproved: true,
    };
  }

  const client = createClient({ chains: [BNB_TESTNET] });
  const data = encodeFunctionData({
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "approve",
    args: [spender, requestedAmount],
  });

  const result = await client.execute({
    wallet: resolved.wallet,
    signer: resolved.signer,
    chainId,
    calls: {
      to: token,
      data,
      value: 0n,
    },
  });

  if (result.status === "FAILED") {
    throw new Error("Altana execution-wallet token approval failed.");
  }

  const finalAllowance = await publicClient.readContract({
    address: token,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "allowance",
    args: [resolved.walletAddress, spender],
  });

  if (finalAllowance < requestedAmount) {
    throw new Error("Token approval completed without producing the requested router allowance.");
  }

  return {
    walletAddress: resolved.walletAddress,
    token,
    spender,
    requestedAmount,
    allowance: finalAllowance,
    transactionHash: result.transactionHash,
    alreadyApproved: false,
  };
}
