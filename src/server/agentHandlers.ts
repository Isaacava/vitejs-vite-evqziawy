import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { getAddress, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { getAuthenticatedUser } from "./authHandlers.js";
import { PROVIDER_COMMERCE_ABI, PROVIDER_ERC8183_TESTNET, providerPublicClient } from "../lib/erc8183ProviderTestnet.js";

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
  return (providerPublicClient.readContract as unknown as (value: Record<string, unknown>) => Promise<any>)(args);
}
function address(value: unknown, field: string): Address {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${field} must be a valid EVM address`);
  return getAddress(value);
}

export async function heartbeat(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!runtimeAuthorized(req)) return res.status(401).json({ error: "Agent runtime unauthorized" });
  try {
    const agentId = typeof req.body?.agent_id === "string" ? req.body.agent_id.trim() : "";
    const endpointUrl = typeof req.body?.endpoint_url === "string" ? req.body.endpoint_url.trim() : "";
    const status = typeof req.body?.status === "string" ? req.body.status.trim().toLowerCase() : "";
    const latency = req.body?.latency_ms == null ? null : Number(req.body.latency_ms);
    const statusCode = req.body?.status_code == null ? null : Number(req.body.status_code);
    if (!agentId || !["online", "degraded", "offline", "unknown"].includes(status)) return res.status(400).json({ error: "agent_id and a valid status are required" });
    if (latency !== null && (!Number.isFinite(latency) || latency < 0)) return res.status(400).json({ error: "latency_ms must be a non-negative number" });
    if (statusCode !== null && (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599)) return res.status(400).json({ error: "status_code must be a valid HTTP status code" });

    const supabase = db();
    const { data: agent, error: agentError } = await supabase.from("agents").select("id,agent_id,owner,name,status,verification_status").eq("agent_id", agentId).maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const now = new Date().toISOString();
    const { error: healthError } = await supabase.from("agent_health_checks").insert({ agent_id: agent.id, endpoint_url: endpointUrl || null, status, latency_ms: latency === null ? null : Math.round(latency), status_code: statusCode, source: "runtime", checked_at: now, metadata: { agent_id: agent.agent_id } });
    if (healthError) throw new Error(healthError.message);

    if (endpointUrl) {
      await supabase.from("agent_endpoints").upsert({ agent_id: agent.id, endpoint_url: endpointUrl, protocol: "erc8183", status, last_checked_at: now, latency_ms: latency === null ? null : Math.round(latency), status_code: statusCode, updated_at: now }, { onConflict: "agent_id,endpoint_url,protocol" });
    }

    await supabase.from("agents").update({ status, last_health_check_at: now }).eq("id", agent.id);

    return res.status(200).json({ ok: true, agent: { id: agent.id, agent_id: agent.agent_id, status, verification_status: agent.verification_status }, heartbeat: { status, latency_ms: latency === null ? null : Math.round(latency), status_code: statusCode, checked_at: now }, note: "Heartbeat accepted from the authenticated runtime; marketplace ranking can now distinguish current liveness from stale registration." });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to record agent heartbeat" });
  }
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
    const counter = BigInt(await readContract({ address: PROVIDER_ERC8183_TESTNET.commerce, abi: PROVIDER_COMMERCE_ABI, functionName: "jobCounter" }));
    const requested = Number(req.query.scan || 32);
    const scan = Math.max(1, Math.min(Number.isFinite(requested) ? requested : 32, 100));
    const first = counter > BigInt(scan) ? counter - BigInt(scan) + 1n : 1n;
    const jobs: any[] = [];
    for (let id = counter; id >= first; id -= 1n) {
      const job = await readContract({ address: PROVIDER_ERC8183_TESTNET.commerce, abi: PROVIDER_COMMERCE_ABI, functionName: "getJob", args: [id] });
      if (job.id === 0n || job.provider.toLowerCase() !== provider.toLowerCase() || Number(job.status) !== 1) continue;
      jobs.push({ id: job.id.toString(), client: job.client, provider: job.provider, evaluator: job.evaluator, description: job.description, budget: job.budget.toString(), expiredAt: job.expiredAt.toString(), status: Number(job.status), deliverable: job.deliverable });
    }
    return res.status(200).json({ ok: true, network: "bsc-testnet", chain_id: 97, agent, provider, scanned: { from: first.toString(), to: counter.toString(), count: scan }, funded_jobs: jobs, guidance: "Re-read FUNDED status, provider, expiry and budget before accepting or submitting." });
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

    const current = String(job.status || "").toLowerCase();
    const normalizedCurrent = current === "open" ? "funded" : current;

    if (action === "submit") {
      if (current !== "in_progress") return res.status(409).json({ error: `Cannot submit a job in ${current || "unknown"} state` });
      const result = typeof payload?.result === "string" ? payload.result.trim() : "";
      const txHash = typeof payload?.tx_hash === "string" ? payload.tx_hash.trim() : "";
      if (!result || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) return res.status(400).json({ error: "submit requires result and the confirmed transaction hash" });

      const receipt = await providerPublicClient.getTransactionReceipt({ hash: txHash as Hex });
      if (receipt.status !== "success") return res.status(409).json({ error: "Provider submission transaction reverted", tx_hash: txHash });
      if (!receipt.to || receipt.to.toLowerCase() !== PROVIDER_ERC8183_TESTNET.commerce.toLowerCase()) return res.status(409).json({ error: "Submission transaction target is not the BSC Testnet Commerce contract" });

      const chain = await readContract({ address: PROVIDER_ERC8183_TESTNET.commerce, abi: PROVIDER_COMMERCE_ABI, functionName: "getJob", args: [BigInt(chainJobId)] });
      if (chain.id === 0n) return res.status(404).json({ error: "Chain job not found" });
      if (chain.provider.toLowerCase() !== provider.toLowerCase()) return res.status(403).json({ error: "Chain provider does not match the assigned provider agent" });
      if (Number(chain.expiredAt) * 1000 <= Date.now()) return res.status(409).json({ error: "Chain job has expired" });
      if (Number(chain.status) !== 2) return res.status(409).json({ error: `Chain job is not SUBMITTED; current state is ${Number(chain.status)}` });

      const expectedHash = keccak256(stringToBytes(result));
      if (chain.deliverable.toLowerCase() !== expectedHash.toLowerCase()) return res.status(409).json({ error: "On-chain deliverable hash does not match the submitted result" });

      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await supabase.from("jobs").update({ status: "submitted", deliverable: result, chain_status: "submitted", chain_tx_hash: txHash, chain_last_synced_at: now, updated_at: now }).eq("id", job.id).select("id,chain_job_id,status,provider_agent_id,mission_task_id,deliverable,chain_status,chain_tx_hash").single();
      if (updateError) throw new Error(updateError.message);

      const { data: task } = await supabase.from("mission_tasks").select("mission_id").eq("id", job.mission_task_id).maybeSingle();
      if (task?.mission_id) {
        await supabase.from("user_activity").insert({ mission_id: task.mission_id, job_id: job.id, type: "provider_submitted", title: "Agent submitted deliverable", description: `Verified BSC Testnet submission ${txHash}`, metadata: { tx_hash: txHash, chain_job_id: chainJobId, block_number: receipt.blockNumber.toString() } });
        await supabase.from("notifications").insert({ mission_id: task.mission_id, task_id: job.mission_task_id, recipient: job.client_wallet || "", kind: "provider_submitted", title: "Agent submitted deliverable", body: `Job ${chainJobId} is SUBMITTED on BSC Testnet and ready for the policy/dispute window.` });
      }
      return res.status(200).json({ ok: true, action, job: updated, chain: { id: chain.id.toString(), status: Number(chain.status), deliverable: chain.deliverable, provider: chain.provider, client: chain.client, evaluator: chain.evaluator }, tx_hash: txHash, note: "Marketplace state advanced only after a successful BSC Testnet receipt and matching on-chain deliverable hash." });
    }

    const chain = await readContract({ address: PROVIDER_ERC8183_TESTNET.commerce, abi: PROVIDER_COMMERCE_ABI, functionName: "getJob", args: [BigInt(chainJobId)] });
    if (chain.id === 0n) return res.status(404).json({ error: "Chain job not found" });
    if (chain.provider.toLowerCase() !== provider.toLowerCase()) return res.status(403).json({ error: "Chain provider does not match the assigned provider agent" });
    if (Number(chain.status) !== 1) return res.status(409).json({ error: `Chain job is not FUNDED; current state is ${Number(chain.status)}` });
    if (Number(chain.expiredAt) * 1000 <= Date.now()) return res.status(409).json({ error: "Chain job has expired" });
    if (action === "accept" && normalizedCurrent !== "funded") return res.status(409).json({ error: `Cannot accept a job in ${current || "unknown"} state` });
    if (action !== "accept" && !transition.from.includes(current)) return res.status(409).json({ error: `Cannot ${action} a job in ${current || "unknown"} state` });

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (action === "accept") updates.status = "accepted";
    if (action === "start") updates.status = "in_progress";
    const { data: updated, error: updateError } = await supabase.from("jobs").update(updates).eq("id", job.id).select("id,chain_job_id,status,provider_agent_id,mission_task_id,deliverable").single();
    if (updateError) throw new Error(updateError.message);
    if (action === "message" || action === "progress") await supabase.from("agent_messages").insert({ mission_id: null, task_id: job.mission_task_id, sender_type: "agent", sender_id: agent.id, body: String(payload?.body || payload?.message || "Provider runtime update") });
    return res.status(200).json({ ok: true, action, job: updated, chain: { id: chain.id.toString(), status: Number(chain.status), budget: chain.budget.toString(), provider: chain.provider, client: chain.client, evaluator: chain.evaluator }, note: "Provider workflow state updated only after re-verifying the live FUNDED chain job." });
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
