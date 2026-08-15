export type GridProposalInput = {
  jobId: string;
  wallet: string;
  token: string;
  protocol: string;
  lowerPrice: number;
  upperPrice: number;
  gridLevels: number;
  notional: number;
  spendCap: number;
  slippageBps: number;
  expiresAt: string;
};

export type GridProposal = {
  job_id: string;
  agent_type: "grid";
  chain_id: 97;
  wallet: string;
  action: "create_grid";
  summary: string;
  token: string;
  protocol: string;
  notional: number;
  spend_cap: number;
  slippage_bps: number;
  risk: "medium";
  expires_at: string;
  parameters: {
    lower_price: number;
    upper_price: number;
    grid_levels: number;
  };
};

export function buildGridProposal(input: GridProposalInput): GridProposal {
  if (!input.jobId.trim()) throw new Error("jobId is required");
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.wallet)) throw new Error("wallet must be a valid EVM address");
  if (!input.token.trim() || !input.protocol.trim()) throw new Error("token and protocol are required");
  if (!Number.isFinite(input.lowerPrice) || !Number.isFinite(input.upperPrice) || input.lowerPrice <= 0 || input.upperPrice <= input.lowerPrice) {
    throw new Error("price range is invalid");
  }
  if (!Number.isInteger(input.gridLevels) || input.gridLevels < 2 || input.gridLevels > 100) {
    throw new Error("gridLevels must be an integer between 2 and 100");
  }
  if (!Number.isFinite(input.notional) || input.notional <= 0) throw new Error("notional must be positive");
  if (!Number.isFinite(input.spendCap) || input.spendCap <= 0 || input.notional > input.spendCap) {
    throw new Error("notional must be within spendCap");
  }
  if (!Number.isFinite(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 150) {
    throw new Error("slippageBps must be between 0 and 150");
  }
  const expiry = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error("expiresAt must be in the future");

  const spacing = (input.upperPrice - input.lowerPrice) / (input.gridLevels - 1);
  const summary = `Create a ${input.gridLevels}-level grid for ${input.token} on ${input.protocol} between ${input.lowerPrice} and ${input.upperPrice}.`;

  return {
    job_id: input.jobId.trim(),
    agent_type: "grid",
    chain_id: 97,
    wallet: input.wallet,
    action: "create_grid",
    summary,
    token: input.token.trim(),
    protocol: input.protocol.trim(),
    notional: input.notional,
    spend_cap: input.spendCap,
    slippage_bps: input.slippageBps,
    risk: "medium",
    expires_at: input.expiresAt,
    parameters: {
      lower_price: input.lowerPrice,
      upper_price: input.upperPrice,
      grid_levels: input.gridLevels,
    },
  };
}
