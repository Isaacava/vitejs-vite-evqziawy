import { useEffect, useRef, useState } from "react";

type Props = { jobId: string; jobBudget: string | number | null; jobCurrency: string; onRequested?: () => void };
type Requirement = { execution_capital?: { token?: string; symbol?: string; required_amount?: string }; execution_market?: { token_in_symbol?: string; token_out_symbol?: string; fee?: number | null } };
type Decision = { execution_required?: boolean; authorization_required?: boolean; decision?: { action?: string; [key: string]: unknown }; observation?: Record<string, unknown>; error?: string; pending?: boolean; provider?: { name?: string | null; agent_id?: string | null } };
type JobLookup = { job?: { id?: string; chain_job_id?: number | null; status?: string }; chain?: { chain_job_id?: number | null }; task?: { title?: string | null; role?: string | null }; agent?: { name?: string | null; agent_id?: string | null }; provider?: { name?: string | null; agent_id?: string | null } };

export default function ExecutionCapitalRequestGate({ jobId, onRequested }: Props) {
  const [capital] = useState("1");
  const [purpose] = useState("Agent execution");
  const [durationHours] = useState("24");
  const [marketplaceJobId, setMarketplaceJobId] = useState("");
  const [chainJobId, setChainJobId] = useState<string>("");
  const [providerLabel, setProviderLabel] = useState("Selected provider");
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [status, setStatus] = useState<"waiting_decision" | "submitting" | "requested" | "not_required" | "error">("waiting_decision");
  const [error, setError] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const resolveChainJob = async () => {
      try {
        const response = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as JobLookup | null;
        const resolved = body?.chain?.chain_job_id ?? body?.job?.chain_job_id;
        const resolvedMarketplaceId = typeof body?.job?.id === "string" ? body.job.id.trim() : "";
        const resolvedProvider = body?.agent?.name || body?.provider?.name || body?.task?.role || body?.task?.title || body?.agent?.agent_id || body?.provider?.agent_id || "Selected provider";
        if (active) {
          if (resolvedMarketplaceId) setMarketplaceJobId(resolvedMarketplaceId);
          setProviderLabel(String(resolvedProvider));
        }
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
        if (response.ok && body?.decision) {
          if (body.execution_required) {
            if (!startedRef.current) {
              startedRef.current = true;
              void requestCapital();
            }
          } else {
            setStatus("not_required");
            setError("");
          }
          return;
        }
      } catch {
        // Keep polling until the provider publishes its decision.
      }
      if (active) timer = window.setTimeout(() => void refreshDecision(), 2000);
    };
    void refreshDecision();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
    // requestCapital is intentionally referenced as the stable local function below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainJobId]);

  useEffect(() => {
    if (!decision?.execution_required || !chainJobId) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/testnet?route=execution-capital-requirement&job=${encodeURIComponent(chainJobId)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as Requirement & { error?: string };
        if (response.ok && active) setRequirement(body);
      } catch {
        // The authorization preparation endpoint performs the authoritative capability check again.
      }
    })();
    return () => { active = false; };
  }, [chainJobId, decision?.execution_required]);

  const symbol = requirement?.execution_capital?.symbol || requirement?.execution_market?.token_in_symbol || "execution token";
  const action = decision?.decision?.action || "state-changing action";

  async function requestCapital() {
    const amount = 1;
    const hours = Number(durationHours);
    if (!marketplaceJobId || !chainJobId) {
      setStatus("error");
      setError("The live marketplace and ERC-8183 job IDs are not available yet.");
      return;
    }
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
      setStatus("error");
      setError("Duration must be between 1 and 168 hours.");
      return;
    }
    setStatus("submitting");
    setError("");
    try {
      const response = await fetch("/api/testnet?route=execution-capital", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: marketplaceJobId, chain_job_id: chainJobId, capital_requested: amount, purpose: purpose.trim() || "Agent execution", duration_seconds: hours * 60 * 60, wallet_provider: "altana", authorization_model: "scoped_session" }),
      });
      const body = await response.json() as { error?: string; request?: unknown; created?: boolean };
      if (response.status !== 201 && response.status !== 200) throw new Error(body.error || "Unable to prepare execution authorization");
      setStatus("requested");
      onRequested?.();
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Unable to prepare execution authorization");
    }
  }

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution Capital · Agent Decision</small>
          <h3 className="font-display text-[18px] font-bold m-0">{status === "not_required" ? "No execution authorization required" : "Execution authorization required"}</h3>
          <p className="text-[11px] text-inksoft mt-1.5 max-w-[620px]">
            {status === "not_required"
              ? `${providerLabel} evaluated the funded job and chose an observation-only action, so no execution-capital request is created.`
              : `${providerLabel} evaluated the funded job and chose ${action}. AgentMarket is preparing authorization only because that decision requires a state-changing action.`}
          </p>
        </div>
        <span className="font-mono text-[9px] px-2.5 py-1 rounded-lg status-brass">{status === "not_required" ? "NOT REQUIRED" : status === "requested" ? "WAITING" : status === "submitting" ? "PREPARING" : "DECIDING"}</span>
      </div>

      {decision?.decision && (
        <div className="grid sm:grid-cols-3 gap-3 mt-5">
          <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Agent decision</small><strong className="font-mono text-[11px]">{action}</strong></div>
          <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Execution capital</small><strong className="font-mono text-[11px]">{status === "not_required" ? "Not required" : `${capital} ${symbol}`}</strong></div>
          <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Duration</small><strong className="font-mono text-[11px]">{status === "not_required" ? "—" : `${durationHours}h`}</strong></div>
        </div>
      )}

      {!chainJobId && status === "waiting_decision" && <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi px-4 py-3 text-[11px] text-inksoft">Resolving the live ERC-8183 job ID…</div>}
      {chainJobId && status === "waiting_decision" && <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi px-4 py-3 text-[11px] text-inksoft">Waiting for {providerLabel} to evaluate the funded job…</div>}
      {status === "submitting" && <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi px-4 py-3 text-[11px] text-inksoft">Preparing the authorization record…</div>}
      {status === "requested" && <div className="mt-4 border border-green/30 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]"><strong className="text-green">Authorization request ready.</strong> Continue to the Altana wallet gate below. {providerLabel} remains paused until the grant is verified.</div>}
      {status === "not_required" && <div className="mt-4 border border-green/30 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]"><strong className="text-green">Observation-only execution.</strong> The agent will submit its result without an execution-capital request.</div>}
      {error && <div className="mt-4 border border-[#cfad9f] bg-rustsoft text-rust rounded-[12px_7px_13px_8px] p-3 text-[11px] break-words"><strong className="block mb-1">Authorization preparation failed.</strong>{error}</div>}
      <p className="mt-4 text-[10px] text-inksoft">No token transfer, allowance, execution, or on-chain submission is performed by this preparation step.</p>
    </section>
  );
}
