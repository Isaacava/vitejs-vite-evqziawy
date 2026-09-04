import { useEffect, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import ExecutionCapitalCard, { type OnchainExecutionSummary } from "./ExecutionCapitalCard";
import AltanaSessionGrantGate from "./AltanaSessionGrantGate";
import ExecutionCapitalLivePanel from "./ExecutionCapitalLivePanel";

type Props = {
  request: ExecutionCapitalRequest | null;
  jobBudget: string | number | null;
  jobCurrency: string;
};

type ExecutionJobState = {
  chain?: { chain_job_id?: number | null; chain_status?: string | null } | null;
  job?: { chain_job_id?: number | null; status?: string | null } | null;
};

type ExecutionRequirement = {
  required?: boolean;
  pending_capability?: boolean;
  source_url?: string;
  capability_source_url?: string | null;
  execution?: string | null;
  wallet_provider?: string | null;
  authorization_model?: string | null;
  execution_market?: { token_in?: string | null; token_out?: string | null; token_in_symbol?: string | null; token_out_symbol?: string | null; fee?: number | null };
  execution_capital?: { token?: string | null; symbol?: string | null; decimals?: number | null; required_amount?: string | null; required_amount_raw?: string | null };
  authorization?: { required?: boolean; status?: string };
  error?: string;
};

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function address(value: unknown): value is Address { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function hex(value: unknown): value is Hex { return typeof value === "string" && /^0x[a-fA-F0-9]+$/.test(value); }
function requestCapability(request: ExecutionCapitalRequest | null) { return object(object(request?.evidence).execution_capability); }

export default function ExecutionCapitalPanel({ request, jobBudget, jobCurrency }: Props) {
  const [effectiveRequest, setEffectiveRequest] = useState<ExecutionCapitalRequest | null>(request);
  const [requirement, setRequirement] = useState<ExecutionRequirement | null>(null);
  const [onchainExecution, setOnchainExecution] = useState<OnchainExecutionSummary | null>(null);
  const [liveStatus, setLiveStatus] = useState("unknown");
  const [prepareState, setPrepareState] = useState<"idle" | "checking" | "waiting" | "ready" | "not_required" | "error">("idle");
  const [prepareError, setPrepareError] = useState("");
  const jobId = effectiveRequest?.job_id || new URLSearchParams(window.location.search).get("job")?.trim() || "";

  useEffect(() => { setEffectiveRequest(request); }, [request]);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timer: number | undefined;
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const jobResponse = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
        const jobBody = await jobResponse.json().catch(() => null) as ExecutionJobState | { error?: string } | null;
        if (!jobResponse.ok) throw new Error((jobBody as { error?: string } | null)?.error || "Unable to read the live mission state");
        const chainJob = (jobBody as ExecutionJobState)?.chain;
        const localJob = (jobBody as ExecutionJobState)?.job;
        const chainStatus = String(chainJob?.chain_status || "").toLowerCase();
        const workflowStatus = String(localJob?.status || "").toLowerCase();
        const status = chainStatus || workflowStatus || "unknown";
        if (active) setLiveStatus(status);
        if (["submitted", "completed", "rejected", "expired", "cancelled", "settled", "terminal"].includes(status)) { if (active) setPrepareState("not_required"); return; }
        if (!["open", "funded"].includes(status)) { if (active) setPrepareState("waiting"); timer = window.setTimeout(() => void refresh(), 2500); return; }

        const requirementResponse = await fetch(`/api/testnet?route=execution-capital-requirement&job=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
        const requirementBody = await requirementResponse.json().catch(() => null) as ExecutionRequirement | null;
        if (!requirementResponse.ok) throw new Error(requirementBody?.error || "Unable to resolve the provider execution capability");
        if (!active) return;
        setRequirement(requirementBody);
        const executionRequired = requirementBody?.required === true || requirementBody?.authorization?.required === true;
        if (!executionRequired) { setPrepareState("not_required"); return; }
        if (effectiveRequest) { setPrepareState("ready"); return; }

        setPrepareState(requirementBody.pending_capability ? "waiting" : "checking");
        const chainJobId = Number(chainJob?.chain_job_id ?? localJob?.chain_job_id ?? 0);
        if (!Number.isInteger(chainJobId) || chainJobId <= 0) throw new Error("The live ERC-8183 job id is not available yet");
        const prepareResponse = await fetch("/api/testnet?route=execution-authorization-prepare", {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jobId, chain_job_id: chainJobId, capital_requested: 1, duration_seconds: 86400, purpose: "Agent execution" }),
        });
        const prepareBody = await prepareResponse.json().catch(() => null) as { request?: ExecutionCapitalRequest | null; required?: boolean; pending_capability?: boolean; note?: string; error?: string } | null;
        if (!active) return;
        if ((prepareResponse.status === 201 || prepareResponse.ok) && prepareBody?.request) {
          setEffectiveRequest(prepareBody.request); setPrepareState("ready"); setPrepareError(""); return;
        }
        if (prepareResponse.status === 202 || prepareBody?.pending_capability) {
          setPrepareState("waiting"); setPrepareError(prepareBody?.note || "Waiting for the provider execution capability to become reachable."); timer = window.setTimeout(() => void refresh(), 2500); return;
        }
        if (prepareResponse.ok && prepareBody?.required === false) { setPrepareState("not_required"); return; }
        throw new Error(prepareBody?.error || "AgentMarket could not prepare the execution-authorization request");
      } catch (cause) {
        if (!active) return;
        setPrepareState("error"); setPrepareError(cause instanceof Error ? cause.message : "Unable to prepare execution authorization");
        timer = window.setTimeout(() => void refresh(), 4000);
      } finally { running = false; }
    };
    void refresh();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [jobId, effectiveRequest?.id]);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/testnet?route=execution-evidence&job=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as OnchainExecutionSummary & { error?: string };
        if (active && response.ok) setOnchainExecution(body);
      } catch { /* supplemental evidence only */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [jobId]);

  const capability = useMemo(() => requestCapability(effectiveRequest), [effectiveRequest]);
  const sourceUrl = typeof capability.source_url === "string" ? capability.source_url : requirement?.capability_source_url || requirement?.source_url || "";
  const sessionAddress = typeof capability.session_key_address === "string" && address(capability.session_key_address) ? capability.session_key_address : effectiveRequest?.agent_session_key && address(effectiveRequest.agent_session_key) ? effectiveRequest.agent_session_key as Address : null;
  const sessionPublicKey = typeof capability.session_key_public_key === "string" && hex(capability.session_key_public_key) ? capability.session_key_public_key as Hex : null;
  const allowedCalls = Array.isArray(capability.allowed_targets) ? capability.allowed_targets.filter(address) : [];
  const allowedSelectors = Array.isArray(capability.allowed_selectors) ? capability.allowed_selectors.filter((value): value is Hex => typeof value === "string" && /^0x[a-fA-F0-9]{8}$/.test(value)) : [];
  const capitalToken = effectiveRequest?.capital_token && address(effectiveRequest.capital_token) ? effectiveRequest.capital_token : requirement?.execution_capital?.token && address(requirement.execution_capital.token) ? requirement.execution_capital.token : null;
  const capitalAmount = effectiveRequest?.capital_requested || requirement?.execution_capital?.required_amount || "1";
  const capitalSymbol = requirement?.execution_capital?.symbol || requirement?.execution_market?.token_in_symbol || "execution token";
  const durationSeconds = effectiveRequest?.duration_seconds || effectiveRequest?.requested_duration_seconds || 86400;
  const canAuthorize = Boolean(effectiveRequest && sessionAddress && sessionPublicKey && capitalToken && allowedCalls.length > 0 && allowedSelectors.length > 0);
  const authorizationPending = Boolean(effectiveRequest && effectiveRequest.status !== "authorized" && effectiveRequest.status !== "active");
  const jobScopedSource = (() => { if (!sourceUrl) return ""; try { const parsed = new URL(sourceUrl, window.location.origin); const chainJobId = parsed.searchParams.get("job_id"); if (!chainJobId) { /* prepare responses are normally already job-scoped */ } return parsed.toString(); } catch { return sourceUrl; } })();

  return (
    <div className="mb-6 space-y-4">
      <ExecutionCapitalCard request={effectiveRequest} jobBudget={jobBudget} jobCurrency={jobCurrency} onchainExecution={onchainExecution} />
      {prepareState === "checking" && !effectiveRequest && <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5"><small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution authorization</small><h3 className="font-display text-[17px] font-bold m-0">Preparing the agent's execution request…</h3><p className="text-[10.5px] text-inksoft mt-1.5">AgentMarket is resolving the provider's live execution capability. No funds move at this stage.</p></section>}
      {prepareState === "waiting" && !effectiveRequest && <section className="border border-brasslt bg-[#fbf4db]/50 rounded-[16px_8px_18px_9px] p-5"><small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution authorization</small><h3 className="font-display text-[17px] font-bold m-0">Waiting for the provider's authorization capability</h3><p className="text-[10.5px] text-inksoft mt-1.5">The job is {liveStatus}. The request will appear here as soon as the provider capability is reachable.</p>{prepareError && <div className="mt-3 text-[10px] text-brass">{prepareError}</div>}</section>}
      {prepareState === "error" && !effectiveRequest && <section className="border border-[#cfad9f] bg-rustsoft text-rust rounded-[16px_8px_18px_9px] p-5"><small className="block font-mono text-[8.5px] uppercase tracking-widest mb-1.5">Execution authorization</small><h3 className="font-display text-[17px] font-bold m-0">Authorization request could not be prepared</h3><p className="text-[10.5px] mt-1.5">{prepareError || "AgentMarket is retrying the provider capability lookup."}</p></section>}
      {effectiveRequest && canAuthorize && authorizationPending && <AltanaSessionGrantGate
        requestId={effectiveRequest.id}
        agentSessionAddress={sessionAddress as Address}
        agentSessionPublicKey={sessionPublicKey as Hex}
        allowedCalls={allowedCalls}
        allowedSelectors={allowedSelectors}
        capitalAmount={BigInt(capitalAmount)}
        capitalToken={capitalToken as Address}
        capitalSymbol={capitalSymbol}
        capitalDecimals={requirement?.execution_capital?.decimals ?? 18}
        approvalSpender={capitalToken && allowedCalls.length === 2 ? allowedCalls.find((value) => value.toLowerCase() !== capitalToken.toLowerCase()) : undefined}
        purpose={effectiveRequest.purpose || "Agent execution"}
        durationSeconds={durationSeconds}
        capabilitySource={jobScopedSource || sourceUrl || undefined}
        onAuthorized={() => window.location.reload()}
      />}
      {effectiveRequest && !canAuthorize && authorizationPending && <section className="border border-[#cfad9f] bg-rustsoft text-rust rounded-[16px_8px_18px_9px] p-5"><small className="block font-mono text-[8.5px] uppercase tracking-widest mb-1.5">Execution authorization</small><h3 className="font-display text-[17px] font-bold m-0">Authorization request is waiting for provider scope</h3><p className="text-[10.5px] mt-1.5">AgentMarket has created the job-scoped request, but the provider has not supplied the complete target and selector scope required for Passkey approval.</p>{prepareError && <div className="mt-3 text-[10px]">{prepareError}</div>}</section>}
      {effectiveRequest && !authorizationPending && <ExecutionCapitalLivePanel request={effectiveRequest} />}
      {effectiveRequest && <p className="text-[9.5px] text-inksoft">Execution authorization is separate from the ERC-8183 escrow. Passkey approval creates a scoped, revocable Altana session; execution capital is funded only after that session is independently verified.</p>}
    </div>
  );
}
