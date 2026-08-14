import type { VercelRequest, VercelResponse } from "@vercel/node";

export type RiskDecision = "approve" | "block" | "user_approval";

type GuardInput = {
  task_type?: string;
  action?: string;
  risk?: string;
  notional?: number;
  spend_cap?: number;
  token?: string;
  token_allowlist?: string[];
  expires_at?: string;
  slippage_bps?: number;
};

function normalize(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function decide(input: GuardInput) {
  const reasons: string[] = [];
  const risk = normalize(input.risk) || "unknown";
  const token = normalize(input.token);
  const allowlist = Array.isArray(input.token_allowlist)
    ? input.token_allowlist.map(normalize).filter(Boolean)
    : [];
  const notional = Number(input.notional ?? 0);
  const spendCap = Number(input.spend_cap ?? 0);
  const slippage = Number(input.slippage_bps ?? 0);

  if (allowlist.length && (!token || !allowlist.includes(token))) {
    reasons.push("Asset is outside the approved token allowlist.");
    return { decision: "block" as const, reasons };
  }

  if (spendCap > 0 && notional > spendCap) {
    reasons.push("Requested value exceeds the approved spend cap.");
    return { decision: "block" as const, reasons };
  }

  if (slippage > 150) {
    reasons.push("Requested slippage is above the conservative guardrail.");
    return { decision: "block" as const, reasons };
  }

  if (["high", "critical"].includes(risk)) {
    reasons.push("Risk classification requires explicit user approval.");
    return { decision: "user_approval" as const, reasons };
  }

  if (!input.expires_at) {
    reasons.push("Session expiry is not provided; explicit user approval is required.");
    return { decision: "user_approval" as const, reasons };
  }

  const expiry = Date.parse(input.expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    reasons.push("The requested session is expired or has an invalid expiry.");
    return { decision: "block" as const, reasons };
  }

  reasons.push("Requested action is within the supplied risk constraints.");
  return { decision: "approve" as const, reasons };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const input = (req.body || {}) as GuardInput;
    const result = decide(input);

    return res.status(200).json({
      ok: true,
      agent: "risk-guardian",
      version: "1",
      decision: result.decision,
      reasons: result.reasons,
      execution: {
        permitted: result.decision === "approve",
        user_confirmation_required: result.decision === "user_approval",
        server_signing: false,
      },
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Risk Guardian evaluation failed",
    });
  }
}
