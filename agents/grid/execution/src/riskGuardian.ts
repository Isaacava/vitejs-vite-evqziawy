import type { Address } from "viem";
import type { GridCall, GridSessionDescriptor, RiskGuardianDecision } from "./types.js";

function normalize(value: string) {
  return value.toLowerCase();
}

function configuredList(name: string): string[] {
  return (process.env[name] || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function selectorOf(data: string) {
  return data.slice(0, 10).toLowerCase();
}

/**
 * Risk Guardian is deliberately fail-closed.
 *
 * Altana remains the final on-chain authority for the session permissions and
 * spend cap. The Guardian adds an application-level control layer that checks
 * the proposed target and function selector before execute() is ever called.
 */
export function approveGridExecution(
  descriptor: GridSessionDescriptor,
  calls: readonly GridCall[],
  nowSeconds = Math.floor(Date.now() / 1000),
): RiskGuardianDecision {
  const reasons: string[] = [];

  if (!/^0x[a-fA-F0-9]{40}$/.test(descriptor.walletAddress)) {
    reasons.push("Execution wallet identity is invalid");
  }
  if (descriptor.expiry <= nowSeconds) {
    reasons.push("Altana session has expired");
  }
  if (descriptor.allowedCalls.length === 0) {
    reasons.push("Altana session has no explicit contract allowlist");
  }
  if (calls.length === 0) {
    reasons.push("Execution request contains no calls");
  }
  if (calls.length > 8) {
    reasons.push("Execution request exceeds the Grid batch call limit");
  }

  const allowedTargets = new Set(descriptor.allowedCalls.map(normalize));
  const configuredTargets = configuredList("GRID_ALLOWED_TARGETS");
  const configuredSelectors = configuredList("GRID_ALLOWED_SELECTORS");
  let nativeValue = 0n;

  for (const call of calls) {
    const target = normalize(call.to);
    if (!allowedTargets.has(target)) {
      reasons.push(`Target ${call.to} is outside the user's Altana session allowlist`);
    }
    if (configuredTargets.length > 0 && !configuredTargets.includes(target)) {
      reasons.push(`Target ${call.to} is outside the Risk Guardian target allowlist`);
    }

    const selector = selectorOf(call.data);
    if (!/^0x[0-9a-f]{8}$/.test(selector)) {
      reasons.push(`Call ${call.to} does not contain a valid 4-byte function selector`);
    } else if (configuredSelectors.length === 0) {
      reasons.push("Risk Guardian has no configured function-selector allowlist");
    } else if (!configuredSelectors.includes(selector)) {
      reasons.push(`Function selector ${selector} is not approved by Risk Guardian`);
    }

    nativeValue += call.value ?? 0n;
  }

  if (descriptor.spendToken === undefined && nativeValue > descriptor.spendLimit) {
    reasons.push("Native-value calls exceed the Altana session spend cap");
  }

  if (descriptor.spendToken && nativeValue > 0n) {
    reasons.push("Token-scoped Altana sessions cannot spend native BNB as part of this execution request");
  }

  if (reasons.length === 0) {
    reasons.push("Risk Guardian approved: target, selector, expiry and application limits are satisfied; Altana enforces the final on-chain session scope");
  }

  return {
    approved: reasons.length === 1 && reasons[0].startsWith("Risk Guardian approved"),
    reasons,
  };
}

export function assertAddressList(values: readonly Address[]) {
  if (values.length === 0) throw new Error("At least one target contract is required");
  for (const value of values) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`Invalid contract target: ${value}`);
  }
}
