import type { Address } from "viem";
import { fundAltanaTradingCapital } from "./altanaWallet";
import { ensureAltanaTokenAllowance } from "./altanaAllowance";

export async function ensureAltanaTradingCapital(
  walletAddress: Address,
  tokenAddress: Address,
  rawAmount: bigint,
  approvalSpender?: Address,
  allowanceAmount?: bigint,
) {
  const funding = await fundAltanaTradingCapital(walletAddress, tokenAddress, rawAmount);

  let allowanceTxHash: `0x${string}` | undefined;
  if (approvalSpender && allowanceAmount && allowanceAmount > 0n) {
    const allowance = await ensureAltanaTokenAllowance(tokenAddress, approvalSpender, allowanceAmount);
    allowanceTxHash = allowance.transactionHash;
  }

  return {
    ...funding,
    allowanceTxHash,
  };
}
