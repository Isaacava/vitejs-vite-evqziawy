import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../../src/server/authHandlers.js";

const KEYSTORE = "0x6b8361C29d05D498b1a12B54A37310f94171E94A" as Address;
const KEYSTORE_ABI = [{
  name: "isValidKey",
  type: "function",
  stateMutability: "view",
  inputs: [
    { name: "user", type: "address" },
    { name: "keyId", type: "bytes32" },
  ],
  outputs: [{ type: "bool" }],
}] as const;

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http("https://bsc-testnet-rpc.publicnode.com"),
});

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
  if (walletAddress.toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
    return res.status(403).json({ error: "user_execution_wallet does not match the authenticated wallet" });
  }
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
    if (request.wallet_provider !== "altana" || request.authorization_model !== "scoped_session") {
      return res.status(409).json({ error: "Execution-capital request is not an Altana scoped-session request" });
    }
    if (!request.session_key_id || request.session_key_id.toLowerCase() !== sessionKeyId.toLowerCase()) {
      return res.status(409).json({ error: "Supabase request does not match the session key being verified" });
    }

    const valid = await publicClient.readContract({
      address: KEYSTORE,
      abi: KEYSTORE_ABI,
      functionName: "isValidKey",
      args: [walletAddress, sessionKeyId],
    });

    if (!valid) {
      return res.status(409).json({
        ok: false,
        authorized: false,
        network: "bsc-testnet",
        chain_id: 97,
        request_id: request.id,
        user_execution_wallet: walletAddress,
        session_key_id: sessionKeyId,
        error: "Altana KeyStore reports the session key is not currently valid for this user wallet.",
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
        method: "altana_keystore_isValidKey",
        keystore: KEYSTORE,
        wallet: walletAddress,
        key_id: sessionKeyId,
        checked_at: now,
        session_expiry: sessionExpiry,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to verify Altana execution session" });
  }
}
