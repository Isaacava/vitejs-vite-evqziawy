import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { serverClient } from "../_auth.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const COMMERCE_ABI = [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" }] }], }] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });

function address(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try { return recordObject(JSON.parse(value)); } catch { return {}; }
}

function validSelector(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{8}$/.test(value);
}

function readJobScopedAuthorization(description: unknown) {
  const payload = parseJsonObject(description);
  const raw = recordObject(payload.execution_authorization);
  const executionWallet = address(raw.execution_wallet) ? raw.execution_wallet : null;
  const allowedTargets = Array.isArray(raw.allowed_targets) ? raw.allowed_targets.filter(address) : [];
  const allowedSelectors = Array.isArray(raw.allowed_selectors) ? raw.allowed_selectors.filter(validSelector) : [];
  const walletProvider = String(raw.wallet_provider || "").trim().toLowerCase();
  const authorizationModel = String(raw.authorization_model || "").trim().toLowerCase();
  const sessionBinding = String(raw.session_binding || "").trim().toLowerCase();
  const chainId = Number(raw.chain_id);
  const authorized = Boolean(
    executionWallet &&
    chainId === 97 &&
    walletProvider === "altana" &&
    authorizationModel === "scoped_session" &&
    sessionBinding === "erc8183_job_id" &&
    allowedTargets.length > 0 &&
    allowedSelectors.length > 0
  );
  return {
    authorized,
    executionWallet,
    version: raw.version ?? null,
    walletProvider: walletProvider || null,
    authorizationModel: authorizationModel || null,
    chainId: Number.isFinite(chainId) ? chainId : null,
    allowedTargets,
    allowedSelectors,
    sessionBinding: sessionBinding || null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const jobId = typeof req.query?.job === "string" ? req.query.job.trim() : "";
    const provider = typeof req.query?.provider === "string" ? req.query.provider.trim() : "";
    if (!jobId || !/^\d+$/.test(jobId)) return res.status(400).json({ ok: false, error: "job must be a numeric ERC-8183 job id" });
    if (provider && !address(provider)) return res.status(400).json({ ok: false, error: "provider must be a valid provider wallet address when supplied" });

    const chainJob = await publicClient.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "getJob", args: [BigInt(jobId)] });
    if (!chainJob || chainJob.id === 0n) return res.status(404).json({ ok: false, error: "ERC-8183 job not found" });
    if (provider && chainJob.provider.toLowerCase() !== provider.toLowerCase()) return res.status(403).json({ ok: false, error: "Provider does not match the ERC-8183 job" });

    const scoped = readJobScopedAuthorization(chainJob.description);

    const supabase = serverClient();
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id,chain_job_id,provider_agent_id")
      .eq("chain_job_id", Number(jobId))
      .maybeSingle();
    if (jobError) return res.status(500).json({ ok: false, error: jobError.message });

    const { data: request, error: requestError } = await supabase
      .from("execution_capital_requests")
      .select("id,status,capital_requested,capital_authorized,capital_token,user_execution_wallet,agent_session_key,session_key_id,session_expiry,duration_seconds,evidence,created_at,updated_at")
      .eq("job_id", job?.id || "")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (requestError) return res.status(500).json({ ok: false, error: requestError.message });

    if (!request) {
      if (scoped.authorized) {
        return res.status(200).json({
          ok: true,
          required: false,
          status: "job_scoped_authorized",
          request_id: null,
          erc8183: { job_id: Number(jobId), status: Number(chainJob.status), provider: chainJob.provider },
          authorization: {
            source: "erc8183_job_context",
            execution_wallet: scoped.executionWallet,
            session_key_id: null,
            session_key_address: null,
            session_expiry: null,
            capital_token: null,
            capital_authorized: null,
            wallet_provider: scoped.walletProvider,
            authorization_model: scoped.authorizationModel,
            chain_id: scoped.chainId,
            allowed_targets: scoped.allowedTargets,
            allowed_selectors: scoped.allowedSelectors,
            session_binding: scoped.sessionBinding,
            version: scoped.version,
          },
        });
      }
      return res.status(200).json({
        ok: true,
        required: false,
        status: "not_requested",
        request_id: null,
        authorization: null,
        erc8183: { job_id: Number(jobId), status: Number(chainJob.status), provider: chainJob.provider },
      });
    }

    const evidence = recordObject(request.evidence);
    const capability = recordObject(evidence.execution_capability);
    const executionMarket = recordObject(capability.execution_market);
    const capabilityToken = typeof executionMarket.token_in === "string" ? executionMarket.token_in : null;

    return res.status(200).json({
      ok: true,
      required: true,
      status: String(request.status || "requested").toLowerCase(),
      request_id: request.id,
      erc8183: { job_id: Number(jobId), status: Number(chainJob.status), provider: chainJob.provider },
      authorization: request.status === "authorized"
        ? {
            source: "execution_capital_request",
            execution_wallet: request.user_execution_wallet || null,
            session_key_id: request.session_key_id || null,
            session_key_address: request.agent_session_key || null,
            session_expiry: request.session_expiry || null,
            capital_token: request.capital_token || capabilityToken,
            capital_authorized: request.capital_authorized || request.capital_requested || null,
            wallet_provider: "altana",
            authorization_model: "scoped_session",
            allowed_targets: Array.isArray(capability.allowed_targets) ? capability.allowed_targets : [],
            allowed_selectors: Array.isArray(capability.allowed_selectors) ? capability.allowed_selectors : [],
          }
        : null,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to read execution authorization" });
  }
}
