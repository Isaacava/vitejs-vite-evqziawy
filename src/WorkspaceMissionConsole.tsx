import { useCallback, useEffect, useMemo, useState } from "react";

 type JobView = {
  job: { id: string; status: string; description: string; budget: number; chain_job_id: number | null; deliverable: string | null };
  task: { id: string; status: string; title: string; role: string } | null;
  mission: { id: string; title: string; goal: string; status: string; category: string } | null;
  evaluation: { verdict: string; notes: string | null; evidence?: { source?: string; decision?: string; reasons?: string[] } | null } | null;
  payment: { amount: number; status: string; tx_hash: string | null; token_symbol: string | null } | null;
};

const STEPS = ["open", "funded", "accepted", "in_progress", "submitted", "terminal"];
const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
const compact = (value?: string | number | null) => (value == null ? "—" : String(value).length > 18 ? `${String(value).slice(0, 8)}…${String(value).slice(-6)}` : String(value));

function Status({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const color = ["terminal", "completed"].includes(lower) ? "green" : ["rejected", "cancelled", "expired", "disputed"].includes(lower) ? "rust" : "brass";
  return <span className={`font-mono text-[9.5px] rounded-lg px-2.5 py-1 status-${color}`}>{human(value)}</span>;
}

function Lifecycle({ status }: { status: string }) {
  const index = STEPS.indexOf(status);
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-[14px] bg-deep sm:grid-cols-3 lg:grid-cols-6">
      {STEPS.map((step, stepIndex) => (
        <div key={step} className="border-b border-white/10 p-2 last:border-0 sm:border-r lg:border-b-0 lg:last:border-r-0">
          <span className={`block font-mono text-[7.5px] uppercase ${stepIndex <= index ? "text-brasslt" : "text-[#726f60]"}`}>{human(step)}</span>
          <i className={`mt-1.5 block h-1.5 w-1.5 rounded-full ${stepIndex <= index ? "bg-brasslt" : "bg-[#3a3a30]"}`} />
        </div>
      ))}
    </div>
  );
}

