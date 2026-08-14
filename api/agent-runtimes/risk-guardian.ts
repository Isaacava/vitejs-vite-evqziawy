import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

type Proposal = {
  job_id: string;
  action: string;
  risk?: string;
  notional?: number;
  spend_cap?: number;
  token?: string;
  token_allowlist?: string[];
  expires_at?: string;
  slippage_bps?: number;
};

type Decision = "approve" | "block" | "user_approval";

function normalize(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function evaluate(input: Proposal) {
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
    return { decision: "block" as Decision, reasons };
  }
  if (spendCap > 0 && notional > spendCap) {
    reasons.push("Requested value exceeds the approved spend cap.");
    return { decision: "block" as Decision, reasons };
  }
  if (slippage > 150) {
    reasons.push("Requested slippage is above the conservative guardrail.");
    return { decision: "block" as Decision, reasons };
  }
  if (["high", "critical"].includes(risk)) {
    reasons.push("Risk classification requires explicit user approval.");
    return { decision: "user_approval" as Decision, reasons };
  }
  if (!input.expires_at) {
    reasons.push("Session expiry is not provided; explicit user approval is required.");
    return { decision: "user_approval" as Decision, reasons };
  }

  const expiry = Date.parse(input.expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    reasons.push("The requested session is expired or has an invalid expiry.");
    return { decision: "block" as Decision, reasons };
  }

  reasons.push("Requested action is within the supplied risk constraints.");
  return { decision: "approve" as Decision, reasons };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const runtimeSecret = process.env.AGENT_RUNTIME_SECRET;
  if (runtimeSecret && req.headers.authorization !== `Bearer ${runtimeSecret}`) {
    return res.status(401).json({ error: "Agent runtime unauthorized" });
  }

  try {
    const input = (req.body || {}) as Proposal;
    if (!input.job_id) return res.status(400).json({ error: "job_id is required" });
    if (!input.action) return res.status(400).json({ error: "action is required" });

    const supabase = serverClient();
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id, status, description, provider_agent_id, mission_task_id, chain_job_id")
      .eq("id", input.job_id)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const result = evaluate(input);
    const now = new Date().toISOString();
    const evidence = {
      source: "risk_guardian_runtime",
      version: "1",
      decision: result.decision,
      action: input.action,
      reasons: result.reasons,
      proposal: input,
      evaluated_at: now,
      server_signing: false,
    };

    await supabase.from("messages").insert({
      task_id: job.mission_task_id,
      sender: "risk-guardian",
      recipient: "mission",
      body: `Risk Guardian: ${result.decision}. ${result.reasons.join(" ")}`,
      created_at: now,
    });

    const { data: evaluation } = await supabase
      .from("evaluations")
      .upsert({
        job_id: job.id,
        verdict: "pending",
        evidence,
        notes: `Risk Guardian decision: ${result.decision}`,
        updated_at: now,
      }, { onConflict: "job_id" })
      .select("id, verdict, evidence")
      .single();

    return res.status(200).json({
      ok: true,
      job: {
        id: job.id,
        chain_job_id: job.chain_job_id,
        status: job.status,
      },
      decision: result.decision,
      reasons: result.reasons,
      execution: {
        permitted: result.decision === "approve",
        user_confirmation_required: result.decision === "user_approval",
        server_signing: false,
      },
      evaluation_id: evaluation?.id || null,
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Risk Guardian runtime failed",
    });
  }
}
