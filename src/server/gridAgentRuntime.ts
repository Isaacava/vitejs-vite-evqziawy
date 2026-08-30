import type { GridProposal } from "./gridProposal.js";
import {
  applyRiskDecision,
  createMissionExecution,
  markExecutionStarted as markGenericExecutionStarted,
  markExecutionSubmitted as markGenericExecutionSubmitted,
  markExecutionVerified as markGenericExecutionVerified,
  markWalletPreflightPassed as markGenericWalletPreflightPassed,
  type MissionExecutionContext,
  type MissionExecutionEvent,
  type MissionExecutionState,
} from "./missionExecutionRuntime.js";

export type GridRuntimeState = MissionExecutionState;
export type GridRuntimeEvent = MissionExecutionEvent;
export type GridRuntimeContext = MissionExecutionContext & { proposal: GridProposal };

function toExecutionProposal(proposal: GridProposal) {
  return {
    ...proposal,
    agent_id: "grid",
    parameters: { ...proposal.parameters },
  };
}

export function createGridRuntime(proposal: GridProposal): GridRuntimeContext {
  return createMissionExecution(toExecutionProposal(proposal)) as GridRuntimeContext;
}

export function applyGridRiskDecision(
  context: GridRuntimeContext,
  decision: GridRuntimeContext["risk_decision"],
  reason?: string,
): GridRuntimeContext {
  return applyRiskDecision(context, decision, reason) as GridRuntimeContext;
}

export function markWalletPreflightPassed(context: GridRuntimeContext): GridRuntimeContext {
  return markGenericWalletPreflightPassed(context) as GridRuntimeContext;
}

export function markExecutionStarted(context: GridRuntimeContext): GridRuntimeContext {
  return markGenericExecutionStarted(context) as GridRuntimeContext;
}

export function markExecutionSubmitted(context: GridRuntimeContext, txHash: string): GridRuntimeContext {
  return markGenericExecutionSubmitted(context, txHash) as GridRuntimeContext;
}

export function markExecutionVerified(context: GridRuntimeContext): GridRuntimeContext {
  return markGenericExecutionVerified(context) as GridRuntimeContext;
}
