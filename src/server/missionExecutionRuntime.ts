import type { ExecutionProposal } from "./executionProposal.js";
import { validateExecutionProposal } from "./executionProposal.js";

export type MissionExecutionState =
  | "planned"
  | "risk_review"
  | "blocked"
  | "awaiting_user"
  | "approved"
  | "ready_for_wallet"
  | "executing"
  | "submitted"
  | "verified";

export type MissionExecutionEvent = {
  type:
    | "proposal_created"
    | "risk_requested"
    | "risk_blocked"
    | "user_approval_required"
    | "risk_approved"
    | "wallet_preflight_passed"
    | "execution_started"
    | "execution_submitted"
    | "execution_verified";
  at: string;
  tx_hash?: string;
  reason?: string;
};

export type MissionExecutionContext = {
  proposal: ExecutionProposal;
  state: MissionExecutionState;
  events: MissionExecutionEvent[];
  risk_decision?: "approve" | "block" | "user_approval";
  tx_hash?: string;
};

export function createMissionExecution(proposal: ExecutionProposal): MissionExecutionContext {
  const errors = validateExecutionProposal(proposal);
  if (errors.length) throw new Error(`Invalid execution proposal: ${errors.join(" ")}`);
  return {
    proposal,
    state: "planned",
    events: [{ type: "proposal_created", at: new Date().toISOString() }],
  };
}

export function applyRiskDecision(
  context: MissionExecutionContext,
  decision: MissionExecutionContext["risk_decision"],
  reason?: string,
): MissionExecutionContext {
  const at = new Date().toISOString();
  if (decision === "block") {
    return { ...context, state: "blocked", risk_decision: "block", events: [...context.events, { type: "risk_blocked", at, reason }] };
  }
  if (decision === "user_approval") {
    return { ...context, state: "awaiting_user", risk_decision: "user_approval", events: [...context.events, { type: "user_approval_required", at, reason }] };
  }
  return { ...context, state: "approved", risk_decision: "approve", events: [...context.events, { type: "risk_approved", at, reason }] };
}

export function markWalletPreflightPassed(context: MissionExecutionContext): MissionExecutionContext {
  if (context.risk_decision !== "approve") throw new Error("wallet preflight requires an approved Risk Guardian decision");
  return { ...context, state: "ready_for_wallet", events: [...context.events, { type: "wallet_preflight_passed", at: new Date().toISOString() }] };
}

export function markExecutionStarted(context: MissionExecutionContext): MissionExecutionContext {
  if (context.state !== "ready_for_wallet") throw new Error("wallet preflight must pass first");
  return { ...context, state: "executing", events: [...context.events, { type: "execution_started", at: new Date().toISOString() }] };
}

export function markExecutionSubmitted(context: MissionExecutionContext, txHash: string): MissionExecutionContext {
  if (context.state !== "executing") throw new Error("execution must be started first");
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new Error("txHash must be a valid transaction hash");
  return { ...context, state: "submitted", tx_hash: txHash, events: [...context.events, { type: "execution_submitted", at: new Date().toISOString(), tx_hash: txHash }] };
}

export function markExecutionVerified(context: MissionExecutionContext): MissionExecutionContext {
  if (context.state !== "submitted" || !context.tx_hash) throw new Error("a submitted transaction is required before verification");
  return { ...context, state: "verified", events: [...context.events, { type: "execution_verified", at: new Date().toISOString(), tx_hash: context.tx_hash }] };
}
