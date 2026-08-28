import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import { getExecutionCapability, TESTNET_U_TOKEN_ADDRESS } from "./lib/executionCapital";
import ExecutionCapitalCard from "./ExecutionCapitalCard";
import ExecutionCapitalRequestGate from "./ExecutionCapitalRequestGate";
import AltanaWalletGate from "./AltanaWalletGate";
import AltanaSessionGrantGate from "./AltanaSessionGrantGate";
import ExecutionCapitalLivePanel from "./ExecutionCapitalLivePanel";

type Props = {
  request: ExecutionCapitalRequest | null;
  jobBudget: string | number | null;
  jobCurrency: string;
};

type ExecutionRequirement = {
  execution_market?: {
    token_in?: string | null;
    token_out?: string | null;
    token_in_symbol?: string | null;
    token_out_symbol?: string | null;
    fee?: number | null;
  };
  execution_capital?: {
    token?: string | null;
    symbol?: string | null;
    decimals?: number | null;
    required_amount?: string | null;
    required_amount_raw?: string | null;
  };
  source_url?: string;
};

function parseCapitalAmount(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  try { const amount = BigInt(value); return amount > 0n ? amount : null; } catch { return null; }
}

function normalizedCapitalToken(request: ExecutionCapitalRequest | null, requirement: ExecutionRequirement | null) {
  const token = requirement?.execution_capital?.token || request?.capital_token || "";
  if (!token || ["bnb", "tbnb", "tbn"].includes(token.toLowerCase())) return TESTNET_U_TOKEN_ADDRESS;
  return token;
}

export default function ExecutionCapitalPanel({ request, jobBudget, jobCurrency }: Props) {
  const capability = getExecutionCapability(request);
  const capitalAmount = parseCapitalAmount(request?.capital_requested || null);
  const [requirement, setRequirement] = useState<ExecutionRequirement | null>(null);
  const [requirementError, setRequirementError] = useState("");
  const [liveFunded, setLiveFunded] = useState(false);
  const [requestCreated, setRequestCreated] = useState(false);
  const [liveStateError, setLiveStateError] = useState("");

  useEffect(() => {
    const jobId = request?.job_id || new URLSearchParams(window.location.search).get("job")?.trim() || "";
    if (!jobId) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/testnet?route=execution-capital-requirement&job=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as { ok?: boolean; error?: string } & ExecutionRequirement;
        if (!response.ok) throw new Error(body?.error || "Unable to resolve the agent's execution-token requirement");
        if (active) { setRequirement(body); setRequirementError(""); }
      } catch (cause) {
        if (active) setRequirementError(cause instanceof Error ? cause.message : "Unable to resolve execution-token requirement");
      }
    })();
    return () => { active = false; };
  }, [request?.job_id]);

  useEffect(() => {
    if (request || requestCreated) { setLiveFunded(false); return; }
    const jobId = new URLSearchParams(window.location.search).get("job")?.trim() || "";
    if (!jobId) { setLiveFunded(false); return; }
    let active = true;
    let timer: number | undefined;
    const checkLiveState = async () => {
      try {
        const response = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as Record<string, any> | null;
        if (!response.ok) throw new Error(body?.error || "Unable to read the live job state");
        if (!active) return;
        const chainStatus = String(body?.chain?.chain_status || "").toLowerCase();
        const workflowStatus = String(body?.job?.status || "").toLowerCase();
        const status = chainStatus || workflowStatus;
        setLiveFunded(status === "funded");
        setLiveStateError("");
        if (status === "funded" || status === "open") timer = window.setTimeout(() => void checkLiveState(), 1500);
      } catch (cause) {
        if (!active) return;
        setLiveStateError(cause instanceof Error ? cause.message : "Unable to read the live job state");
        timer = window.setTimeout(() => void checkLiveState(), 4000);
      }
    };
    void checkLiveState();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [request, requestCreated]);

  const capitalToken = normalizedCapitalToken(request, requirement);
  const capitalSymbol = requirement?.execution_capital?.symbol || requirement?.execution_market?.token_in_symbol || (request ? "execution token" : "execution token");
  const capitalDecimals = requirement?.execution_capital?.decimals ?? 18;
  const capitalDisplayAmount = requirement?.execution_capital?.required_amount || request?.capital_requested || "1";
  const capabilityWithMarket = capability;
  const fundingLink = requirement?.execution_capital?.token
    ? `/testnet/swap?token=${encodeURIComponent(capitalSymbol)}&address=${encodeURIComponent(requirement.execution_capital.token)}`
    : "/testnet/swap";

  return (
    <div className="mb-6 space-y-4">
      <ExecutionCapitalCard request={request} jobBudget={jobBudget} jobCurrency={jobCurrency} />

      {!request && liveFunded && !requestCreated && (() => {
        const jobId = new URLSearchParams(window.location.search).get("job")?.trim() || "";
        return jobId ? <ExecutionCapitalRequestGate jobId={jobId} jobBudget={jobBudget} jobCurrency={jobCurrency} onRequested={() => setRequestCreated(true)} /> : null;
      })()}

      {!request && !liveFunded && liveStateError && <section className="border border-[#cfad9f] bg-rustsoft text-rust rounded-[16px_8px_18px_9px] p-4 text-[10.5px]">Unable to confirm the live Funded state right now. The execution-capital request remains unavailable until the chain state can be verified.</section>}

      {requirementError && <section className="border border-[#cfad9f] bg-rustsoft text-rust rounded-[16px_8px_18px_9px] p-4 text-[10.5px]">Unable to resolve the agent's execution-token requirement yet: {requirementError}</section>}

      {request && request.status === "requested" && !capability && <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5"><small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution Capital · Provider Capability</small><h3 className="font-display text-[17px] font-bold m-0">Waiting for a valid execution scope</h3><p className="text-[10.5px] text-inksoft mt-1.5 max-w-[680px]">AgentMarket has not received a valid BSC Testnet Altana capability descriptor for this request. No session grant is shown until the provider publishes a public session key, target allowlist, and selector allowlist.</p></section>}

      {request && request.status === "requested" && capabilityWithMarket && (
        <>
          <AltanaWalletGate />
          {capitalAmount ? (
            <AltanaSessionGrantGate
              requestId={request.id}
              agentSessionAddress={capabilityWithMarket.session_key_address as Address}
              agentSessionPublicKey={capabilityWithMarket.session_key_public_key as Hex}
              allowedCalls={capabilityWithMarket.allowed_targets as readonly Address[]}
              allowedSelectors={capabilityWithMarket.allowed_selectors as readonly Hex[]}
              capitalAmount={capitalAmount}
              capitalToken={capitalToken as Address}
              capitalSymbol={capitalSymbol}
              capitalDecimals={capitalDecimals}
              purpose={request.purpose}
              durationSeconds={request.requested_duration_seconds || request.duration_seconds || 86400}
              capabilitySource={capabilityWithMarket.source_url}
            />
          ) : (
            <section className="border border-[#cfad9f] bg-rustsoft text-rust rounded-[16px_8px_18px_9px] p-5 text-[11px]">Execution capital was requested with a non-integer amount that the current Altana spend-permission adapter cannot safely encode. The request remains un-authorized.</section>
          )}
          <div className="text-[10px] text-inksoft">Agent execution token: <strong>{capitalDisplayAmount} {capitalSymbol}</strong> · <a className="text-brass" href={fundingLink}>Get {capitalSymbol} on PancakeSwap Testnet →</a></div>
        </>
      )}

      {request && capability && (request.status === "authorized" || request.status === "active") && <ExecutionCapitalLivePanel request={request} />}
    </div>
  );
}
