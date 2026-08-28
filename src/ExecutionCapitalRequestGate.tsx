import { useEffect, useState } from "react";

type Props = { jobId: string; jobBudget: string | number | null; jobCurrency: string; onRequested?: () => void };
type Requirement = { execution_capital?: { token?: string; symbol?: string; required_amount?: string }; execution_market?: { token_in_symbol?: string; token_out_symbol?: string; fee?: number | null } };

export default function ExecutionCapitalRequestGate({ jobId, onRequested }: Props) {
  const [capital] = useState("1");
  const [purpose, setPurpose] = useState("Agent execution");
  const [durationHours, setDurationHours] = useState("24");
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "requested" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/testnet?route=execution-capital-requirement&job=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as Requirement & { error?: string };
        if (!response.ok) throw new Error(body?.error || "Unable to resolve execution token");
        if (active) setRequirement(body);
      } catch {
        // The request endpoint will perform the authoritative capability check again.
      }
    })();
    return () => { active = false; };
  }, [jobId]);

  const symbol = requirement?.execution_capital?.symbol || requirement?.execution_market?.token_in_symbol || "execution token";

  async function requestCapital() {
    const amount = 1;
    const hours = Number(durationHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) { setStatus("error"); setError("Duration must be between 1 and 168 hours."); return; }
    setStatus("submitting"); setError("");
    try {
      const response = await fetch("/api/testnet/execution-capital", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, capital_requested: amount, purpose: purpose.trim() || "Agent execution", duration_seconds: hours * 60 * 60, wallet_provider: "altana", authorization_model: "scoped_session" }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to request execution capital");
      setStatus("requested"); onRequested?.();
    } catch (cause) { setStatus("error"); setError(cause instanceof Error ? cause.message : "Unable to request execution capital"); }
  }

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution Capital</small>
          <h3 className="font-display text-[18px] font-bold m-0">Request the agent's execution capital</h3>
          <p className="text-[11px] text-inksoft mt-1.5 max-w-[620px]">AgentMarket reads the selected provider's execution capability first. The request is separate from the ERC-8183 job payment and does not transfer anything by itself.</p>
        </div>
        <span className="font-mono text-[9px] px-2.5 py-1 rounded-lg status-brass">TESTNET</span>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mt-5">
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Execution capital</small><strong className="font-mono text-[11px]">{capital} {symbol}</strong></div>
        <label className="block sm:col-span-2"><span className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Purpose</span><input value={purpose} onChange={(event) => setPurpose(event.target.value)} className="w-full border border-line rounded-[12px_7px_13px_8px] bg-paperhi px-3 py-2.5 outline-none text-[11px]" aria-label="Execution capital purpose" /></label>
      </div>

      <label className="block mt-3 max-w-[220px]"><span className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Duration</span><div className="flex items-center gap-2 border border-line rounded-[12px_7px_13px_8px] bg-paperhi px-3 py-2.5"><input value={durationHours} onChange={(event) => setDurationHours(event.target.value)} inputMode="numeric" className="w-full bg-transparent outline-none font-mono text-[11px]" aria-label="Duration in hours" /><span className="font-mono text-[9px] text-inksoft">hours</span></div></label>

      {error && <div className="mt-4 border border-[#cfad9f] bg-rustsoft text-rust rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px] break-words"><strong className="block mb-1">Request failed.</strong>{error}</div>}
      {status === "requested" && <div className="mt-4 border border-green/30 bg-green/5 rounded-[12px_7px_13px_8px] px-4 py-3 text-[11px]"><strong className="text-green">{capital} {symbol} request created.</strong> Continue to the Altana execution-wallet gate to inspect balances and fund only the missing amount.</div>}

      <button type="button" onClick={() => void requestCapital()} disabled={status === "submitting" || status === "requested"} className="mt-5 font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym">{status === "submitting" ? "Creating request…" : status === "requested" ? `${capital} ${symbol} request created ✓` : `Request ${capital} ${symbol} execution capital →`}</button>
      <p className="mt-3 text-[10px] text-inksoft">No token transfer or trading transaction is broadcast by this request step.</p>
    </section>
  );
}
