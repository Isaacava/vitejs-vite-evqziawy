import { useEffect, useRef, useState } from "react";

type Props = { jobId: string; jobBudget: string | number | null; jobCurrency: string; onRequested?: () => void };
type Requirement = {
  required?: boolean;
  execution?: string | null;
  wallet_provider?: string | null;
  authorization_model?: string | null;
  execution_capital?: { token?: string; symbol?: string; required_amount?: string };
  execution_market?: { token_in_symbol?: string; token_out_symbol?: string; fee?: number | null };
};
type Decision = { execution_required?: boolean; authorization_required?: boolean; decision?: { action?: string; source?: string; [key: string]: unknown }; observation?: Record<string, unknown>; error?: string; pending?: boolean; provider?: { name?: string | null; agent_id?: string | null } };
type JobLookup = { job?: { id?: string; chain_job_id?: number | null; status?: string }; chain?: { chain_job_id?: number | null }; task?: { title?: string | null; role?: string | null }; agent?: { name?: string | null; agent_id?: string | null }; provider?: { name?: string | null; agent_id?: string | null } };

function displayAuthorizationModel(requirement: Requirement | null) {
  if (!requirement) return "provider-declared";
  const provider = requirement.wallet_provider || "provider-declared";
  const model = requirement.authorization_model || "provider-declared";
  return `${provider} / ${model}`;
}

