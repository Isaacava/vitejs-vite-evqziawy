import type { DefiProposal } from "./defiProposal";

export type ProposalValidation = {
  valid: boolean;
  errors: string[];
};

export function validateDefiProposal(input: unknown): ProposalValidation {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return { valid: false, errors: ["Proposal must be an object."] };

  const proposal = input as Partial<DefiProposal>;
  if (proposal.version !== "1") errors.push("Unsupported proposal version.");
  if (!["grid", "rebalancing", "yield"].includes(String(proposal.agent))) errors.push("Unsupported agent kind.");
  if (!proposal.job_id) errors.push("job_id is required.");
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(proposal.wallet ?? ""))) errors.push("wallet must be a valid EVM address.");
  if (proposal.chain_id !== 97) errors.push("Only BSC Testnet proposals are permitted during development.");
  if (!proposal.action) errors.push("action is required.");
  if (!proposal.summary || proposal.summary.length > 240) errors.push("summary is required and must be 240 characters or fewer.");
  if (!proposal.expires_at || !Number.isFinite(Date.parse(proposal.expires_at))) errors.push("expires_at must be a valid ISO timestamp.");
  if (proposal.expires_at && Date.parse(proposal.expires_at) <= Date.now()) errors.push("expires_at must be in the future.");
  if (typeof proposal.notional === "number" && (!Number.isFinite(proposal.notional) || proposal.notional < 0)) errors.push("notional must be a non-negative number.");
  if (typeof proposal.spend_cap === "number" && (!Number.isFinite(proposal.spend_cap) || proposal.spend_cap < 0)) errors.push("spend_cap must be a non-negative number.");
  if (typeof proposal.notional === "number" && typeof proposal.spend_cap === "number" && proposal.notional > proposal.spend_cap) errors.push("notional cannot exceed spend_cap.");
  if (typeof proposal.slippage_bps === "number" && (!Number.isFinite(proposal.slippage_bps) || proposal.slippage_bps < 0 || proposal.slippage_bps > 150)) errors.push("slippage_bps must be between 0 and 150.");
  if (!Array.isArray(proposal.token_allowlist)) errors.push("token_allowlist is required.");
  if (!Array.isArray(proposal.protocol_allowlist)) errors.push("protocol_allowlist is required.");

  return { valid: errors.length === 0, errors };
}
