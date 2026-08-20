import { encodeFunctionData, type Address } from "viem";
import type { PreparedTransaction } from "./onchainExecutor";

export type Erc8183PreparedResponse = {
  network: string;
  chain_id: number;
  transactions: Record<string, { to?: string; data?: string; value?: string; data_builder?: string }>;
  payment: {
    token: string;
    budget_raw: string;
    allowance_raw: string;
    symbol: string;
    decimals?: number;
    balance_raw?: string;
    balance_formatted: string;
    allowance_formatted: string;
  };
};

export type Erc8183PlanStep = {
  id: "create" | "register" | "set_budget" | "approve" | "fund";
  label: string;
  description: string;
  transaction: PreparedTransaction | null;
};

const ROUTER_ABI = [{
  type: "function",
  name: "registerJob",
  stateMutability: "nonpayable",
  inputs: [
    { name: "jobId", type: "uint256" },
    { name: "policy", type: "address" },
  ],
  outputs: [],
}] as const;

const COMMERCE_ABI = [
  {
    type: "function",
    name: "setBudget",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "expectedBudget", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const ERC20_ABI = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bool" }],
}] as const;

function toPrepared(tx?: { to?: string; data?: string; value?: string }): PreparedTransaction | null {
  if (!tx?.to || !tx?.data) return null;
  return { to: tx.to, data: tx.data, ...(tx.value ? { value: tx.value } : {}) };
}

function isAddress(value?: string): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value || "");
}

function encodeJobTransactions(data: Erc8183PreparedResponse, chainJobId: string) {
  const jobId = BigInt(chainJobId);
  const commerce = data.transactions.set_budget?.to || data.transactions.fund?.to;
  const router = data.transactions.register_job?.to;
  const policy = data.transactions.register_job?.data_builder?.match(/policy[:=]\s*(0x[a-fA-F0-9]{40})/)?.[1];

  if (!isAddress(commerce) || !isAddress(router)) {
    throw new Error("ERC-8183 transaction targets are incomplete.");
  }

  // Fresh BSC Testnet APEX Policy deployed with the rotated Router.
  // The server-provided data_builder is authoritative; this fallback is only
  // for older prepared responses that omitted the policy text.
  const fallbackPolicy = "0xc4f85d602235e14a45fd1d9794c4092af762b1a6" as Address;
  const registerPolicy = isAddress(policy) ? policy : fallbackPolicy;

  return {
    register: {
      to: router,
      data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "registerJob", args: [jobId, registerPolicy] }),
    } satisfies PreparedTransaction,
    setBudget: {
      to: commerce,
      data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: "setBudget", args: [jobId, BigInt(data.payment.budget_raw), "0x"] }),
    } satisfies PreparedTransaction,
    fund: {
      to: commerce,
      data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: "fund", args: [jobId, BigInt(data.payment.budget_raw), "0x"] }),
    } satisfies PreparedTransaction,
  };
}

function encodeApproval(data: Erc8183PreparedResponse): PreparedTransaction | null {
  if (BigInt(data.payment.allowance_raw) >= BigInt(data.payment.budget_raw)) return null;
  const token = data.payment.token;
  const commerce = data.transactions.fund?.to;
  if (!isAddress(token) || !isAddress(commerce)) throw new Error("Payment token or Commerce address is invalid.");
  return {
    to: token,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [commerce, BigInt(data.payment.budget_raw)] }),
  };
}

export function buildErc8183Plan(data: Erc8183PreparedResponse, chainJobId?: string): Erc8183PlanStep[] {
  const encoded = chainJobId ? encodeJobTransactions(data, chainJobId) : null;
  const approval = encodeApproval(data);

  return [
    {
      id: "create",
      label: "createJob",
      description: "Create the escrow job. The confirmed receipt supplies the real ERC-8183 jobId.",
      transaction: toPrepared(data.transactions.create_job),
    },
    {
      id: "register",
      label: "registerJob",
      description: encoded ? `Register confirmed job ${chainJobId}.` : "Waiting for the createJob receipt before this transaction can be encoded.",
      transaction: encoded?.register || null,
    },
    {
      id: "set_budget",
      label: "setBudget",
      description: encoded ? `Attach budget ${data.payment.budget_raw} to job ${chainJobId}.` : "Waiting for the confirmed jobId.",
      transaction: encoded?.setBudget || null,
    },
    {
      id: "approve",
      label: "approve",
      description: approval ? "Approve Commerce to spend the mission payment token." : "Existing allowance is sufficient; no approval transaction is required.",
      transaction: approval,
    },
    {
      id: "fund",
      label: "fund",
      description: encoded ? `Move the approved budget into escrow for job ${chainJobId}.` : "Waiting for the confirmed jobId.",
      transaction: encoded?.fund || null,
    },
  ];
}
