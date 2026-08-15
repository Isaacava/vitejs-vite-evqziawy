import type { PreparedTransaction } from "./onchainExecutor";

export type Erc8183PreparedResponse = {
  network: string;
  chain_id: number;
  transactions: Record<string, { to?: string; data?: string; value?: string; data_builder?: string }>;
  payment: { token: string; budget_raw: string; allowance_raw: string };
};

export type Erc8183PlanStep = {
  id: "create" | "register" | "set_budget" | "approve" | "fund";
  label: string;
  description: string;
  transaction: PreparedTransaction | null;
};

function toPrepared(tx?: { to?: string; data?: string; value?: string }): PreparedTransaction | null {
  if (!tx?.to || !tx?.data) return null;
  return { to: tx.to, data: tx.data, ...(tx.value ? { value: tx.value } : {}) };
}

export function buildErc8183Plan(data: Erc8183PreparedResponse, chainJobId?: string): Erc8183PlanStep[] {
  const register = data.transactions.register_job;
  const setBudget = data.transactions.set_budget;
  const fund = data.transactions.fund;

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
      description: chainJobId ? `Register confirmed job ${chainJobId}.` : "Waiting for the createJob receipt before this transaction can be encoded.",
      transaction: chainJobId ? toPrepared(register) : null,
    },
    {
      id: "set_budget",
      label: "setBudget",
      description: chainJobId ? `Attach budget ${data.payment.budget_raw} to job ${chainJobId}.` : "Waiting for the confirmed jobId.",
      transaction: chainJobId ? toPrepared(setBudget) : null,
    },
    {
      id: "approve",
      label: "approve",
      description: BigInt(data.payment.allowance_raw) >= BigInt(data.payment.budget_raw) ? "Existing allowance is sufficient; no approval transaction is required." : "Approve the Commerce contract to spend the mission payment token.",
      transaction: BigInt(data.payment.allowance_raw) >= BigInt(data.payment.budget_raw) ? null : toPrepared(data.transactions.approve),
    },
    {
      id: "fund",
      label: "fund",
      description: chainJobId ? `Move the approved budget into the escrow for job ${chainJobId}.` : "Waiting for the confirmed jobId.",
      transaction: chainJobId ? toPrepared(fund) : null,
    },
  ];
}
