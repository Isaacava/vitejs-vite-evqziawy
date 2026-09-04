import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { serverClient } from "../_auth.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const COMMERCE_ABI = [{
  type: "function", name: "getJob", stateMutability: "view",
  inputs: [{ name: "jobId", type: "uint256" }],
  outputs: [{ name: "job", type: "tuple", components: [
    { name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" },
    { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" },
    { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" },
    { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" },
  ] }],
}] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com") });

function address(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  try {
    const jobId = typeof req.query?.job === "string" ? req.query.job.trim() : "";
    const provider = typeof req.query?.provider === "string" ? req.query.provider.trim() : "";
    if (!jobId || !/^\d+$/.test(jobId)) return res.status(400).json({ ok: false, error: "job must be a numeric ERC-8183 job id" });
    if (!address(provider)) return res.status(400).json({ ok: false, error: "provider must be a valid provider wallet address" });

    const chainJob = await publicClient.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "getJob", args: [BigInt(jobId)] });
    if (!chainJob || chainJob.id === 0n) return res.status(404).json({ ok: false, error: "ERC-8183 job not found" });
    if (chainJob.provider.toLowerCase() !== provider.toLowerCase()) return res.status(403).json({ ok: false, error: "Provider does not match the ERC-8183 job" });

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
      return res.status(200).json({
        ok: true,
        required: false,
        status: "not_requested",
        authorization: null,
        erc8183: { job_id: Number(jobId), status: Number(chainJob.status), provider: chainJob.provider },
      });
    }

    const evidence = request.evidence && typeof request.evidence === "object" ? request.evidence as Record<string, unknown> : {};
    const capability = evidence.execution_capability && typeof evidence.execution_capability === "object" ? evidence.execution_capability as Record<string, unknown> : {};

    return res.status(200).json({
      ok: true,
      required: true,
      status: String(request.status || "requested").toLowerCase(),
      request_id: request.id,
      erc8183: { job_id: Number(jobId), status: Number(chainJob.status), provider: chainJob.provider },
      authorization: request.status === "authorized" ? {
        execution_wallet: request.user_execution_wallet || null,
        session_key_id: request.session_key_id || null,
        session_key_address: request.agent_session_key || null,
        session_expiry: request.session_expiry || null,
        capital_token: request.capital_token || capability.execution_market?.token_in || null,
        capital_authorized: request.capital_authorized || request.capital_requested || null,
        wallet_provider: "altana",
        authorization_model: "scoped_session",
        allowed_targets: capability.allowed_targets || [],
        allowed_selectors: capability.allowed_selectors || [],
      } : null,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to read execution authorization" });
  }
}
