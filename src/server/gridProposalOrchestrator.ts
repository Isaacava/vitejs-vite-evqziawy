import type { DefiProposal } from "../lib/defiProposal.js";
import { validateDefiProposal } from "../lib/validateDefiProposal.js";
import { evaluateRiskProposal } from "./riskGuardianPolicy.js";
import {
  applyGridRiskDecision,
  createGridRuntime,
  type GridRuntimeContext,
} from "./gridAgentRuntime.js";

export type GridOrchestrationResult =
  | { ok: true; context: GridRuntimeContext; proposal: DefiProposal }
  | { ok: false; stage: "validation" | "risk"; errors: string[] };

export function prepareGridRuntime(proposal: DefiProposal): GridOrchestrationResult {
  const validation = validateDefiProposal(proposal);
  if (!validation.valid) {
    return { ok: false, stage: "validation", errors: validation.errors };
  }

  if (proposal.agent !== "grid") {
    return { ok: false, stage: "validation", errors: ["Proposal is not a Grid Agent proposal."] };
  }

  const risk = evaluateRiskProposal({
    job_id: proposal.job_id,
    action: proposal.action,
    risk: proposal.risk,
    notional: proposal.notional,
    spend_cap: proposal.spend_cap,
    token: proposal.token,
    token_allowlist: proposal.token_allowlist,
    protocol: proposal.protocol,
    protocol_allowlist: proposal.protocol_allowlist,
    expires_at: proposal.expires_at,
    slippage_bps: proposal.slippage_bps,
  });

  const context = applyGridRiskDecision(
    createGridRuntime({
      job_id: proposal.job_id,
      agent_type: "grid",
      chain_id: 97,
      wallet: proposal.wallet,
      action: "create_grid",
      summary: proposal.summary,
      token: proposal.token ?? "",
      protocol: proposal.protocol ?? "",
      notional: proposal.notional ?? 0,
      spend_cap: proposal.spend_cap ?? 0,
      slippage_bps: proposal.slippage_bps ?? 0,
      risk: "medium",
      expires_at: proposal.expires_at,
      parameters: {},
    }),
    risk.decision,
    risk.reasons.join(" "),
  );

  return { ok: true, context, proposal };
}