export default function WorkspaceMissionConsole() {
  const [jobId] = useState(() => new URLSearchParams(window.location.search).get("job") || "");
  const [data, setData] = useState<JobView | null>(null);
  const [deliverable, setDeliverable] = useState("Completed the requested task and prepared the result for review.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!jobId) return;
    const response = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`, { credentials: "include" });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || "Unable to load job");
    setData(body as JobView);
  }, [jobId]);

  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load job"));
  }, [load]);

  async function action(name: string) {
    if (!jobId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, action: name, deliverable }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Job action failed");
      setMessage(`${human(name)} recorded. Current state: ${human(body.state)}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Job action failed");
    } finally {
      setBusy(false);
    }
  }

  const statusIndex = useMemo(() => (data ? STEPS.indexOf(data.job.status) : -1), [data]);
  const canPrepare = !!data && ["open", "funded"].includes(data.job.status) && !data.job.chain_job_id;
  const riskEvidence = data?.evaluation?.evidence;

  if (!jobId) {
    return (
      <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8">
        <section className="card-asym-lg bg-paperhi p-7 md:p-8">
          <span className="font-mono text-[9.5px] uppercase tracking-widest text-brass">MISSIONS / CONSOLE</span>
          <h1 className="mt-3 font-display text-[30px] font-bold tracking-tight">No mission selected.</h1>
          <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-inksoft">Open the console from the Missions page so the real marketplace job record can be loaded.</p>
          <a href="/missions" className="btn-asym mt-5 inline-flex bg-ink px-5 py-3 font-display text-[12px] font-bold text-paperhi no-underline">Back to missions →</a>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Missions / Mission console</span>
        <a href="/missions" className="text-[11px] font-bold text-inksoft no-underline hover:text-ink">← Back to missions</a>
      </div>

      {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust">{error}</div>}
      {message && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-green/20 bg-greensoft px-4 py-3 text-[12px] text-green">{message}</div>}

      {!data ? (
        <section className="card-asym-lg bg-paperhi p-7 text-[13px] text-inksoft">Loading mission state…</section>
      ) : (
        <>
          <section className="card-asym-lg bg-paperhi p-6 md:p-8">
            <div className="grid gap-5 border-b border-dashed border-[#c8c0af] pb-6 sm:grid-cols-2">
              <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Mission</small><strong className="mt-1 block text-[15px] font-bold">{data.mission?.title || "Agent mission"}</strong></div>
              <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Agent / role</small><strong className="mt-1 block text-[15px] font-bold">{data.task?.role || "Provider"}</strong></div>
              <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Chain job ID</small><strong className="mt-1 block font-mono text-[14px]">{data.job.chain_job_id == null ? "Not created" : `#${data.job.chain_job_id}`}</strong></div>
              <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Budget</small><strong className="mt-1 block font-mono text-[14px]">{data.job.budget}</strong></div>
            </div>

            <div className="mt-7">
              <span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-brass"><span className="h-1.5 w-1.5 rounded-full bg-brass" />Job lifecycle</span>
              <p className="mt-2 max-w-[620px] text-[13px] leading-relaxed text-inksoft">These states are read from the actual marketplace/chain job. The UI never advances a job by itself.</p>
              <div className="mt-4"><Lifecycle status={data.job.status} /></div>
            </div>

            {data.job.deliverable && (
              <div className="mt-6 rounded-[16px_8px_18px_9px] border border-line bg-paper p-4">
                <small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Deliverable hash</small>
                <strong className="mt-1.5 block break-all font-mono text-[12px]">{data.job.deliverable}</strong>
              </div>
            )}
          </section>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <section className="card-asym bg-paperhi p-[18px]">
              <div className="flex items-center justify-between border-b border-dashed border-[#c8c0af] pb-3">
                <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">01 / Agent workflow</span>
                <Status value={data.job.status} />
              </div>

              {canPrepare && (
                <div className="mt-5 rounded-[18px_9px_20px_10px] border border-brass/30 bg-brasssoft/50 p-5">
                  <small className="block font-mono text-[8.5px] uppercase text-brass">ERC-8183</small>
                  <strong className="mt-1 block font-display text-[17px] font-bold">Turn this mission into a wallet-ready job.</strong>
                  <p className="mt-1 text-[11px] text-inksoft">Create → policy → budget → approve → fund. Each transaction remains wallet-signed and confirmed before the next dependent action.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a href={`/prepare?mission=${encodeURIComponent(data.mission?.id || "")}`} className="btn-asym bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi no-underline">Prepare on-chain →</a>
                    <a href={`/prepare/execute?mission=${encodeURIComponent(data.mission?.id || "")}`} className="btn-asym border border-line bg-paperhi px-4 py-2.5 font-display text-[11px] font-bold text-ink no-underline">Open wallet execution →</a>
                  </div>
                </div>
              )}

              {data.job.chain_job_id && data.job.status === "open" && (
                <a href={`/testnet/execute?mission=${encodeURIComponent(data.mission?.id || "")}`} className="btn-asym mt-5 inline-flex bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi no-underline">Continue wallet execution →</a>
              )}

              {data.job.status === "open" && <button className="btn-asym mt-5 bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi" disabled={busy} onClick={() => void action("accept")}>Accept job →</button>}

              {data.job.status === "accepted" && <button className="btn-asym mt-5 bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi" disabled={busy} onClick={() => void action("start")}>Start execution →</button>}

              {data.job.status === "in_progress" && (
                <div className="mt-5">
                  <label className="block font-mono text-[9px] uppercase tracking-wide text-[#8a8477]">Deliverable / evidence</label>
                  <textarea value={deliverable} onChange={(event) => setDeliverable(event.target.value)} rows={7} className="mt-2 w-full resize-y rounded-[16px_8px_18px_9px] border border-line bg-paper p-4 text-[12px] leading-relaxed outline-none focus:border-brass" />
                  <button className="btn-asym mt-3 bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi" disabled={busy || !deliverable.trim()} onClick={() => void action("submit")}>Submit deliverable →</button>
                </div>
              )}

              {data.job.status === "submitted" && (
                <div className="mt-5 rounded-[16px_8px_18px_9px] border border-green/20 bg-greensoft p-4">
                  <small className="block font-mono text-[8.5px] uppercase text-green">Evaluator / settlement</small>
                  <strong className="mt-1 block text-[14px] font-bold">Read the live ERC-8183 policy state.</strong>
                  <p className="mt-1 text-[11px] text-inksoft">The marketplace does not mark payment released because a UI action was clicked. The chain and policy remain authoritative.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {data.job.chain_job_id != null && <a href={`/testnet/review?job=${encodeURIComponent(String(data.job.chain_job_id))}&mission=${encodeURIComponent(data.mission?.id || "")}&marketplaceJob=${encodeURIComponent(data.job.id)}`} className="btn-asym bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi no-underline">Open evaluator →</a>}
                    {data.job.chain_job_id != null && <a href={`/lifecycle?job=${encodeURIComponent(String(data.job.chain_job_id))}`} className="btn-asym border border-line bg-paperhi px-4 py-2.5 font-display text-[11px] font-bold text-ink no-underline">Open recovery paths →</a>}
                  </div>
                </div>
              )}

              {data.job.status === "terminal" && <div className="mt-5 rounded-[16px_8px_18px_9px] border border-green/20 bg-greensoft p-4 text-[11px] text-green">The job is terminal. Review the evidence and real transaction record before treating the mission as fully complete.</div>}

              {data.job.chain_job_id != null && !["submitted", "terminal"].includes(data.job.status) && (
                <div className="mt-5 border-t border-dashed border-[#d5cfbf] pt-5">
                  <strong className="block text-[13px] font-bold">Need a recovery path?</strong>
                  <p className="mt-1 text-[11px] text-inksoft">Dispute, expiry and other protocol-valid recovery actions are handled by the live lifecycle workspace.</p>
                  <a href={`/lifecycle?job=${encodeURIComponent(String(data.job.chain_job_id))}`} className="mt-3 inline-flex font-extrabold text-[11px] text-brass no-underline">Open lifecycle →</a>
                </div>
              )}
            </section>

            <aside className="card-asym bg-paperhi p-[18px]">
              <div className="flex items-center justify-between border-b border-dashed border-[#c8c0af] pb-3">
                <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">02 / Escrow & evidence</span>
                <Status value={data.payment?.status || "pending"} />
              </div>
              <div className="mt-1 divide-y divide-linesoft">
                <div className="flex items-center justify-between gap-4 py-4"><span className="text-[10.5px] text-inksoft">Budget</span><strong className="font-mono text-[12px]">{data.job.budget}</strong></div>
                <div className="flex items-center justify-between gap-4 py-4"><span className="text-[10.5px] text-inksoft">Chain job</span><strong className="font-mono text-[12px]">{data.job.chain_job_id ?? "Pending"}</strong></div>
                <div className="flex items-center justify-between gap-4 py-4"><span className="text-[10.5px] text-inksoft">Evaluation</span><strong className="text-[12px] font-bold">{data.evaluation?.verdict || "Pending"}</strong></div>
                <div className="flex items-center justify-between gap-4 py-4"><span className="text-[10.5px] text-inksoft">Payment TX</span><strong className="font-mono text-[10px]">{compact(data.payment?.tx_hash)}</strong></div>
              </div>

              {riskEvidence?.source === "risk_guardian_runtime" && (
                <div className="mt-4 rounded-[14px_8px_16px_9px] border border-line bg-paper p-4">
                  <small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Risk Guardian</small>
                  <strong className="mt-1 block text-[13px] font-bold">{human(riskEvidence.decision || "pending")}</strong>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-inksoft">{riskEvidence.reasons?.join(" ") || "Decision recorded without additional reasons."}</p>
                </div>
              )}

              <div className="mt-4 border-t border-dashed border-[#d5cfbf] pt-4">
                <small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Source of truth</small>
                <p className="mt-1 text-[10.5px] leading-relaxed text-inksoft">Supabase stores marketplace workflow records. Blockchain job IDs, transaction hashes and policy state are shown only when real chain records exist.</p>
              </div>
            </aside>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-dashed border-[#d5cfbf] pt-4 font-mono text-[9.5px] text-[#8a8477]">
            <span>Marketplace job {compact(data.job.id)}</span>
            <span>Mission {compact(data.mission?.id)}</span>
            <span>Workflow {Math.max(statusIndex + 1, 0)}/{STEPS.length}</span>
          </div>
        </>
      )}
    </main>
  );
}
