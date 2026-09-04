import { useEffect, useRef, useState } from "react";

type Props = { jobId: string; chainJobId?: string; jobBudget?: string | number | null; jobCurrency?: string; onRequested?: () => void };
type Requirement = { execution_capital?: { token?: string; symbol?: string; required_amount?: string }; execution_market?: { token_in_symbol?: string; token_out_symbol?: string; fee?: number | null } };

export default function ExecutionCapitalRequestGate({ jobId, chainJobId, onRequested }: Props) {
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "requested" | "not_required" | "error">("idle");
  const [error, setError] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const target = chainJobId || jobId;
        const response = await fetch(`/api/testnet?route=execution-capital-requirement&job=${encodeURIComponent(target)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as Requirement & { error?: string };
        if (!response.ok) throw new Error(body?.error || "Unable to resolve execution token");
        if (active) setRequirement(body);
      } catch {
        // The authoritative preparation endpoint validates capability again.
      }
    })();
    return () => { active = false; };
  }, [jobId, chainJobId]);

  const symbol = requirement?.execution_capital?.symbol || requirement?.execution_market?.token_in_symbol || "execution token";

  async function requestCapital() {
    if (!chainJobId) {
      setStatus("error");
      setError("A confirmed ERC-8183 chain job ID is required before execution authorization can be prepared.");
      return;
    }
    setStatus("submitting");
    setError("");
    try {
      const response = await fetch("/api/testnet?route=execution-authorization-prepare", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, chain_job_id: chainJobId, capital_requested: 1, purpose: "Agent execution", duration_seconds: 24 * 60 * 60 }),
      });
      const body = await response.json().catch(() => null) as { error?: string; required?: boolean; request?: unknown } | null;
      if (!response.ok) throw new Error(body?.error || "Unable to prepare execution authorization");
      if (body?.required === false) {
        setStatus("not_required");
        return;
      }
      setStatus("requested");
      onRequested?.();
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Unable to prepare execution authorization");
    }
  }

  useEffect(() => {
    if (startedRef.current || !chainJobId) return;
    startedRef.current = true;
    void requestCapital();
    // Preparation is automatic only for a confirmed job. It does not transfer
    // capital or execute anything; Passkey approval happens in the next gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, chainJobId]);

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution Authorization</small>
          <h3 className="font-display text-[18px] font-bold m-0">Authorize the agent before it executes</h3>
          <p className="text-[11px] text-inksoft mt-1.5 max-w-[620px]">The ERC-8183 job is confirmed. AgentMarket prepares a request-scoped Altana session only for a provider that explicitly advertises this capability. No execution token is transferred by this step.</p>
        </div>
        <span className={`font-mono text-[9px] px-2.5 py-1 rounded-lg ${status === "requested" ? "status-green" : status === "not_required" ? "status-green" : "status-brass"}`}>{status === "requested" ? "READY" : status === "not_required" ? "NOT REQUIRED" : status.toUpperCase()}</span>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mt-5">
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Execution capital</small><strong className="font-mono text-[11px]">1 {symbol}</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Authorization</small><strong className="font-mono text-[10px]">Altana scoped session</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Duration</small><strong className="font-mono text-[11px]">24h</strong></div>
      </div>

      {status === "submitting" && <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi px-4 py-3 text-[11px] text-inksoft">Preparing the job-scoped authorization record…</div>}
      {status === "requested" && <div className="mt-4 border border-green/30 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]"><strong className="text-green">Authorization request ready.</strong> Continue to the Altana wallet and Passkey scope below. The provider remains paused until the grant is independently verified.</div>}
      {status === "not_required" && <div className="mt-4 border border-green/30 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px] text-green"><strong>No execution authorization required.</strong> This provider does not advertise a scoped execution capability for this job.</div>}
      {error && <div className="mt-4 border border-[#cfad9f] bg-rustsoft text-rust rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px] break-words"><strong className="block mb-1">Authorization preparation failed.</strong>{error}</div>}
      <p className="mt-4 text-[10px] text-inksoft">No token transfer, allowance, agent execution, or ERC-8183 fund transaction is performed by this preparation step.</p>
    </section>
  );
}
