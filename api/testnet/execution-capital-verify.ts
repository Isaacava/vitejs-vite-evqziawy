import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const KEYSTORE = (process.env.ALTANA_KEYSTORE_ADDRESS || "") as Address;
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
  chain: bscTestnet,
  transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com"),
});

function address(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function hex32(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!address(KEYSTORE)) return res.status(503).json({ error: "ALTANA_KEYSTORE_ADDRESS is not configured on the server; onchain authorization cannot be verified yet" });

    const requestId = typeof req.body?.request_id === "string" ? req.body.request_id.trim() : "";
    const wallet = req.body?.user_execution_wallet;
    const sessionKeyId = req.body?.session_key_id;
    const signerAddress = req.body?.signer_address;
    const expiry = Number(req.body?.session_expiry);
    if (!requestId || !address(wallet) || !hex32(sessionKeyId) || !address(signerAddress) || !Number.isInteger(expiry)) return res.status(400).json({ error: "request_id, user_execution_wallet, signer_address, 32-byte session_key_id, and session_expiry are required" });
    if (!auth.user.wallet_address || auth.user.wallet_address.toLowerCase() !== signerAddress.toLowerCase()) return res.status(403).json({ error: "The Altana wallet signer does not match the authenticated AgentMarket wallet" });
    if (expiry <= Math.floor(Date.now() / 1000)) return res.status(400).json({ error: "Session expiry is already in the past" });

    const supabase = serverClient();
    const { data: request, error: requestError } = await supabase.from("execution_capital_requests").select("*").eq("id", requestId).maybeSingle();
    if (requestError) return res.status(500).json({ error: requestError.message });
    if (!request) return res.status(404).json({ error: "Execution capital request not found" });

    const { data: job, error: jobError } = await supabase.from("jobs").select("id,mission_task_id,client_wallet,chain_job_id").eq("id", request.job_id).maybeSingle();
    if (jobError) return res.status(500).json({ error: jobError.message });
    if (!job || !auth.user.wallet_address || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "You do not own this execution-capital request" });

    const valid = await publicClient.readContract({
      address: KEYSTORE,
      abi: KEYSTORE_ABI,
      functionName: "isValidKey",
      args: [wallet, sessionKeyId],
    });
    if (!valid) return res.status(409).json({ error: "Altana KeyStore does not currently report this session key as valid", authorized: false });

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase.from("execution_capital_requests").update({
      user_execution_wallet: wallet,
      session_key_id: sessionKeyId,
      capital_authorized: request.capital_requested,
      spend_cap: request.capital_requested,
      session_expires_at: new Date(expiry * 1000).toISOString(),
      authorization_verified_at: now,
      authorized_at: now,
      status: "authorized",
      evidence: {
        ...(request.evidence || {}),
        authorization_source: "altana_keystore_isValidKey",
        authorization_chain_id: 97,
        verified_at: now,
      },
      updated_at: now,
    }).eq("id", requestId).eq("status", "requested").select("*").maybeSingle();
    if (updateError) return res.status(500).json({ error: updateError.message });
    if (!updated) {
      const { data: current } = await supabase.from("execution_capital_requests").select("*").eq("id", requestId).maybeSingle();
      return res.status(200).json({ ok: true, authorized: current?.status === "authorized", request: current });
    }

    return res.status(200).json({ ok: true, authorized: true, request: updated });
  } catch (error) {
    console.error("execution-capital-verify failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected server error" });
  }
}
