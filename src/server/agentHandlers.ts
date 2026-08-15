import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { getAddress, type Address } from "viem";
import { COMMERCE_ABI, ERC8183_ADDRESSES, publicClient } from "../lib/erc8183.js";
import { getAuthenticatedUser } from "./authHandlers.js";

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { persistSession: false } });
}
function runtimeAuthorized(req: VercelRequest) {
  const secret = process.env.AGENT_RUNTIME_SECRET;
  return !secret ? process.env.NODE_ENV !== "production" : req.headers.authorization === `Bearer ${secret}`;
}
async function authorizedForAgent(req: VercelRequest, owner: string | null | undefined) {
  if (runtimeAuthorized(req)) return true;
  const auth = await getAuthenticatedUser(req);
  return !!auth && typeof owner === "string" && auth.user.wallet_address.toLowerCase() === owner.toLowerCase();
}
function readContract(args: Record<string, unknown>) {
  return (publicClient.readContract as unknown as (value: Record<string, unknown>) => Promise<any>)(args);
}
function address(value: unknown, field: string): Address {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${field} must be a valid EVM address`);
  return getAddress(value);
}

export async function watch(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const agentId = typeof req.query.agent_id === "string" ? req.query.agent_id.trim() : "";
    if (!agentId) return res.status(400).json({ error: "agent_id is required" });
    const supabase = db();
    const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,owner,name,status,verification_status").eq("agent_id", agentId).maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    if (!(await authorizedForAgent(req, agent.owner))) return res.status(401).json({ error: "Agent owner authentication required" });
    const provider = address(agent.owner, "agent.owner");
    const counter = BigInt(await readContract({ address: ERC8183_ADDRESSES.commerce, abi: COMMERCE_ABI, functionName: "jobCounter" }));
    const requested = Number(req.query.scan || 32);
    const scan = Math.max(1, Math.min(Number.isFinite(requested) ? requested : 32, 100));
    const first = counter > BigInt(scan) ? counter - BigInt(scan) + 1n : 1n;
    const jobs: any[] = [];
    for (let id = counter; id >= first; id -= 1n) {
      const job = await readContract({ address: ERC8183_ADDRESSES.commerce, abi: COMMERCE_ABI, functionName: "getJob", args: [id] });
      if (job.id === 0n || job.provider.toLowerCase() !== provider.toLowerCase() || Number(job.status) !== 1) continue;
      jobs.push({ id: job.id.toString(), client: job.client, provider: job.provider, evaluator: job.evaluator, description: job.description, budget: job.budget.toString(), expiredAt: job.expiredAt.toString(), status: Number(job.status), deliverable: job.deliverable });
    }
    return res.status(200).json({ ok: true, network: "bsc-mainnet", agent, provider, scanned: { from: first.toString(), to: counter.toString(), count: scan }, funded_jobs: jobs, guidance: "Re-read FUNDED status, provider, expiry and budget before accepting or submitting." });
  } catch (error) { return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to scan funded jobs" }); }
}

export async function actions(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const transitions: Record<string, { from: string[]; to: string; payload?: boolean }> = { accept: { from: ["open", "funded"], to: "accepted" }, start: { from: ["accepted"], to: "in_progress" }, progress: { from: ["in_progress"], to: "in_progress", payload: true }, message: { from: ["accepted", "in_progress"], to: "in_progress", payload: true }, submit: { from: ["in_progress"], to: "submitted", payload: true } };
  try {
    const agentId = typeof req.body?.agent_id === "string" ? req.body.agent_id.trim() : "";
    const chainJobId = typeof req.body?.chain_job_id === "string" ? req.body.chain_job_id.trim() : "";
    const action = typeof req.body?.action === "string" ? req.body.action.trim().toLowerCase() : "";
    const payload = req.body?.payload;
    const transition = transitions[action];
    if (!agentId || !chainJobId || !transition) return res.status(400).json({ error: "agent_id, chain_job_id and a supported action are required" });
    if (transition.payload && (!payload || typeof payload !== "object")) return res.status(400).json({ error: `${action} requires a payload` });
    const supabase = db();
    const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,owner").eq("agent_id", agentId).maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    if (!(await authorizedForAgent(req, agent.owner))) return res.status(401).json({ error: "Agent owner authentication required" });
    const provider = address(agent.owner, "agent.owner");
    const { data: job, error: jobError } = await supabase.from("jobs").select("id,chain_job_id,status,provider_agent_id,mission_task_id,client_wallet,description,budget,payment_token").eq("chain_job_id", Number(chainJobId)).maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return res.status(404).json({ error: "Job is not indexed in the marketplace yet" });
    if (job.provider_agent_id !== agent.id) return res.status(403).json({ error: "This agent is not the assigned provider for the job" });
    const chain = await readContract({ address: ERC8183_ADDRESSES.commerce, abi: COMMERCE_ABI, functionName: "getJob", args: [BigInt(chainJobId)] });
    if (chain.id === 0n) return res.status(404).json({ error: "Chain job not found" });
    if (chain.provider.toLowerCase() !== provider.toLowerCase()) return res.status(403).json({ error: "Chain provider does not match the assigned provider agent" });
    if (Number(chain.status) !== 1) return res.status(409).json({ error: `Chain job is not FUNDED; current state is ${Number(chain.status)}` });
    if (Number(chain.expiredAt) * 1000 <= Date.now()) return res.status(409).json({ error: "Chain job has expired" });
    const current = String(job.status || "").toLowerCase();
    const normalizedCurrent = current === "open" ? "funded" : current;
    if (action === "accept" && normalizedCurrent !== "funded") return res.status(409).json({ error: `Cannot accept a job in ${current || "unknown"} state` });
    if (action !== "accept" && !transition.from.includes(current)) return res.status(409).json({ error: `Cannot ${action} a job in ${current || "unknown"} state` });
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (action === "accept") updates.status = "accepted";
    if (action === "start") updates.status = "in_progress";
    if (action === "submit") { updates.status = "submitted"; updates.deliverable = payload?.deliverable || payload?.result || null; }
    const { data: updated, error: updateError } = await supabase.from("jobs").update(updates).eq("id", job.id).select("id,chain_job_id,status,provider_agent_id,mission_task_id,deliverable").single();
    if (updateError) throw new Error(updateError.message);
    if (action === "message" || action === "progress") await supabase.from("agent_messages").insert({ mission_id: null, task_id: job.mission_task_id, sender_type: "agent", sender_id: agent.id, body: String(payload?.body || payload?.message || "Provider runtime update") });
    if (action === "submit") await supabase.from("notifications").insert({ mission_id: null, task_id: job.mission_task_id, recipient: provider, kind: "deliverable_submitted", title: "Agent submitted deliverable", body: `Job ${chainJobId} has been submitted for evaluation.` });
    return res.status(200).json({ ok: true, action, job: updated, chain: { id: chain.id.toString(), status: Number(chain.status), budget: chain.budget.toString(), provider: chain.provider, client: chain.client, evaluator: chain.evaluator }, note: "Provider workflow state updated only after re-verifying the live FUNDED chain job. On-chain provider submission and settlement remain separate." });
  } catch (error) { return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to perform agent action" }); }
}

type Proposal = { job_id: string; action: string; risk?: string; notional?: number; spend_cap?: number; token?: string; token_allowlist?: string[]; expires_at?: string; slippage_bps?: number };
type Decision = "approve" | "block" | "user_approval";
function evaluate(input: Proposal) {
  const reasons: string[] = [];
  const risk = typeof input.risk === "string" ? input.risk.trim().toLowerCase() : "unknown";
  const token = typeof input.token === "string" ? input.token.trim().toLowerCase() : "";
  const allowlist = Array.isArray(input.token_allowlist) ? input.token_allowlist.map((v) => typeof v === "string" ? v.trim().toLowerCase() : "").filter(Boolean) : [];
  if (allowlist.length && (!token || !allowlist.includes(token))) reasons.push("Asset is outside the approved token allowlist.");
  else if (Number(input.spend_cap ?? 0) > 0 && Number(input.notional ?? 0) > Number(input.spend_cap)) reasons.push("Requested value exceeds the approved spend cap.");
  else if (Number(input.slippage_bps ?? 0) > 150) reasons.push("Requested slippage is above the conservative guardrail.");
  else if (["high", "critical"].includes(risk)) reasons.push("Risk classification requires explicit user approval.");
  else if (!input.expires_at) reasons.push("Session expiry is not provided; explicit user approval is required.");
  else { const expiry = Date.parse(input.expires_at); if (!Number.isFinite(expiry) || expiry <= Date.now()) reasons.push("The requested session is expired or has an invalid expiry."); }
  if (reasons.length === 0) return { decision: "approve" as Decision, reasons: ["Requested action is within the supplied risk constraints."] };
  if (reasons[0].includes("outside") || reasons[0].includes("exceeds") || reasons[0].includes("slippage") || reasons[0].includes("expired")) return { decision: "block" as Decision, reasons };
  return { decision: "user_approval" as Decision, reasons };
}

export async function riskPolicy(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const result = evaluate((req.body || {}) as Proposal);
  return res.status(200).json({ ok: true, agent: "risk-guardian", version: "1", decision: result.decision, reasons: result.reasons, execution: { permitted: result.decision === "approve", user_confirmation_required: result.decision === "user_approval", server_signing: false } });
}

export async function riskRuntime(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!runtimeAuthorized(req)) return res.status(401).json({ error: "Agent runtime unauthorized" });
  try {
    const input = (req.body || {}) as Proposal;
    if (!input.job_id || !input.action) return res.status(400).json({ error: "job_id and action are required" });
    const supabase = db();
    const { data: job, error: jobError } = await supabase.from("jobs").select("id,status,mission_task_id,chain_job_id").eq("id", input.job_id).maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return res.status(404).json({ error: "Job not found" });
    const result = evaluate(input);
    const now = new Date().toISOString();
    const evidence = { source: "risk_guardian_runtime", version: "1", decision: result.decision, action: input.action, reasons: result.reasons, proposal: input, evaluated_at: now, server_signing: false };
    await supabase.from("agent_messages").insert({ mission_id: null, task_id: job.mission_task_id, sender_type: "agent", sender_id: "risk-guardian", body: `Risk Guardian: ${result.decision}. ${result.reasons.join(" ")}` });
    const { data: evaluation } = await supabase.from("evaluations").upsert({ job_id: job.id, verdict: "pending", evidence, notes: `Risk Guardian decision: ${result.decision}`, updated_at: now }, { onConflict: "job_id" }).select("id,verdict,evidence").single();
    return res.status(200).json({ ok: true, job: { id: job.id, chain_job_id: job.chain_job_id, status: job.status }, decision: result.decision, reasons: result.reasons, execution: { permitted: result.decision === "approve", user_confirmation_required: result.decision === "user_approval", server_signing: false }, evaluation_id: evaluation?.id || null });
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Risk Guardian runtime failed" }); }
}
