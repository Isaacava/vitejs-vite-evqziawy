import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, keccak256, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { getAuthenticatedUser, serverClient } from "../_auth.js";

const KEYSTORE_ABI = [{ type: "function", name: "isValidKey", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }, { name: "keyId", type: "bytes32" }], outputs: [{ name: "valid", type: "bool" }] }] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });

function address(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function hex(value: unknown): value is Hex { return typeof value === "string" && /^0x[a-fA-F0-9]*$/.test(value); }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }

async function deliverToProvider(jobId: number, agentId: string, authorization: Record<string, unknown>, supabase: ReturnType<typeof serverClient>): Promise<string> {
  const { data: agent, error: agentError } = await supabase.from("agents").select("id,metadata").eq("id", agentId).maybeSingle();
  if (agentError) throw new Error(agentError.message);
  if (!agent) throw new Error("Provider agent not found for authorization delivery");
  const metadata = object(agent.metadata);
  const execution = object(metadata.execution);
  const { data: endpoints, error: endpointError } = await supabase.from("agent_endpoints").select("endpoint_url").eq("agent_id", String(agent.id)).limit(20);
  if (endpointError) throw new Error(endpointError.message);
  const bases = [...new Set([
    metadata.execution_authorization_url,
    execution.execution_authorization_url,
    ...(endpoints || []).map((entry) => String(entry.endpoint_url || "").trim()).filter(Boolean),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.replace(/\/+$/, "")))];
  const candidates = bases.flatMap((base) => base.endsWith("/erc8183") ? [`${base}/job/${jobId}/execution-authorization`] : [`${base}/job/${jobId}/execution-authorization`, `${base}/erc8183/job/${jobId}/execution-authorization`]);
  for (const candidate of [...new Set(candidates)]) {
    try {
      const response = await fetch(candidate, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ execution_authorization: authorization }),
      });
      if (!response.ok) continue;
      const body = object(await response.json());
      if (body.accepted === true) return candidate;
    } catch { /* Try the next declared provider endpoint. */ }
  }
  throw new Error("Verified authorization could not be delivered to the provider's ERC-8183 execution endpoint");
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
    const capitalFundingTxHash = req.body?.capital_funding_tx_hash;
    const allowanceTxHash = req.body?.allowance_tx_hash;
    const allowanceSpender = req.body?.allowance_spender;
    const capitalToken = req.body?.capital_token;
    const capitalAmountRaw = req.body?.capital_amount_raw;
    const renewal = req.body?.renewal === true;

    if (!requestId || !address(wallet) || !/^0x[a-fA-F0-9]{64}$/.test(String(sessionKeyId || "")) || !address(signerAddress) || !Number.isInteger(expiry)) return res.status(400).json({ error: "request_id, user_execution_wallet, signer_address, 32-byte session_key_id, and session_expiry are required" });
    if (grantTxHash !== undefined && grantTxHash !== null && grantTxHash !== "" && !hex(grantTxHash)) return res.status(400).json({ error: "session_grant_tx_hash is invalid" });
    for (const [name, value] of [["capital_funding_tx_hash", capitalFundingTxHash], ["allowance_tx_hash", allowanceTxHash]] as const) if (value !== undefined && value !== null && value !== "" && !hex(value)) return res.status(400).json({ error: `${name} is invalid` });
    if (capitalToken !== undefined && capitalToken !== null && capitalToken !== "" && !address(capitalToken)) return res.status(400).json({ error: "capital_token is invalid" });
    if (capitalAmountRaw !== undefined && capitalAmountRaw !== null && capitalAmountRaw !== "" && (!/^\d+$/.test(String(capitalAmountRaw)) || BigInt(String(capitalAmountRaw)) <= 0n)) return res.status(400).json({ error: "capital_amount_raw is invalid" });
    if (allowanceSpender !== undefined && allowanceSpender !== null && allowanceSpender !== "" && !address(allowanceSpender)) return res.status(400).json({ error: "allowance_spender is invalid" });
    if (expiry <= Math.floor(Date.now() / 1000)) return res.status(400).json({ error: "Session expiry is already in the past" });

    const supabase = serverClient();
    const { data: request, error: requestError } = await supabase.from("execution_capital_requests").select("*").eq("id", requestId).maybeSingle();
    if (requestError) return res.status(500).json({ error: requestError.message });
    if (!request) return res.status(404).json({ error: "Execution authorization request not found" });
    if (!["requested", "authorized"].includes(String(request.status))) return res.status(409).json({ error: `Execution authorization request is already ${request.status}` });

    const { data: job, error: jobError } = await supabase.from("jobs").select("id,client_wallet,mission_task_id,chain_job_id").eq("id", request.job_id).maybeSingle();
    if (jobError) return res.status(500).json({ error: jobError.message });
    if (!job || !auth.user.wallet_address || String(job.client_wallet || "").toLowerCase() !== auth.user.wallet_address.toLowerCase()) return res.status(403).json({ error: "You do not own this execution authorization request" });
    if (!job.chain_job_id) return res.status(409).json({ error: "The execution authorization request is not attached to an ERC-8183 chain job" });
    if (request.status === "authorized" && !renewal) return res.status(200).json({ ok: true, authorized: true, request });

    const { data: persistentWallet, error: persistentWalletError } = await supabase.from("altana_execution_wallets").select("wallet_address,signer_address,chain_id,wallet_provider,authorization_model,status").eq("user_id", auth.user.id).maybeSingle();
    if (persistentWalletError) return res.status(500).json({ error: persistentWalletError.message });
    if (!persistentWallet) return res.status(409).json({ error: "No persistent Altana execution wallet is registered for this AgentMarket account" });
    if (persistentWallet.status !== "active") return res.status(409).json({ error: `The persistent Altana execution wallet is ${persistentWallet.status} and cannot authorize a new session` });
    if (String(persistentWallet.wallet_address).toLowerCase() !== String(wallet).toLowerCase()) return res.status(403).json({ error: "The Altana execution wallet does not belong to the authenticated AgentMarket account" });
    const storedSigner = typeof persistentWallet.signer_address === "string" ? persistentWallet.signer_address : "";
    if (storedSigner && !/^0x0{40}$/i.test(storedSigner) && storedSigner.toLowerCase() !== String(signerAddress).toLowerCase()) return res.status(403).json({ error: "The Altana Passkey signer does not match the signer registered for this AgentMarket account" });
    if (Number(persistentWallet.chain_id) !== 97 || String(persistentWallet.wallet_provider).toLowerCase() !== "altana" || String(persistentWallet.authorization_model).toLowerCase() !== "passkey") return res.status(409).json({ error: "The registered execution wallet is not a valid BSC Testnet Altana Passkey wallet" });

    const evidence = object(request.evidence);
    const capability = object(evidence.execution_capability);
    if (!address(capability.session_key_address) || !hex(capability.session_key_public_key)) return res.status(409).json({ error: "The authorization request does not contain a valid agent session-key capability" });
    if (String(request.agent_session_key || "").toLowerCase() !== String(capability.session_key_address).toLowerCase()) return res.status(409).json({ error: "The authorization request session key does not match the stored agent capability" });
    if (String(capability.network || "").toLowerCase() !== "bsc-testnet" || Number(capability.chain_id ?? capability.chainId) !== 97) return res.status(409).json({ error: "The agent capability is not for BSC Testnet" });
    if (String(capability.execution || "") !== "altana-scoped-session" || String(capability.wallet_provider || "") !== "altana" || String(capability.authorization_model || "") !== "scoped_session") return res.status(409).json({ error: "The agent capability does not use the required Altana scoped-session model" });
    if (capability.private_key_exposed !== false) return res.status(409).json({ error: "The agent capability must not expose a private key" });
    const expectedSessionKeyId = keccak256(capability.session_key_public_key as Hex);
    if (String(sessionKeyId).toLowerCase() !== expectedSessionKeyId.toLowerCase()) return res.status(409).json({ error: "The granted session key ID does not match the agent's advertised public session key" });

    const keyStore = (process.env.ALTANA_KEYSTORE_ADDRESS || "") as Address;
    if (!address(keyStore)) return res.status(503).json({ error: "ALTANA_KEYSTORE_ADDRESS is not configured on the server; onchain authorization cannot be verified yet" });
    const valid = await publicClient.readContract({ address: keyStore, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [wallet, sessionKeyId] });
    if (!valid) return res.status(409).json({ error: "Altana KeyStore does not currently report this session key as valid", authorized: false });

    const now = new Date().toISOString();
    const nextEvidence = {
      ...evidence,
      authorization_source: "altana_keystore_isValidKey",
      authorization_chain_id: 97,
      session_expiry: expiry,
      verified_at: now,
      signer_address: signerAddress,
      session_grant_tx_hash: grantTxHash || request.session_grant_tx_hash || null,
      capital_funding_tx_hash: capitalFundingTxHash || evidence.capital_funding_tx_hash || null,
      allowance_tx_hash: allowanceTxHash || evidence.allowance_tx_hash || null,
      allowance_spender: allowanceSpender || evidence.allowance_spender || null,
      capital_token: capitalToken || evidence.capital_token || null,
      capital_amount_raw: capitalAmountRaw || evidence.capital_amount_raw || null,
      authorization_renewal: renewal,
    };
    const updateQuery = supabase.from("execution_capital_requests").update({ user_execution_wallet: wallet, agent_session_key: capability.session_key_address, session_key_id: sessionKeyId, session_expires_at: new Date(expiry * 1000).toISOString(), capital_authorized: request.capital_requested, authorization_verified_at: now, authorized_at: now, session_grant_tx_hash: grantTxHash || request.session_grant_tx_hash || null, status: "authorized", evidence: nextEvidence, updated_at: now }).eq("id", requestId);
    if (!renewal) updateQuery.eq("status", "requested");
    const { data: updated, error: updateError } = await updateQuery.select("*").maybeSingle();
    if (updateError) return res.status(500).json({ error: updateError.message });
    const authorizedRequest = updated || (await supabase.from("execution_capital_requests").select("*").eq("id", requestId).maybeSingle()).data;
    if (!authorizedRequest || authorizedRequest.status !== "authorized") return res.status(409).json({ error: "Authorization was verified but the execution request could not be persisted" });

    const task = await supabase.from("mission_tasks").select("agent_id").eq("id", job.mission_task_id).maybeSingle();
    if (task.error || !task.data?.agent_id) return res.status(409).json({ error: task.error?.message || "Job does not identify a provider agent" });
    const executionAuthorization = {
      execution_wallet: wallet,
      session_key_address: capability.session_key_address,
      session_key_public_key: capability.session_key_public_key,
      session_key_id: sessionKeyId,
      session_expiry: expiry,
      capital_token: capitalToken || evidence.capital_token || object(capability.execution_market).token_in || null,
      capital_amount_raw: capitalAmountRaw || evidence.capital_amount_raw || null,
      wallet_provider: "altana",
      authorization_model: "scoped_session",
      chain_id: 97,
      allowed_targets: Array.isArray(capability.allowed_targets) ? capability.allowed_targets : [],
      allowed_selectors: Array.isArray(capability.allowed_selectors) ? capability.allowed_selectors : [],
      session_binding: "erc8183_job_id",
    };
    let delivery: string;
    try { delivery = await deliverToProvider(Number(job.chain_job_id), String(task.data.agent_id), executionAuthorization, supabase); }
    catch (error) { return res.status(202).json({ ok: true, authorized: true, provider_delivery: false, request: authorizedRequest, error: error instanceof Error ? error.message : "Provider authorization delivery failed; retry authorization verification" }); }

    return res.status(200).json({ ok: true, authorized: true, provider_delivery: true, provider_endpoint: delivery, request: authorizedRequest });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Execution authorization verification failed" });
  }
}
