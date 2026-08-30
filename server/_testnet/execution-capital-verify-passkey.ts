import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, keccak256, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const KEYSTORE_ABI = [{ type: "function", name: "isValidKey", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }, { name: "keyId", type: "bytes32" }], outputs: [{ name: "valid", type: "bool" }] }] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });

function address(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function hex(value: unknown): value is Hex { return typeof value === "string" && /^0x[a-fA-F0-9]*$/.test(value); }
function object(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }

async function fetchRequestScopedCapability(sourceUrl: string, requestId: string) {
  let parsed: URL;
  try { parsed = new URL(sourceUrl); } catch { throw new Error("Stored execution capability source URL is invalid"); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Execution capability source URL must use HTTP(S)");
  const response = await fetch(parsed.toString(), { method: "GET", cache: "no-store", headers: { Accept: "application/json", "x-agentmarket-request-id": requestId } });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Unable to resolve the current Grid request-scoped capability");
  if (body?.network !== "bsc-testnet" || Number(body?.chainId) !== 97) throw new Error("Grid capability is not for BSC Testnet");
  if (body?.execution !== "altana-scoped-session" || body?.wallet_provider !== "altana" || body?.authorization_model !== "scoped_session") throw new Error("Grid capability is not an Altana scoped-session descriptor");
  if (body?.private_key_exposed !== false || body?.session_scope !== "request-scoped") throw new Error("Grid did not return a request-scoped private-key-safe capability");
  if (!address(body.session_key_address) || !hex(body.session_key_public_key)) throw new Error("Grid capability contains an invalid session key");
  if (!Array.isArray(body.allowed_targets) || !body.allowed_targets.every(address) || body.allowed_targets.length === 0) throw new Error("Grid capability contains no valid target allowlist");
  if (!Array.isArray(body.allowed_selectors) || !body.allowed_selectors.every((v) => typeof v === "string" && /^0x[a-fA-F0-9]{8}$/.test(v)) || body.allowed_selectors.length === 0) throw new Error("Grid capability contains no valid selector allowlist");
  return body;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) return res.status(401).json({ error: "Authenticated AgentMarket session required" });
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }

    const requestId = typeof req.body?.request_id === "string" ? req.body.request_id.trim() : "";
    const wallet = req.body?.user_execution_wallet;
    const sessionKeyId = req.body?.session_key_id;
    const signerAddress = req.body?.signer_address;
    const expiry = Number(req.body?.session_expiry);
    const grantTxHash = req.body?.session_grant_tx_hash;
    const renewal = req.body?.renewal === true;

    if (!requestId || !address(wallet) || !/^0x[a-fA-F0-9]{64}$/.test(String(sessionKeyId || "")) || !address(signerAddress) || !Number.isInteger(expiry)) {
      return res.status(400).json({ error: "request_id, user_execution_wallet, signer_address, 32-byte session_key_id, and session_expiry are required" });
    }
    if (grantTxHash !== undefined && grantTxHash !== null && (!hex(grantTxHash) || String(grantTxHash).length < 10)) return res.status(400).json({ error: "session_grant_tx_hash is invalid" });
    if (!auth.user.wallet_address || auth.user.wallet_address.toLowerCase() !== signerAddress.toLowerCase()) return res.status(403).json({ error: "The Altana wallet signer does not match the authenticated AgentMarket wallet" });
    if (expiry <= Math.floor(Date.now() / 1000)) return res.status(400).json({ error: "Session expiry is already in the past" });

    const supabase = serverClient();
    const { data: request, error: requestError } = await supabase.from("execution_capital_requests").select("*").eq("id", requestId).maybeSingle();
    if (requestError) return res.status(500).json({ error: requestError.message });
    if (!request) return res.status(404).json({ error: "Execution capital request not found" });
    if (request.status === "authorized" && !renewal) return res.status(200).json({ ok: true, authorized: true, request });
    if (!["requested", "authorized"].includes(String(request.status))) return res.status(409).json({ error: `Execution capital request is already ${request.status}` });

    const { data: job, error: jobError } = await supabase.from("jobs").select("id,client_wallet,mission_task_id,chain_job_id").eq("id", request.job_id).maybeSingle();
    if (jobError) return res.status(500).json({ error: jobError.message });
    if (!job || !auth.user.wallet_address || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "You do not own this execution-capital request" });

    const evidence = object(request.evidence);
    const storedCapability = object(evidence.execution_capability);
    const sourceUrl = typeof storedCapability.source_url === "string" ? storedCapability.source_url.trim() : "";
    if (!sourceUrl) return res.status(409).json({ error: "The execution-capital request has no stored Grid capability source URL" });

    const capability = await fetchRequestScopedCapability(sourceUrl, requestId);
    const expectedSessionKeyId = keccak256(capability.session_key_public_key as Hex);
    if (String(sessionKeyId).toLowerCase() !== expectedSessionKeyId.toLowerCase()) return res.status(409).json({ error: "The granted session key ID does not match the current Grid request-scoped public session key" });
    if (String(capability.session_key_address).toLowerCase() !== String(storedCapability.session_key_address || "").toLowerCase() && request.status === "authorized" && !renewal) return res.status(409).json({ error: "Stored Grid session is stale; renewal is required before execution" });

    const keyStore = (process.env.ALTANA_KEYSTORE_ADDRESS || "") as Address;
    if (!address(keyStore)) return res.status(503).json({ error: "ALTANA_KEYSTORE_ADDRESS is not configured on the server; onchain authorization cannot be verified yet" });
    const valid = await publicClient.readContract({ address: keyStore, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [wallet, sessionKeyId] });
    if (!valid) return res.status(409).json({ error: "Altana KeyStore does not currently report this session key as valid", authorized: false });

    const now = new Date().toISOString();
    const capabilityEvidence = {
      ...capability,
      source_url: sourceUrl,
      endpoint_id: typeof storedCapability.endpoint_id === "string" ? storedCapability.endpoint_id : "declared_metadata",
      endpoint_status: typeof storedCapability.endpoint_status === "string" ? storedCapability.endpoint_status : null,
      fetched_at: now,
      independently_authorized: true,
    };
    const nextEvidence = {
      ...evidence,
      execution_capability: capabilityEvidence,
      authorization_source: "altana_keystore_isValidKey",
      authorization_chain_id: 97,
      session_expiry: expiry,
      verified_at: now,
      signer_address: signerAddress,
      session_grant_tx_hash: grantTxHash || request.session_grant_tx_hash || null,
      authorization_renewal: renewal,
    };
    const updateQuery = supabase.from("execution_capital_requests").update({
      user_execution_wallet: wallet,
      agent_session_key: capability.session_key_address,
      session_key_id: sessionKeyId,
      capital_authorized: request.capital_requested,
      authorization_verified_at: now,
      authorized_at: now,
      session_grant_tx_hash: grantTxHash || null,
      status: "authorized",
      evidence: nextEvidence,
      updated_at: now,
    }).eq("id", requestId);
    if (!renewal) updateQuery.eq("status", "requested");
    const { data: updated, error: updateError } = await updateQuery.select("*").maybeSingle();
    if (updateError) return res.status(500).json({ error: updateError.message });
    if (!updated) {
      const { data: current } = await supabase.from("execution_capital_requests").select("*").eq("id", requestId).maybeSingle();
      return res.status(200).json({ ok: true, authorized: current?.status === "authorized", request: current });
    }
    return res.status(200).json({ ok: true, authorized: true, request: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution-capital authorization verification failed";
    return res.status(409).json({ error: message });
  }
}
