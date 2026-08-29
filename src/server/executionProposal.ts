export type ExecutionProposal = {
  job_id: string;
  agent_id: string;
  agent_type: string;
  chain_id: number;
  wallet: string;
  action: string;
  summary: string;
  token?: string;
  protocol?: string;
  target?: string;
  selector?: string;
  notional?: number;
  spend_cap?: number;
  slippage_bps?: number;
  risk?: string;
  expires_at: string;
  parameters: Record<string, unknown>;
};

export function validateExecutionProposal(proposal: ExecutionProposal): string[] {
  const errors: string[] = [];
  if (!proposal.job_id.trim()) errors.push("job_id is required");
  if (!proposal.agent_id.trim()) errors.push("agent_id is required");
  if (!proposal.agent_type.trim()) errors.push("agent_type is required");
  if (!Number.isInteger(proposal.chain_id) || proposal.chain_id <= 0) errors.push("chain_id must be a positive integer");
  if (!/^0x[a-fA-F0-9]{40}$/.test(proposal.wallet)) errors.push("wallet must be a valid EVM address");
  if (!proposal.action.trim()) errors.push("action is required");
  if (!proposal.summary.trim()) errors.push("summary is required");
  if (!Number.isFinite(proposal.spend_cap ?? 0) || (proposal.spend_cap ?? 0) < 0) errors.push("spend_cap must be non-negative");
  if (!Number.isFinite(proposal.notional ?? 0) || (proposal.notional ?? 0) < 0) errors.push("notional must be non-negative");
  if ((proposal.notional ?? 0) > (proposal.spend_cap ?? 0)) errors.push("notional must not exceed spend_cap");
  if (proposal.slippage_bps !== undefined && (!Number.isFinite(proposal.slippage_bps) || proposal.slippage_bps < 0)) errors.push("slippage_bps must be non-negative");
  const expiry = Date.parse(proposal.expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) errors.push("expires_at must be in the future");
  return errors;
}
