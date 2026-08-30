import { useEffect, useRef, useState } from "react";

type Props = { jobId: string; jobBudget: string | number | null; jobCurrency: string; onRequested?: () => void };
type Requirement = { execution_capital?: { token?: string; symbol?: string; required_amount?: string }; execution_market?: { token_in_symbol?: string; token_out_symbol?: string; fee?: number | null } };

export default function ExecutionCapitalRequestGate({ jobId, onRequested }: Props) {
  const [capital] = useState("1");
  const [purpose] = useState("Agent execution");
  const [durationHours] = useState("24");
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "requested" | "error">("idle");
  const [error, setError] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/testnet?route=execution-capital-requirement&job=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as Requirement & { error?: string };
        if (!response.ok) throw new Error(body?.error || "Unable to resolve execution token");
        if (active) setRequirement(body);
      } catch {
        // The request endpoint performs the authoritative capability check again.
      }
    })();
    return () => { active = false; };
  }, [jobId]);

  const symbol = requirement?.execution_capital?.symbol || requirement?.execution_market?.token_in_symbol || "execution token";

  async function requestCapital() {
    const amount = 1;
    const hours = Number(durationHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
      setStatus("error");
      setError("Duration must be between 1 and 168 hours.");
      return;
    }

    setStatus("submitting");
    setError("");
    try {
      const response = await fetch("/api/testnet/execution-capital", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, capital_requested: amount, purpose: purpose.trim() || "Agent execution", duration_seconds: hours * 60 * 60, wallet_provider: "altana", authorization_model: "scoped_session" }),
      });
      const body = await response.json() as { error?: string; request?: unknown };

      // The job may already have been prepared by another page/render. That is
      // still the desired state: continue directly to the Altana authorization gate.
      if (response.status !== 201 && response.status !== 409) throw new Error(body.error || "Unable to prepare execution authorization");
      setStatus("requested");
      onRequested?.();
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Unable to prepare execution authorization");
    }
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void requestCapital();
    // The preparation request is intentionally automatic: the ERC-8183 job is
    // already funded, but Grid must remain paused until the user grants Altana.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution Capital · Authorization Required</small>
          <h3 className="font-display text-[18px] font-bold m-0">Approve Altana before the agent starts</h3>
          <p className="text-[11px] text-inksoft mt-1.5 max-w-[620px]">The ERC-8183 job is funded, so AgentMarket is preparing the execution-capital request automatically. Grid will wait on-chain for this scoped Altana authorization and will not execute or submit a deliverable before it is granted.</p>
        </div>
        <span className="font-mono text-[9px] px-2.5 py-1 rounded-lg status-brass">WAITING</span>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mt-5">
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Execution capital</small><strong className="font-mono text-[11px]">{capital} {symbol}</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Purpose</small><strong className="font-mono text-[10px]">{purpose}</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Duration</small><strong className="font-mono text-[11px]">{durationHours}h</strong></div>
      </div>

      {status === "submitting" && <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi px-4 py-3 text-[11px] text-inksoft">Preparing the authorization record…</div>}
      {status === "requested" && <div className="mt-4 border border-green/30 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]"><strong className="text-green">Authorization request ready.</strong> Continue to the Altana wallet gate below. Grid remains paused until the grant is verified.</div>}
      {error && <div className="mt-4 border border-[#cfad9f] bg-rustsoft text-rust rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px] break-words"><strong className="block mb-1">Authorization preparation failed.</strong>{error}</div>}

      <p className="mt-4 text-[10px] text-inksoft">No token transfer, allowance, execution, or on-chain submission is performed by this preparation step.</p>
    </section>
  );
}
