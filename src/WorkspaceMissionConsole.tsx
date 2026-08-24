import { useCallback, useEffect, useMemo, useState } from "react";

type JobView = {
  job: { id: string; status: string; description: string; budget: number; chain_job_id: number | null; deliverable: string | null };
  task: { id: string; status: string; title: string; role: string } | null;
  mission: { id: string; title: string; goal: string; status: string; category: string } | null;
  evaluation: { verdict: string; notes: string | null; evidence?: { source?: string; decision?: string; reasons?: string[] } | null } | null;
  payment: { amount: number; status: string; tx_hash: string | null; token_symbol: string | null } | null;
};

const STEPS = ["open", "funded", "accepted", "in_progress", "submitted"] as const;
const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());

function Status({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const color = ["terminal", "completed"].includes(lower) ? "green" : ["rejected", "cancelled", "expired", "disputed"].includes(lower) ? "rust" : "brass";
  return <span className={`font-mono text-[9.5px] rounded-lg px-2.5 py-1 status-${color}`}>{human(value)}</span>;
}

function Lifecycle({ status }: { status: string }) {
  const current = STEPS.indexOf(status as typeof STEPS[number]);
  return <div className="grid grid-cols-2 sm:grid-cols-5 overflow-hidden rounded-[14px] bg-deep">
    {STEPS.map((step, index) => <div key={step} className="border-r border-white/10 last:border-r-0 p-3.5"><span className={`block font-mono text-[8px] uppercase ${index <= current ? "text-brasslt" : "text-[#726f60]"}`}>{human(step)}</span><i className={`block w-2 h-2 rounded-full mt-2 ${index <= current ? "bg-brasslt" : "bg-[#3a3a30]"}`} /></div>)}
  </div>;
}

export default function WorkspaceMissionConsole() {
  const [jobId] = useState(() => new URLSearchParams(window.location.search).get("job") || "");
  const [data, setData] = useState<JobView | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!jobId) return;
    setRefreshing(true);
    try {
      const response = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`, { credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Unable to load job");
      setData(body as JobView);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load job");
    } finally {
      setRefreshing(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  const submitted = useMemo(() => data?.job.status.toLowerCase() === "submitted", [data]);

  if (!jobId) {
    return <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8"><section className="card-asym-lg bg-paperhi p-7 md:p-8"><span className="font-mono text-[9.5px] uppercase tracking-widest text-brass">MISSIONS / CONSOLE</span><h1 className="mt-3 font-display text-[30px] font-bold tracking-tight">No mission selected.</h1><p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-inksoft">Open the console from the Missions page so the live marketplace job record can be loaded.</p><a href="/missions" className="btn-asym mt-5 inline-flex bg-ink px-5 py-3 font-display text-[12px] font-bold text-paperhi no-underline">Back to missions →</a></section></main>;
  }

  return <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8">
    <div className="flex items-center justify-between mb-5"><span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Missions / Mission console</span><a href="/missions" className="text-[11px] font-bold text-inksoft no-underline hover:text-ink">← Back to missions</a></div>
    {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust">{error}</div>}
    {!data ? <section className="card-asym-lg bg-paperhi p-7 text-[13px] text-inksoft">Loading mission state…</section> : <section className="card-asym-lg bg-paperhi p-6 md:p-8">
      <div className="grid sm:grid-cols-2 gap-4 mb-6 pb-6 dash-b">
        <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Mission</small><strong className="text-[15px] font-bold">{data.mission?.title || "Agent mission"}</strong></div>
        <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Agent</small><strong className="text-[15px] font-bold">{data.task?.role || "Provider"}</strong></div>
        <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Chain job ID</small><strong className="font-mono text-[14px]">{data.job.chain_job_id == null ? "Not created" : `#${data.job.chain_job_id}`}</strong></div>
        <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Budget</small><strong className="font-mono text-[14px]">{data.job.budget} {data.payment?.token_symbol || "tBNB"}</strong></div>
      </div>

      <span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-brass mb-3"><span className="w-1.5 h-1.5 rounded-full bg-brass" />Job lifecycle</span>
      <p className="text-[13px] text-inksoft mb-5 max-w-[560px]">Same states this mission's real job record moves through. State changes are read from the marketplace and Testnet job, not simulated by the UI.</p>
      <div className="mb-6"><Lifecycle status={data.job.status.toLowerCase()} /></div>

      {data.job.deliverable && <div className="border border-line rounded-[16px_8px_18px_9px] p-4 mb-6 bg-paper"><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1.5">Deliverable</small><strong className="font-display text-[12.5px]">Submitted for evaluation</strong></div>}

      <div className="flex gap-3 mb-2"><button type="button" className="font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym" disabled={refreshing} onClick={() => void load()}>{refreshing ? "Checking live state…" : "Advance state →"}</button></div>

      {submitted && <div className="mt-8 pt-8 dash-t">
        <span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-green mb-3"><span className="w-1.5 h-1.5 rounded-full bg-green" />Evaluator & settlement</span>
        <h2 className="font-display text-[20px] font-bold tracking-tight mb-1">Verified, then settled.</h2>
        <p className="text-[13px] text-inksoft mb-5 max-w-[560px]">The optimistic policy opens a dispute window before funds move.</p>
        <div className="border border-line rounded-[18px_9px_20px_10px] p-5 mb-5 bg-paper"><div className="flex justify-between items-center mb-3"><strong className="text-[14px] font-bold">Evaluation verdict</strong><Status value={data.evaluation?.verdict || "pending"} /></div><p className="text-[12px] text-inksoft mb-3">{data.evaluation?.notes || "Awaiting the live evaluator decision."}</p></div>
        <div className="grid sm:grid-cols-2 gap-3 mb-6"><div className="border border-green/30 bg-greensoft rounded-[14px_8px_16px_9px] p-4"><strong className="block text-[12.5px] font-bold text-green mb-1">settlement</strong><span className="text-[10.5px] text-inksoft">Payment is released only when the real ERC-8183 policy reaches the settlement state.</span></div><div className="border border-line rounded-[14px_8px_16px_9px] p-4"><strong className="block text-[12.5px] font-bold mb-1">dispute / refund</strong><span className="text-[10.5px] text-inksoft">Protocol-valid dispute and refund paths remain available through the live policy state.</span></div></div>
        <div className="border border-line rounded-[16px_8px_18px_9px] p-4 bg-paper flex justify-between items-center"><div><strong className="block text-[13px] font-bold">Terminal state</strong><span className="text-[11px] text-inksoft">Payment state and evidence continue to come from the live job record.</span></div><Status value={data.job.status} /></div>
      </div>}
    </section>}
  </main>;
}
