import type { VercelRequest, VercelResponse } from "@vercel/node";
import { evaluateRiskProposal, type RiskProposal } from "./riskGuardianPolicy.js";

export type DeFiProposal = RiskProposal & {
  agent_id: string;
  category: "grid" | "rebalancing" | "yield" | "risk";
  chain_id: number;
  wallet: string;
  summary: string;
};

const categories = new Set<DeFiProposal["category"]>(["grid", "rebalancing", "yield", "risk"]);

function normalizeProposal(input: Record<string, unknown>): DeFiProposal | null {
  const agentId = typeof input.agent_id === "string" ? input.agent_id.trim() : "";
  const category = typeof input.category === "string" ? input.category.trim().toLowerCase() as DeFiProposal["category"] : "" as DeFiProposal["category"];
  const wallet = typeof input.wallet === "string" ? input.wallet.trim() : "";
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  const chainId = Number(input.chain_id);

  if (!agentId || !categories.has(category) || !/^0x[a-fA-F0-9]{40}$/.test(wallet) || !Number.isInteger(chainId) || chainId !== 97 || !summary) {
    return null;
  }

  return {
    agent_id: agentId,
    category,
    chain_id: chainId,
    wallet,
    summary,
    job_id: typeof input.job_id === "string" ? input.job_id.trim() : undefined,
    action: typeof input.action === "string" ? input.action.trim().toLowerCase() : undefined,
    risk: typeof input.risk === "string" ? input.risk.trim().toLowerCase() : undefined,
    notional: Number.isFinite(Number(input.notional)) ? Number(input.notional) : undefined,
    spend_cap: Number.isFinite(Number(input.spend_cap)) ? Number(input.spend_cap) : undefined,
    token: typeof input.token === "string" ? input.token.trim() : undefined,
    token_allowlist: input.token_allowlist as string[] | undefined,
    protocol: typeof input.protocol === "string" ? input.protocol.trim() : undefined,
    protocol_allowlist: input.protocol_allowlist as string[] | undefined,
    expires_at: typeof input.expires_at === "string" ? input.expires_at : undefined,
    slippage_bps: Number.isFinite(Number(input.slippage_bps)) ? Number(input.slippage_bps) : undefined,
  };
}

export async function proposalHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const proposal = normalizeProposal((req.body || {}) as Record<string, unknown>);
  if (!proposal) {
    return res.status(400).json({
      ok: false,
      error: "Invalid proposal. Required: agent_id, category, wallet, chain_id=97, and summary.",
    });
  }

  const decision = evaluateRiskProposal(proposal);
  return res.status(200).json({
    ok: true,
    proposal,
    decision: decision.decision,
    reasons: decision.reasons,
    checks: decision.checks,
    execution: {
      permitted: decision.decision === "approve",
      user_confirmation_required: decision.decision === "user_approval",
      server_signing: false,
      next_step: decision.decision === "block"
        ? "Revise the proposal within the allowed risk policy."
        : decision.decision === "user_approval"
          ? "Show the complete proposal to the user and require explicit wallet confirmation."
          : "A wallet transaction may be prepared by the client after final on-chain preflight.",
    },
  });
}