export default function ExecutionCapitalRequestGate({ jobId, onRequested }: Props) {
  const [capital] = useState("1");
  const [purpose] = useState("Agent execution");
  const [durationHours] = useState("24");
  const [marketplaceJobId, setMarketplaceJobId] = useState(() => jobId.trim());
  const [chainJobId, setChainJobId] = useState<string>(/^\d+$/.test(jobId.trim()) ? jobId.trim() : "");
  const [providerLabel, setProviderLabel] = useState("Selected provider");
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [status, setStatus] = useState<"waiting_decision" | "submitting" | "requested" | "provider_authorization" | "not_required" | "error">("waiting_decision");
  const [error, setError] = useState("");
  const capitalRequestAttemptedRef = useRef(false);

  useEffect(() => {
    setMarketplaceJobId(jobId.trim());
    if (/^\d+$/.test(jobId.trim())) setChainJobId(jobId.trim());
  }, [jobId]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const resolveChainJob = async () => {
      try {
        const response = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as JobLookup | null;
        const resolved = body?.chain?.chain_job_id ?? body?.job?.chain_job_id;
        const resolvedProvider = body?.agent?.name || body?.provider?.name || body?.task?.role || body?.task?.title || body?.agent?.agent_id || body?.provider?.agent_id || "Selected provider";
        if (active) setProviderLabel(String(resolvedProvider));
        if (resolved !== null && resolved !== undefined) {
          if (active) setChainJobId(String(resolved));
          return;
        }
      } catch {
        // Keep retrying until the indexed job exposes its chain id and provider identity.
      }
      if (active) timer = window.setTimeout(() => void resolveChainJob(), 2000);
    };
    void resolveChainJob();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [jobId]);

  // Provider-declared execution capital is the requirement source of truth.
  // Do not gate creation on the separate decision endpoint: decision and capital
  // discovery are independent provider operations and can arrive in either order.
  useEffect(() => {
    if (!chainJobId) return;
    let active = true;
    let timer: number | undefined;
    const refreshRequirement = async () => {
      try {
        const response = await fetch(`/api/testnet?route=execution-capital-requirement&job=${encodeURIComponent(chainJobId)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as Requirement & { error?: string };
        if (!active) return;
        if (!response.ok) throw new Error(body?.error || "Unable to resolve the provider execution-capital requirement");
        setRequirement(body);
        if (body.required === false || !body.execution_capital) {
          setStatus("provider_authorization");
          setError("");
          return;
        }
        setStatus((current) => current === "requested" ? current : "submitting");
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Unable to resolve the provider execution-capital requirement");
        setStatus("error");
        timer = window.setTimeout(() => void refreshRequirement(), 2500);
      }
    };
    void refreshRequirement();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [chainJobId]);

  useEffect(() => {
    if (!chainJobId) return;
    let active = true;
    let timer: number | undefined;
    const refreshDecision = async () => {
      try {
        const response = await fetch(`/api/testnet?route=execution-decision&job=${encodeURIComponent(chainJobId)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as Decision | null;
        if (!active) return;
        if (body?.provider?.name) setProviderLabel(body.provider.name);
        if (body?.provider?.agent_id && !body.provider.name) setProviderLabel(body.provider.agent_id);
        if (body?.decision) setDecision(body);
        return;
      } catch {
        // Decision metadata is advisory for this gate; continue retrying for display.
      }
      if (active) timer = window.setTimeout(() => void refreshDecision(), 2500);
    };
    void refreshDecision();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [chainJobId]);

  useEffect(() => {
    if (!marketplaceJobId || !chainJobId || !requirement?.execution_capital || capitalRequestAttemptedRef.current) return;
    capitalRequestAttemptedRef.current = true;
    void requestCapital();
    // requestCapital is intentionally referenced as the stable local function below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketplaceJobId, chainJobId, requirement]);

  const symbol = requirement?.execution_capital?.symbol || requirement?.execution_market?.token_in_symbol || "execution token";
  const action = decision?.decision?.action || "state-changing action";
  const rawDecisionSource = decision?.decision?.source || decision?.observation?.source || "provider metadata";
  const decisionSource = typeof rawDecisionSource === "string" || typeof rawDecisionSource === "number" ? String(rawDecisionSource) : "provider metadata";
  const authorizationModel = displayAuthorizationModel(requirement);
  const providerNeedsCapital = Boolean(requirement?.execution_capital);

  async function requestCapital() {
    const amount = Number(requirement?.execution_capital?.required_amount || capital);
    const hours = Number(durationHours);
    if (!marketplaceJobId || !chainJobId) {
      setStatus("error");
      setError("The live marketplace and ERC-8183 job IDs are not available yet.");
      capitalRequestAttemptedRef.current = false;
      return;
    }
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
      setStatus("error");
      setError("Duration must be between 1 and 168 hours.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      setStatus("error");
      setError("The provider execution-capital requirement must contain a valid positive integer amount.");
      return;
    }
    setStatus("submitting");
    setError("");
    try {
      const response = await fetch("/api/testnet?route=execution-capital", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: marketplaceJobId, chain_job_id: chainJobId, capital_requested: amount, purpose: purpose.trim() || "Agent execution", duration_seconds: hours * 60 * 60 }),
      });
      const body = await response.json().catch(() => null) as { error?: string; request?: unknown; created?: boolean } | null;
      if (response.status !== 201 && response.status !== 200) throw new Error(body?.error || "Unable to prepare execution authorization");
      setStatus("requested");
      onRequested?.();
    } catch (cause) {
      capitalRequestAttemptedRef.current = false;
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Unable to prepare execution authorization");
    }
  }

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution Authorization · Agent Decision</small>
          <h3 className="font-display text-[18px] font-bold m-0">
            {status === "not_required" ? "No execution authorization required" : status === "provider_authorization" ? "Provider-defined authorization" : "Execution authorization required"}
          </h3>
          <p className="text-[11px] text-inksoft mt-1.5 max-w-[620px]">
            {status === "not_required"
              ? `${providerLabel} declared an observation-only path for this funded job, so no execution-capital request is created.`
              : status === "provider_authorization"
                ? `${providerLabel} declared a state-changing path using ${authorizationModel}. AgentMarket will use the authorization contract published by this provider instead of inventing an Altana or strategy-specific flow.`
                : status === "submitting"
                  ? `${providerLabel} declared execution capital. AgentMarket is creating the provider-scoped execution-capital request before any authorization or asset action.`
                  : `${providerLabel} declared a state-changing execution path (${action}). AgentMarket is resolving the provider-declared execution requirement.`}
          </p>
        </div>
        <span className="font-mono text-[9px] px-2.5 py-1 rounded-lg status-brass">{status === "not_required" ? "NOT REQUIRED" : status === "provider_authorization" ? "PROVIDER MODEL" : status === "requested" ? "WAITING" : status === "submitting" ? "PREPARING" : status === "error" ? "ERROR" : "DECIDING"}</span>
      </div>

      {decision?.decision && (
        <div className="grid sm:grid-cols-3 gap-3 mt-5">
          <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Provider decision</small><strong className="font-mono text-[11px]">{action}</strong></div>
          <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Authorization model</small><strong className="font-mono text-[11px]">{status === "not_required" ? "None" : authorizationModel}</strong></div>
          <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Decision source</small><strong className="font-mono text-[10px] break-words">{decisionSource}</strong></div>
        </div>
      )}

      {providerNeedsCapital && <div className="mt-3 text-[10px] text-inksoft">Provider-declared execution capital: <strong>{requirement?.execution_capital?.required_amount || capital} {symbol}</strong></div>}
      {status === "submitting" && <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi px-4 py-3 text-[11px] text-inksoft">Preparing the provider-scoped execution-capital request…</div>}
      {status === "requested" && <div className="mt-4 border border-green/30 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]"><strong className="text-green">Execution-capital request created.</strong> Continue to the provider authorization step below. {providerLabel} remains paused until the provider's authorization is verified.</div>}
      {status === "provider_authorization" && <div className="mt-4 border border-green/30 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]"><strong className="text-green">Provider-defined execution authorization.</strong> No marketplace-specific wallet or strategy semantics are invented.</div>}
      {error && <div className="mt-4 border border-[#cfad9f] bg-rustsoft text-rust rounded-[12px_7px_13px_8px] p-3 text-[11px] break-words"><strong className="block mb-1">Execution-capital preparation failed.</strong>{error}</div>}
      <p className="mt-4 text-[10px] text-inksoft">No token transfer, allowance, execution, or on-chain submission is performed by this preparation step.</p>
    </section>
  );
}
