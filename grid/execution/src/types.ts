import type { Address, Hex } from "viem";

export type GridCall = {
  to: Address;
  data: Hex;
  value?: bigint;
};

export type GridSessionDescriptor = {
  walletAddress: Address;
  agentSessionAddress: Address;
  agentSessionPublicKey: Hex;
  allowedCalls: readonly Address[];
  allowedSelectors?: readonly string[];
  /** Token spend cap, in raw token units. */
  spendLimit: bigint;
  spendToken?: Address;
  /** Native BNB gas-recovery spend cap, in wei. */
  nativeSpendLimit?: bigint;
  expiry: number;
};

export type RiskGuardianDecision = {
  approved: boolean;
  reasons: string[];
};

export type GridExecutionResult = {
  callsId: Hex;
  transactionHash: Hex | null;
  status: "PENDING" | "CONFIRMED" | "FAILED";
};
