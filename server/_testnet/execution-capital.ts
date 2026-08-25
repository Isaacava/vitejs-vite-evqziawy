import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";

const TESTNET_CHAIN_ID = 97;
const MAX_CAPITAL = 1000;
const MAX_DURATION_SECONDS = 86_400;

function validAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function parseFiniteNumber(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be a positive number.`);
  return parsed;
}

function parseDuration(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_DURATION_SECONDS) {
    throw new Error(`duration_seconds must be an integer between 1 and ${MAX_DURATION_SECONDS}.`);
  }
  return parsed;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });
  if (!validAddress(auth.user.wallet_address)) return res.status(401).json({ error: "Authenticated user has no valid Testnet wallet" });

  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const jobId = typeof body.job_id === "string" ? body.job_id.trim() : "";
  const purpose = typeof body.purpose === "string" ? body.purpose.trim() : "";
  if (!jobId) return res.status(400).json({ error: "job_id is required" });
  if (!purpose) return res.status(400).json({ error: "purpose is required" });

  try {
    const capitalRequested = parseFiniteNumber(body.capital_requested, "capital_requested");
    if (capitalRequested > MAX_CAPITAL) throw new Error(`capital_requested exceeds the Testnet feature guardrail of ${MAX_CAPITAL}.`);
    const durationSeconds = parseDuration(body.duration_seconds);

    const supabase = serverClient();
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id,status,chain_status,chain_job_id,client_wallet,provider_agent_id,mission_task_id")
      .eq("id", jobId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return res.status(404).json({ error: "Marketplace job not found" });

    if (String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ error: "This execution-capital request does not belong to the connected wallet" });
    }

    if (String(job.chain_status || "").toLowerCase() !== "funded" || !job.chain_job_id) {
      return res.status(409).json({ error: "Execution capital can only be requested after the ERC-8183 job is confirmed FUNDED on BSC Testnet" });
    }

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id,agent_id,owner,metadata")
      .eq("id", job.provider_agent_id)
      .maybeSingle();
    if (agentError) throw new Error(agentError.message);
    if (!agent) return res.status(404).json({ error: "Provider agent record not found" });

    const metadata = agent.metadata && typeof agent.metadata === "object"
      ? agent.metadata as Record<string, unknown>
      : {};
    const execution = metadata.execution && typeof metadata.execution === "object"
      ? metadata.execution as Record<string, unknown>
      : {};
    const walletProvider = String(execution.wallet_provider || "").toLowerCase();
    const authority = String(execution.transaction_authority || "").toLowerCase();

    if (walletProvider !== "altana" || authority !== "scoped_session") {
      return res.status(409).json({
        error: "This provider is not eligible for AgentMarket execution capital. Only an explicitly declared Altana scoped-session agent can request user execution capital.",
        wallet_provider: walletProvider || "unknown",
        transaction_authority: authority || "unknown",
      });
    }

    const { data: existing, error: existingError } = await supabase
      .from("execution_capital_requests")
      .select("id,status,capital_requested,duration_seconds,wallet_provider,authorization_model,user_execution_wallet,session_key_id,authorization_verified_at")
      .eq("job_id", job.id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) return res.status(200).json({ ok: true, network: "bsc-testnet", chain_id: TESTNET_CHAIN_ID, request: existing, reused: true });

    const { data: created, error: createError } = await supabase
      .from("execution_capital_requests")
      .insert({
        job_id: job.id,
        requester_wallet: auth.user.wallet_address,
        wallet_provider: "altana",
        authorization_model: "scoped_session",
        capital_requested: String(capitalRequested),
        purpose,
        duration_seconds: durationSeconds,
        status: "requested",
      })
      .select("id,job_id,requester_wallet,user_execution_wallet,agent_session_key,session_key_id,wallet_provider,authorization_model,capital_requested,capital_authorized,capital_deployed,capital_returned,ending_assets,realized_pnl,unrealized_pnl,purpose,duration_seconds,status,authorization_verified_at,session_grant_tx_hash,session_revoke_tx_hash,evidence,requested_at,authorized_at,activated_at,exit_pending_at,settled_at,revoked_at,expired_at,created_at,updated_at")
      .single();
    if (createError) throw new Error(createError.message);

    return res.status(201).json({ ok: true, network: "bsc-testnet", chain_id: TESTNET_CHAIN_ID, request: created });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create execution-capital request" });
  }
}
