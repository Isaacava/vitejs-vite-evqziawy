import { useEffect, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import type { ExecutionCapitalRequest } from "../lib/executionCapital";
import { getExecutionCapability, TESTNET_U_TOKEN_ADDRESS } from "../lib/executionCapital";
import ExecutionCapitalCard, { type OnchainExecutionSummary } from "../ExecutionCapitalCard";
import ExecutionCapitalRequestGate from "../ExecutionCapitalRequestGate";
import AltanaWalletGate from "../AltanaWalletGate";
import AltanaSessionGrantGate from "../AltanaSessionGrantGate";
import ExecutionCapitalLivePanel from "../ExecutionCapitalLivePanel";

type Props = { request: ExecutionCapitalRequest | null; jobBudget: string | number | null; jobCurrency: string };
type UniversalState = {
  execution_mode?: "observation_only" | "state_changing" | "unknown";
  execution_status?: string | null;
  authorization_required?: boolean;
  authorization_status?: string | null;
  evidence_source?: string;
  erc8183?: { status?: number | null; funded?: boolean; submitted?: boolean };
  execution_capital?: { status?: string; requested_amount?: string | null; requested_amount_raw?: string | null; token?: string | null; symbol?: string | null; discovery?: string | null };
  capability_discovery?: { advertised_url?: string | null; operations?: Array<{ kind: string; protocol: string; endpoint: string; evidence: string }> };
  provider_evidence?: { verified?: boolean; captured_at?: string | null } | null;
  notes?: string;
  error?: string;
};

function text(value: unknown) { return typeof value === "string" ? value : ""; }

export default function ExecutionCapitalPanel({ request, jobBudget, jobCurrency }: Props) {
  const jobId = useMemo(() => request?.job_id || new URLSearchParams(window.location.search).get("job")?.trim() || "", [request?.job_id]);
  const [state, setState] = useState<UniversalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const capability = getExecutionCapability(request);

  useEffect(() => {
    if (!jobId) { setLoading(false); return; }
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/testnet?route=execution-capital-state&job=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as UniversalState | null;
        if (!response.ok) throw new Error(body?.error || "Unable to resolve the provider execution state");
        if (!active) return;
        setState(body);
        setError("");
        setLoading(false);
        const funded = Boolean(body?.erc8183?.funded);
        if (!body?.erc8183?.submitted && funded) timer = window.setTimeout(() => void refresh(), 3000);
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Unable to resolve the provider execution state");
        setLoading(false);
        timer = window.setTimeout(() => void refresh(), 7000);
      }
    };
    void refresh();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [jobId]);

  const observationOnly = state?.execution_mode === "observation_only";
  const stateChanging = state?.execution_mode === "state_changing";
  const needsRequest = Boolean(stateChanging && state?.authorization_required && !request && state?.erc8183?.funded);
  const requestActive = Boolean(request && (request.status === "requested" || request.status === "authorized" || request.status === "active"));
  const requestCapability = capability && capability.session_key_address && capability.session_key_public_key ? capability : null;

  const hideLegacyFooter = observationOnly || Boolean(state && !stateChanging && !request);

  return (
    <div className="mb-6 space-y-4 execution-capital-panel-universal" data-execution-mode={state?.execution_mode || "unknown"} data-hide-execution-footer={hideLegacyFooter ? "true" : "false"}>
      <style>{`section[role="tabpanel"][aria-label="Execution"]:has(.execution-capital-panel-universal[data-hide-execution-footer="true"]) > div.mt-6 { display:none !important; }`}</style>

      {observationOnly ? (
        <section className="rounded-[18px_9px_20px_10px] border border-line bg-paper p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div><small className="mb-1 block font-mono text-[8.5px] uppercase text-brass">Execution mode</small><strong className="font-display text-[17px] font-bold">Observation only</strong><span className="mt-0.5 block text-[11px] text-inksoft">This provider response does not require state-changing execution or an execution-capital authorization session.</span></div>
            <span className="rounded-lg px-2.5 py-1 font-mono text-[9.5px] status-green">OBSERVED</span>
          </div>
          <div className="grid gap-2 text-[10px] sm:grid-cols-2">
            <div><strong>Provider execution:</strong> {text(state?.execution_status) || "observed"}</div>
            <div><strong>Authorization:</strong> not required</div>
            <div><strong>Execution capital:</strong> not required</div>
            <div><strong>Evidence source:</strong> {state?.evidence_source || "provider deliverable"}</div>
          </div>
          {state?.provider_evidence?.verified && <p className="mt-3 mb-0 text-[10px] text-inksoft">The provider deliverable was independently captured and verified. AgentMarket will not manufacture an Altana session or execution-capital request for an observation-only result.</p>}
        </section>
      ) : (
        <ExecutionCapitalCard request={request} jobBudget={jobBudget} jobCurrency={jobCurrency} />
      )}

      {loading && <div className="rounded-[16px_8px_18px_9px] border border-line bg-paper p-4 text-[10px] text-inksoft">Detecting the provider execution mode…</div>}
      {error && <div className="rounded-[16px_8px_18px_9px] border border-[#cfad9f] bg-rustsoft p-4 text-[10.5px] text-rust">Unable to resolve universal execution state: {error}</div>}

      {!observationOnly && needsRequest && !requestActive && (
        <section className="rounded-[16px_8px_18px_9px] border border-line bg-paper p-5">
          <small className="mb-1.5 block font-mono text-[8.5px] uppercase tracking-widest text-brass">Execution authorization</small>
          <h3 className="m-0 font-display text-[17px] font-bold">Provider requires state-changing execution authorization</h3>
          <p className="mt-1.5 max-w-[700px] text-[10.5px] text-inksoft">The requirement was detected from provider evidence, not inferred from a fixed AgentMarket endpoint. AgentMarket will only request the provider’s declared authorization model.</p>
          <div className="mt-3 text-[9.5px] font-mono">execution mode: {state?.execution_mode} · authorization: required · BSC Testnet</div>
          <div className="mt-4"><ExecutionCapitalRequestGate jobId={jobId} jobBudget={jobBudget} jobCurrency={jobCurrency} onRequested={() => window.location.reload()} /></div>
        </section>
      )}

      {request && request.status === "requested" && requestCapability && (
        <>
          <AltanaWalletGate />
          <AltanaSessionGrantGate
            requestId={request.id}
            agentSessionAddress={requestCapability.session_key_address as Address}
            agentSessionPublicKey={requestCapability.session_key_public_key as Hex}
            allowedCalls={requestCapability.allowed_targets as readonly Address[]}
            allowedSelectors={requestCapability.allowed_selectors as readonly Hex[]}
            capitalAmount={BigInt(/^[0-9]+$/.test(request.capital_requested || "") ? request.capital_requested! : "1")}
            capitalToken={(request.capital_token || TESTNET_U_TOKEN_ADDRESS) as Address}
            capitalSymbol={request.capital_token_symbol || "execution token"}
            capitalDecimals={18}
            purpose={request.purpose}
            durationSeconds={request.requested_duration_seconds || request.duration_seconds || 86400}
            capabilitySource={text((request.evidence as Record<string, unknown> | null | undefined)?.execution_capability && ((request.evidence as Record<string, unknown>).execution_capability as Record<string, unknown>).source_url)}
            onAuthorized={() => window.location.reload()}
          />
        </>
      )}

      {request && request.status === "requested" && !requestCapability && !observationOnly && (
        <section className="rounded-[16px_8px_18px_9px] border border-[#cfad9f] bg-rustsoft p-5 text-rust">
          <small className="mb-1 block font-mono text-[8.5px] uppercase tracking-widest">Provider authorization</small>
          <strong className="font-display text-[16px]">Authorization details are not independently verifiable yet</strong>
          <p className="mt-1.5 mb-0 text-[10.5px]">The provider may use its own authorization system. AgentMarket does not assume that it must expose a fixed `/execution-capabilities` route.</p>
        </section>
      )}

      {request && capability && (request.status === "authorized" || request.status === "active") && <ExecutionCapitalLivePanel request={request} />}

      {!request && !observationOnly && !loading && !stateChanging && (
        <section className="rounded-[16px_8px_18px_9px] border border-line bg-paper p-5 text-[10.5px] text-inksoft">
          No state-changing execution authorization has been declared for this job. AgentMarket will not create one from an arbitrary execute endpoint.
        </section>
      )}

      {!request && observationOnly && <div className="text-[10px] text-inksoft">No execution-capital request is needed for this observation-only provider result. The ERC-8183 job budget remains separate.</div>}

      {state?.execution_capital?.status === "required_not_requested" && !needsRequest && <div className="text-[10px] text-inksoft">Execution capital was detected as required, but the live job is not currently in a state where AgentMarket can request it.</div>}

      {state?.capability_discovery?.advertised_url && !observationOnly && <div className="text-[9.5px] text-inksoft break-all">Provider-declared authorization discovery: <span className="font-mono">{state.capability_discovery.advertised_url}</span></div>}

      {!observationOnly && state?.erc8183?.submitted && request == null && (
        <div className="text-[10px] text-inksoft">The ERC-8183 job is already submitted. Execution authorization remains optional provider evidence and is not shown as pending.</div>
      )}
    </div>
  );
}
