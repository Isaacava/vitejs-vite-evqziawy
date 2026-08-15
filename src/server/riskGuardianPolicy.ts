import type { VercelRequest, VercelResponse } from "@vercel/node";

export type RiskProposal = {
  job_id?: string;
  action?: string;
  risk?: string;
  notional?: number;
  spend_cap?: number;
  token?: string;
  token_allowlist?: string[];
  protocol?: string;
  protocol_allowlist?: string[];
  expires_at?: string;
  slippage_bps?: number;
};

export type RiskDecision = "approve" | "block" | "user_approval";

export type RiskResult = {
  decision: RiskDecision;
  reasons: string[];
  checks: {
    token: "pass" | "fail" | "not_checked";
    protocol: "pass" | "fail" | "not_checked";
    spend_cap: "pass" | "fail" | "not_checked";
    slippage: "pass" | "fail" | "not_checked";
    risk: "pass" | "fail" | "not_checked";
    expiry: "pass" | "fail" | "not_checked";
  };
};

const cleanList = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase()).filter(Boolean)
    : [];

const normalize = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";

export function evaluateRiskProposal(input: RiskProposal): RiskResult {
  const reasons: string[] = [];
  const checks: RiskResult["checks"] = {
    token: "not_checked",
    protocol: "not_checked",
    spend_cap: "not_checked",
    slippage: "not_checked",
    risk: "not_checked",
    expiry: "not_checked",
  };

  const token = normalize(input.token);
  const tokenAllowlist = cleanList(input.token_allowlist);
  if (tokenAllowlist.length) {
    checks.token = token && tokenAllowlist.includes(token) ? "pass" : "fail";
    if (checks.token === "fail") reasons.push("Asset is outside the approved token allowlist.");
  }

  const protocol = normalize(input.protocol);
  const protocolAllowlist = cleanList(input.protocol_allowlist);
  if (protocolAllowlist.length) {
    checks.protocol = protocol && protocolAllowlist.includes(protocol) ? "pass" : "fail";
    if (checks.protocol === "fail") reasons.push("Protocol is outside the approved protocol allowlist.");
  }

  const cap = Number(input.spend_cap ?? 0);
  const notional = Number(input.notional ?? 0);
  if (Number.isFinite(cap) && cap > 0) {
    checks.spend_cap = Number.isFinite(notional) && notional >= 0 && notional <= cap ? "pass" : "fail";
    if (checks.spend_cap === "fail") reasons.push("Requested value exceeds the approved spend cap.");
  }

  const slippage = Number(input.slippage_bps ?? 0);
  if (Number.isFinite(slippage)) {
    checks.slippage = slippage <= 150 ? "pass" : "fail";
    if (checks.slippage === "fail") reasons.push("Requested slippage is above the conservative guardrail.");
  }

  const risk = normalize(input.risk);
  if (risk) {
    checks.risk = ["low", "medium"].includes(risk) ? "pass" : "fail";
    if (checks.risk === "fail") reasons.push("Risk classification requires explicit user approval.");
  }

  if (input.expires_at) {
    const expiry = Date.parse(input.expires_at);
    checks.expiry = Number.isFinite(expiry) && expiry > Date.now() ? "pass" : "fail";
    if (checks.expiry === "fail") reasons.push("The requested session is expired or has an invalid expiry.");
  } else {
    checks.expiry = "fail";
    reasons.push("Session expiry is not provided; explicit user approval is required.");
  }

  const hardBlocks = [
    checks.token === "fail",
    checks.protocol === "fail",
    checks.spend_cap === "fail",
    checks.slippage === "fail",
    checks.expiry === "fail" && !reasons.some((reason) => reason.includes("explicit user approval")),
  ].some(Boolean);

  if (hardBlocks) return { decision: "block", reasons, checks };

  const needsUserApproval = checks.risk === "fail" || checks.expiry === "fail";
  if (needsUserApproval) return { decision: "user_approval", reasons, checks };

  return {
    decision: "approve",
    reasons: ["Requested action is within the supplied risk constraints."],
    checks,
  };
}

export async function riskPolicyHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const result = evaluateRiskProposal((req.body || {}) as RiskProposal);
  return res.status(200).json({
    ok: true,
    agent: "risk-guardian",
    version: "2",
    decision: result.decision,
    reasons: result.reasons,
    checks: result.checks,
    execution: {
      permitted: result.decision === "approve",
      user_confirmation_required: result.decision === "user_approval",
      server_signing: false,
    },
  });
}
