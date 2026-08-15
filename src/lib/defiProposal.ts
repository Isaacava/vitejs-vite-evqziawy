export type DefiAgentKind = "grid" | "rebalancing" | "yield";
export type ProposalRisk = "low" | "medium" | "high" | "critical";
export type ProposalAction = "swap" | "rebalance" | "provide_liquidity" | "withdraw" | "monitor";

export type DefiProposal = {
  version: "1";
  agent: DefiAgentKind;
  job_id: string;
  wallet: `0x${string}`;
  chain_id: 97;
  action: ProposalAction;
  summary: string;
  token?: string;
  protocol?: string;
  notional?: number;
  spend_cap?: number;
  slippage_bps?: number;
  risk: ProposalRisk;
  token_allowlist: string[];
  protocol_allowlist: string[];
  expires_at: string;
  metadata?: Record<string, unknown>;
};

function isoAfterMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function base(agent: DefiAgentKind, jobId: string, wallet: `0x${string}`, action: ProposalAction, summary: string): DefiProposal {
  return {
    version: "1",
    agent,
    job_id: jobId,
    wallet,
    chain_id: 97,
    action,
    summary,
    risk: "medium",
    token_allowlist: [],
    protocol_allowlist: [],
    expires_at: isoAfterMinutes(15),
  };
}

export function buildGridProposal(args: {
  jobId: string;
  wallet: `0x${string}`;
  token: string;
  protocol: string;
  notional: number;
  spendCap: number;
  slippageBps: number;
  summary?: string;
}) {
  return {
    ...base("grid", args.jobId, args.wallet, "swap", args.summary ?? "Execute the approved grid step within the configured risk limits."),
    token: args.token,
    protocol: args.protocol,
    notional: args.notional,
    spend_cap: args.spendCap,
    slippage_bps: args.slippageBps,
    token_allowlist: [args.token.toLowerCase()],
    protocol_allowlist: [args.protocol.toLowerCase()],
  } satisfies DefiProposal;
}

export function buildRebalancingProposal(args: {
  jobId: string;
  wallet: `0x${string}`;
  token: string;
  protocol: string;
  notional: number;
  spendCap: number;
  slippageBps: number;
  summary?: string;
}) {
  return {
    ...base("rebalancing", args.jobId, args.wallet, "rebalance", args.summary ?? "Rebalance portfolio allocation within the approved limits."),
    token: args.token,
    protocol: args.protocol,
    notional: args.notional,
    spend_cap: args.spendCap,
    slippage_bps: args.slippageBps,
    token_allowlist: [args.token.toLowerCase()],
    protocol_allowlist: [args.protocol.toLowerCase()],
  } satisfies DefiProposal;
}

export function buildYieldProposal(args: {
  jobId: string;
  wallet: `0x${string}`;
  token: string;
  protocol: string;
  notional: number;
  spendCap: number;
  slippageBps: number;
  summary?: string;
}) {
  return {
    ...base("yield", args.jobId, args.wallet, "provide_liquidity", args.summary ?? "Enter the selected yield strategy within the approved risk limits."),
    token: args.token,
    protocol: args.protocol,
    notional: args.notional,
    spend_cap: args.spendCap,
    slippage_bps: args.slippageBps,
    token_allowlist: [args.token.toLowerCase()],
    protocol_allowlist: [args.protocol.toLowerCase()],
  } satisfies DefiProposal;
}
