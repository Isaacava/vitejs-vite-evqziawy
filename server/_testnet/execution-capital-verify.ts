import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Address, Hex } from "viem";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";
import { resolveExecutionAuthorizationAdapter } from "./executionAuthorizationAdapter.js";

function validAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function validBytes32(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
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
  const requestId = typeof body.request_id === "string" ? body.request_id.trim() : "";
  const sessionKeyId = body.session_key_id;
  const walletAddress = body.user_execution_wallet;
  const sessionExpiry = Number(body.session_expiry || 0);

  if (!requestId) return res.status(400).json({ error: "request_id is required" });
  if (!validBytes32(sessionKeyId)) return res.status(400).json({ error: "session_key_id must be bytes32" });
  if (!validAddress(walletAddress)) return res.status(400).json({ error: "user_execution_wallet must be a valid address" });
  if (!Number.isInteger(sessionExpiry) || sessionExpiry <= Math.floor(Date.now() / 1000)) {
    return res.status(400).json({ error: "session_expiry must be a future Unix timestamp" });
  }

  try {
    const supabase = serverClient();
    const { data: request, error: requestError } = await supabase
      .from("execution_capital_requests")
      .select("id,job_id,requester_wallet,wallet_provider,authorization_model,capital_requested,status,user_execution_wallet,agent_session_key,session_key_id,session_expiry,authorization_verified_at")
      .eq("id", requestId)
      .maybeSingle();
    if (requestError) throw new Error(requestError.message);
    if (!request) return res.status(404).json({ error: "Execution-capital request not found" });
    if (String(request.requester_wallet).toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ error: "Execution-capital request does not belong to this wallet" });
    }
    if (request.status !== "requested" && request.status !== "authorized") {
      return res.status(409).json({ error: `Execution-capital request is already ${request.status}` });
    }
    if (request.status === "authorized") {
      return res.status(200).json({ ok: true, authorized: true, request });
    }
    if (String(request.user_execution_wallet || "").toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(409).json({ error: "Supplied execution wallet does not match the wallet recorded on the execution-capital request" });
    }
    if (!request.session_key_id || request.session_key_id.toLowerCase() !== String(sessionKeyId).toLowerCase()) {
      return res.status(409).json({ error: "Supabase request does not match the session key being verified" });
    }

    const authorizationAdapter = resolveExecutionAuthorizationAdapter({
      wallet_provider: String(request.wallet_provider || ""),
      authorization_model: String(request.authorization_model || ""),
      wallet: walletAddress,
      session_key_id: sessionKeyId as Hex,
      session_expiry: sessionExpiry,
    });

    if (!authorizationAdapter) {
      return res.status(409).json({
        ok: false,
        authorized: false,
        network: "bsc-testnet",
        chain_id: 97,
        request_id: request.id,
        wallet_provider: request.wallet_provider,
        authorization_model: request.authorization_model,
        error: "No compatible execution-authorization adapter is installed for the provider-declared authorization model",
      });
    }

    const verification = await authorizationAdapter.verify({
      wallet_provider: String(request.wallet_provider || ""),
      authorization_model: String(request.authorization_model || ""),
      wallet: walletAddress,
      session_key_id: sessionKeyId as Hex,
      session_expiry: sessionExpiry,
    });

    if (!verification.authorized) {
      return res.status(409).json({
        ok: false,
        authorized: false,
        network: "bsc-testnet",
        chain_id: 97,
        request_id: request.id,
        user_execution_wallet: walletAddress,
        session_key_id: sessionKeyId,
        ...verification.details,
      });
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("execution_capital_requests")
      .update({
        user_execution_wallet: walletAddress,
        session_key_id: sessionKeyId,
        session_expiry: sessionExpiry,
        capital_authorized: request.capital_requested,
        status: "authorized",
        authorization_verified_at: now,
        authorized_at: now,
        updated_at: now,
      })
      .eq("id", request.id)
      .eq("requester_wallet", auth.user.wallet_address)
      .select("id,job_id,user_execution_wallet,agent_session_key,session_key_id,capital_requested,capital_authorized,capital_deployed,capital_returned,ending_assets,realized_pnl,unrealized_pnl,purpose,duration_seconds,status,authorization_verified_at,session_grant_tx_hash,session_revoke_tx_hash,session_expiry,allowed_calls,evidence,requested_at,authorized_at,activated_at,exit_pending_at,settled_at,revoked_at,expired_at,updated_at")
      .single();
    if (updateError) throw new Error(updateError.message);

    return res.status(200).json({
      ok: true,
      authorized: true,
      network: "bsc-testnet",
      chain_id: 97,
      request: updated,
      verification: {
        method: verification.method,
        ...verification.details,
        checked_at: now,
        session_expiry: sessionExpiry,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to verify execution authorization" });
  }
}
