import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, keccak256, type Address, type Hex } from "viem";
import { getAuthenticatedUser, serverClient } from "../_auth.js";
import { BSC_CHAIN, BSC_RPC_URL } from "../../src/lib/network.js";

const KEYSTORE_ABI = [{
  type: "function",
  name: "isValidKey",
  stateMutability: "view",
  inputs: [
    { name: "wallet", type: "address" },
    { name: "keyId", type: "bytes32" },
  ],
  outputs: [{ name: "valid", type: "bool" }],
}] as const;

const publicClient = createPublicClient({
  chain: BSC_CHAIN,
  transport: http(process.env.BSC_TESTNET_RPC_URL || BSC_RPC_URL),
});

function address(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function hex32(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function evidenceObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    if (!auth.user.wallet_address || !address(auth.user.wallet_address)) {
      return res.status(403).json({ error: "Authenticated AgentMarket wallet is unavailable" });
    }

    const requestId = typeof req.body?.request_id === "string" ? req.body.request_id.trim() : "";
    const userExecutionWallet = req.body?.user_execution_wallet;
    const sessionKeyId = req.body?.session_key_id;
    const sessionExpiry = Number(req.body?.session_expiry);
    const grantTxHash = req.body?.session_grant_tx_hash;

    if (!requestId || !address(userExecutionWallet) || !hex32(sessionKeyId) || !Number.isInteger(sessionExpiry)) {
      return res.status(400).json({
        error: "request_id, user_execution_wallet, 32-byte session_key_id, and session_expiry are required",
      });
    }

    if (grantTxHash !== undefined && grantTxHash !== null && (typeof grantTxHash !== "string" || !grantTxHash.startsWith("0x"))) {
      return res.status(400).json({ error: "session_grant_tx_hash is invalid" });
    }

    if (sessionExpiry <= Math.floor(Date.now() / 1000)) {
      return res.status(400).json({ error: "Session expiry is already in the past" });
    }

    const supabase = serverClient();
    const { data: request, error: requestError } = await supabase
      .from("execution_capital_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();
    if (requestError) return res.status(500).json({ error: requestError.message });
    if (!request) return res.status(404).json({ error: "Execution capital request not found" });
    if (String(request.requester_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) {
      return res.status(403).json({ error: "You do not own this execution-capital request" });
    }
    if (request.status === "authorized") {
      return res.status(200).json({ ok: true, authorized: true, request });
    }
    if (request.status !== "requested") {
      return res.status(409).json({ error: `Execution capital request is already ${request.status}` });
    }

    const capability = evidenceObject(request.evidence).execution_capability;
    if (!capability || typeof capability !== "object") {
      return res.status(409).json({ error: "The request has no stored execution capability descriptor" });
    }
    const capabilityObject = capability as Record<string, unknown>;
    const sessionAddress = capabilityObject.session_key_address;
    const sessionPublicKey = capabilityObject.session_key_public_key;
    const derivedSessionKeyId = typeof sessionPublicKey === "string" && sessionPublicKey.startsWith("0x")
      ? keccak256(sessionPublicKey as Hex)
      : null;

    if (!address(sessionAddress) || !derivedSessionKeyId) {
      return res.status(409).json({ error: "The stored execution capability descriptor is invalid" });
    }
    if (request.agent_session_key && String(request.agent_session_key).toLowerCase() !== sessionAddress.toLowerCase()) {
      return res.status(409).json({ error: "Stored provider session key does not match the capability descriptor" });
    }
    if (sessionKeyId.toLowerCase() !== derivedSessionKeyId.toLowerCase()) {
      return res.status(409).json({ error: "Granted session key ID does not match the provider public session key" });
    }

    const keyStore = process.env.ALTANA_KEYSTORE_ADDRESS as Address | undefined;
    if (!keyStore || !address(keyStore)) {
      return res.status(503).json({ error: "ALTANA_KEYSTORE_ADDRESS is not configured on the server" });
    }

    const valid = await publicClient.readContract({
      address: keyStore,
      abi: KEYSTORE_ABI,
      functionName: "isValidKey",
      args: [userExecutionWallet, sessionKeyId],
    });

    if (!valid) {
      return res.status(409).json({
        ok: false,
        authorized: false,
        error: "Altana KeyStore does not currently report this session key as valid for the Altana execution wallet",
      });
    }

    const now = new Date().toISOString();
    const nextEvidence = {
      ...evidenceObject(request.evidence),
      authorization_source: "altana_keystore_isValidKey",
      authorization_chain_id: 97,
      authorization_wallet: userExecutionWallet,
      session_expiry: sessionExpiry,
      verified_at: now,
      session_grant_tx_hash: grantTxHash || request.session_grant_tx_hash || null,
      independently_authorized: true,
    };

    const { data: updated, error: updateError } = await supabase
      .from("execution_capital_requests")
      .update({
        user_execution_wallet: userExecutionWallet,
        agent_session_key: sessionAddress,
        session_key_id: sessionKeyId,
        capital_authorized: request.capital_requested,
        authorization_verified_at: now,
        authorized_at: now,
        session_grant_tx_hash: grantTxHash || null,
        status: "authorized",
        evidence: nextEvidence,
        updated_at: now,
      })
      .eq("id", requestId)
      .eq("status", "requested")
      .select("*")
      .maybeSingle();

    if (updateError) return res.status(500).json({ error: updateError.message });
    if (!updated) {
      const { data: current } = await supabase
        .from("execution_capital_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();
      return res.status(200).json({ ok: true, authorized: current?.status === "authorized", request: current });
    }

    return res.status(200).json({ ok: true, authorized: true, request: updated });
  } catch (error) {
    console.error("Passkey execution-capital verification failed", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Execution-capital authorization verification failed",
    });
  }
}
