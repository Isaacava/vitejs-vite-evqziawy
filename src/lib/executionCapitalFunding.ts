import type { Address } from "viem";
import { fundAltanaTradingCapital, ensureAltanaWallet, recoverAltanaWallet } from "./altanaWallet";
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
  let allowance = 0n;

  if (approvalSpender && allowanceAmount && allowanceAmount > 0n) {
    try {
      ensureAltanaWallet();
    } catch {
      await recoverAltanaWallet();
    }
    const approval = await ensureAltanaTokenAllowance(tokenAddress, approvalSpender, allowanceAmount);
    allowanceTxHash = approval.transactionHash;
    allowance = approval.allowance;
  }

  return {
    ...funding,
    allowance,
    allowanceTxHash,
  };
}
