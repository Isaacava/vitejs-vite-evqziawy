import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuthenticatedUser } from "../../src/server/authHandlers.js";
import { serverClient } from "../../src/server/authHandlers.js";

const GRID_AGENT_URL = "https://grid-agent-testnet-v4-production.up.railway.app";
const SHARED_SECRET = process.env.GRID_EXECUTION_SHARED_SECRET || "";

function validHash(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function object(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

async function fetchReceipt(txHash: string) {
  if (!SHARED_SECRET) throw new Error("Grid execution receipt verification is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${GRID_AGENT_URL}/erc8183/receipt/${txHash}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${SHARED_SECRET}`,
      },
      signal: controller.signal,
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error || body?.detail || "Grid execution receipt observer failed");
    }

    return body?.result ?? body;
  } catch (cause) {
    const detail = cause instanceof Error && cause.name === "AbortError"
      ? "Grid execution receipt observer timed out"
      : cause instanceof Error
        ? cause.message
        : "Grid execution receipt observer unavailable";
    throw new Error(detail);
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "Authentication required" });

  const txHash = typeof req.query.tx_hash === "string"
    ? req.query.tx_hash.trim()
    : typeof req.body?.tx_hash === "string"
      ? req.body.tx_hash.trim()
      : "";

  if (!validHash(txHash)) {
    return res.status(400).json({ error: "tx_hash must be a 32-byte transaction hash" });
  }

  try {
    const receipt = await fetchReceipt(txHash);
    const normalized = {
      chain_id: 97,
      transaction_hash: txHash,
      ...(object(receipt)),
    };

    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        network: "bsc-testnet",
        chain_id: 97,
        transaction_hash: txHash,
        receipt: normalized,
      });
    }

    const requestId = typeof req.body?.request_id === "string" ? req.body.request_id.trim() : "";
    if (!requestId) return res.status(400).json({ error: "request_id is required when confirming a receipt" });

    const supabase = serverClient();
    const { data: request, error: requestError } = await supabase
      .from("execution_capital_requests")
      .select("id,job_id,requester_wallet,status,evidence")
      .eq("id", requestId)
      .maybeSingle();
    if (requestError) throw new Error(requestError.message);
    if (!request) return res.status(404).json({ error: "Execution capital request not found" });
    if (String(request.requester_wallet).toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ error: "You do not own this execution capital request" });
    }
    if (request.status !== "authorized" && request.status !== "active") {
      return res.status(409).json({ error: `Receipt confirmation requires an authorized or active request; current status is ${request.status}` });
    }

    const evidenceRoot = object(request.evidence);
    const lastExecution = object(evidenceRoot.last_execution);
    if (String(lastExecution.transaction_hash || "").toLowerCase() !== txHash.toLowerCase()) {
      return res.status(409).json({ error: "Transaction hash does not match the request's recorded execution" });
    }

    const now = new Date().toISOString();
    const mergedExecution = {
      ...lastExecution,
      transaction_hash: txHash,
      receipt: normalized,
      receipt_verified: true,
      receipt_verified_at: now,
    };
    const nextEvidence = {
      ...evidenceRoot,
      last_execution: mergedExecution,
      execution_receipt_verification: {
        method: "grid_testnet_receipt_observer",
        chain_id: 97,
        transaction_hash: txHash,
        verified_at: now,
      },
    };

    const { data: updatedRequest, error: updateError } = await supabase
      .from("execution_capital_requests")
      .update({
        evidence: nextEvidence,
        updated_at: now,
      })
      .eq("id", request.id)
      .eq("requester_wallet", auth.user.wallet_address)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);

    const { data: executionEvidence, error: evidenceReadError } = await supabase
      .from("execution_capital_execution_evidence")
      .select("*")
      .eq("execution_capital_request_id", request.id)
      .eq("transaction_hash", txHash)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (evidenceReadError) throw new Error(evidenceReadError.message);

    if (executionEvidence) {
      const { error: evidenceUpdateError } = await supabase
        .from("execution_capital_execution_evidence")
        .update({
          receipt: normalized,
          receipt_verified: true,
        })
        .eq("id", executionEvidence.id);
      if (evidenceUpdateError) throw new Error(evidenceUpdateError.message);
    }

    return res.status(200).json({
      ok: true,
      confirmed: true,
      network: "bsc-testnet",
      chain_id: 97,
      transaction_hash: txHash,
      receipt: normalized,
      request: updatedRequest,
      execution_evidence: executionEvidence ? {
        ...executionEvidence,
        receipt: normalized,
        receipt_verified: true,
      } : null,
      note: "Testnet receipt independently observed and persisted as execution evidence. Capital deployed/returned and P&L remain unchanged until independent accounting evidence exists.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify Testnet execution receipt";
    const status = /not configured|not found|does not own|requires|current status|does not match/i.test(message) ? 409 : 503;
    return res.status(status).json({ error: message });
  }
}
