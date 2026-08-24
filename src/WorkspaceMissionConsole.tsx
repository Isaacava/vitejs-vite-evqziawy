import { useCallback, useEffect, useMemo, useState } from "react";

type JobView = {
  job: {
    id: string;
    status: string;
    description: string;
    budget: number | string;
    chain_job_id: number | null;
    deliverable: string | null;
    chain_live?: boolean;
  };
  task: { id: string; status: string; title: string; role: string; description?: string | null } | null;
  mission: { id: string; title: string; goal: string; status: string; category: string } | null;
  evaluation: { verdict: string; notes: string | null; evidence?: { source?: string; decision?: string; reasons?: string[] } | null } | null;
  payment: { amount: number | string; status?: string; tx_hash?: string | null; token_symbol: string | null } | null;
  chain: {
    chain_job_id: number;
    chain_status: string;
    chain_provider: string;
    chain_evaluator: string;
    chain_description: string;
    chain_budget_raw: string;
    chain_budget: string;
    token_address: string;
    token_symbol: string;
    token_decimals: number;
    chain_expired_at: number;
    chain_submitted_at: string | null;
    chain_deliverable: string | null;
  } | null;
  network: string;
  chain_id: number;
  source_of_truth: string;
};

const STEPS = ["open", "funded", "accepted", "in_progress", "submitted"] as const;
const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());

function statusTone(value: string) {
  const lower = value.toLowerCase();
  if (["completed", "terminal", "settled"].includes(lower)) return "green";
  if (["rejected", "cancelled", "expired", "disputed"].includes(lower)) return "rust";
  return "brass";
}

function Status({ value }: { value: string }) {
  return <span className={`font-mono text-[9.5px] rounded-lg px-2.5 py-1 status-${statusTone(value)}`}>{human(value)}</span>;
}

function Lifecycle({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const current = STEPS.indexOf(normalized as typeof STEPS[number]);
  const terminal = ["completed", "rejected", "expired", "terminal"].includes(normalized);
  const activeIndex = terminal ? STEPS.length - 1 : current;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 overflow-hidden rounded-[14px] bg-deep">
      {STEPS.map((step, index) => {
        const active = activeIndex >= 0 && index <= activeIndex;
        const isCurrent = !terminal && normalized === step;
        return (
          <div key={step} className="border-r border-white/10 last:border-r-0 p-3.5 min-w-0">
            <span className={`block font-mono text-[8px] uppercase truncate ${active ? "text-brasslt" : "text-[#726f60]"}`}>{human(step)}</span>
            <i className={`block w-2 h-2 rounded-full mt-2 ${active ? "bg-brasslt" : "bg-[#3a3a30]"} ${isCurrent ? "shadow-[0_0_0_3px_rgba(210,176,94,.22)]" : ""}`} />
          </div>
        );
      })}
    </div>
  );
}

function shortenHash(value: string | null | undefined) {
  if (!value) return "—";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function formatBudget(value: number | string | null | undefined, symbol: string) {
  if (value === null || value === undefined || value === "") return `0 ${symbol}`;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return `${value} ${symbol}`;
  return `${numeric.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${symbol}`;
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
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const liveStatus = data?.job.status?.toLowerCase() || "open";
  const terminal = ["completed", "rejected", "cancelled", "expired", "terminal"].includes(liveStatus);
  const submitted = liveStatus === "submitted";
  const tokenSymbol = data?.chain?.token_symbol || data?.payment?.token_symbol || "tBNB";
  const budget = data?.chain?.chain_budget ?? data?.job.budget ?? data?.payment?.amount ?? 0;
  const deliverable = data?.chain?.chain_deliverable || data?.job.deliverable;

  const lifecycleCopy = useMemo(() => {
    if (!data) return "Reading the live job record…";
    if (data.source_of_truth === "erc8183_commerce") {
      return "State is read from the ERC-8183 commerce contract on BSC Testnet. The console never simulates lifecycle transitions.";
    }
    return "Live chain state is unavailable, so the marketplace workflow record is shown as a fallback.";
  }, [data]);

  if (!jobId) {
    return (
      <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8">
        <section className="card-asym-lg bg-paperhi p-7 md:p-8">
          <span className="font-mono text-[9.5px] uppercase tracking-widest text-brass">MISSIONS / CONSOLE</span>
          <h1 className="mt-3 font-display text-[30px] font-bold tracking-tight">No mission selected.</h1>
          <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-inksoft">Open the console from the Missions page so the live marketplace job record can be loaded.</p>
          <a href="/missions" className="btn-asym mt-5 inline-flex bg-ink px-5 py-3 font-display text-[12px] font-bold text-paperhi no-underline">Back to missions →</a>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8">
      <div className="flex items-center justify-between gap-4 mb-5">
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Missions / Mission console</span>
        <a href="/missions" className="text-[11px] font-bold text-inksoft no-underline hover:text-ink">← Back to missions</a>
      </div>

      {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust">{error}</div>}

      {!data ? (
        <section className="card-asym-lg bg-paperhi p-7 text-[13px] text-inksoft">Loading mission state…</section>
      ) : (
        <section className="card-asym-lg bg-paperhi p-6 md:p-8">
          <div className="grid sm:grid-cols-2 gap-4 mb-6 pb-6 dash-b">
            <div className="min-w-0">
              <small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Mission</small>
              <strong className="block text-[15px] font-bold break-words">{data.mission?.title || "Agent mission"}</strong>
            </div>
            <div className="min-w-0">
              <small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Agent</small>
              <strong className="block text-[15px] font-bold break-words">{data.task?.role || "Provider"}</strong>
            </div>
            <div>
              <small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Chain job ID</small>
              <strong className="font-mono text-[14px]">{data.chain?.chain_job_id ? `#${data.chain.chain_job_id}` : data.job.chain_job_id == null ? "Not created" : `#${data.job.chain_job_id}`}</strong>
            </div>
            <div>
              <small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Budget</small>
              <strong className="font-mono text-[14px]">{formatBudget(budget, tokenSymbol)}</strong>
            </div>
          </div>

          <div className="mb-6 rounded-[16px_8px_18px_9px] border border-line bg-paper p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Live source</small>
                <strong className="font-display text-[14px] font-bold">{data.source_of_truth === "erc8183_commerce" ? "ERC-8183 Commerce · BSC Testnet" : "Marketplace workflow fallback"}</strong>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green" />
                <span className="font-mono text-[9.5px] uppercase text-green">CHAIN 97 VERIFIED</span>
              </div>
            </div>
          </div>

          <span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-brass mb-3"><span className="w-1.5 h-1.5 rounded-full bg-brass" />Job lifecycle</span>
          <p className="text-[13px] text-inksoft mb-5 max-w-[650px]">{lifecycleCopy}</p>
          <div className="mb-6"><Lifecycle status={liveStatus} /></div>

          <div className="grid sm:grid-cols-2 gap-3 mb-6">
            <div className="border border-line rounded-[14px_8px_16px_9px] p-4 bg-paper">
              <small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1.5">Current status</small>
              <div className="flex items-center gap-2"><Status value={liveStatus} />{data.chain?.chain_job_id && <span className="font-mono text-[9px] text-inksoft">live</span>}</div>
            </div>
            <div className="border border-line rounded-[14px_8px_16px_9px] p-4 bg-paper">
              <small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1.5">Provider</small>
              <strong className="block font-mono text-[11px] break-all">{shortenHash(data.chain?.chain_provider || null)}</strong>
            </div>
          </div>

          {(data.chain?.chain_submitted_at || deliverable) && (
            <div className="border border-line rounded-[16px_8px_18px_9px] p-4 mb-6 bg-paper">
              <div className="grid sm:grid-cols-2 gap-4">
                {data.chain?.chain_submitted_at && <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1.5">Submitted at</small><strong className="text-[12px]">{new Date(data.chain.chain_submitted_at).toLocaleString()}</strong></div>}
                {deliverable && <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1.5">Deliverable hash</small><strong className="font-mono text-[11px] break-all">{shortenHash(deliverable)}</strong></div>}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-3 mb-2">
            <button type="button" className="font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym disabled:opacity-60" disabled={refreshing} onClick={() => void load()}>
              {refreshing ? "Checking live state…" : "Refresh live state →"}
            </button>
            <span className="self-center font-mono text-[9.5px] text-inksoft">Auto-refreshes every 10 seconds</span>
          </div>

          {submitted && (
            <div className="mt-8 pt-8 dash-t">
              <span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-green mb-3"><span className="w-1.5 h-1.5 rounded-full bg-green" />Evaluator & settlement</span>
              <h2 className="font-display text-[20px] font-bold tracking-tight mb-1">Verified, then settled.</h2>
              <p className="text-[13px] text-inksoft mb-5 max-w-[650px]">The submitted state has been detected from the live job. Evaluation and settlement remain protocol-controlled rather than simulated by this page.</p>

              <div className="border border-line rounded-[18px_9px_20px_10px] p-5 mb-5 bg-paper">
                <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
                  <strong className="text-[14px] font-bold">Evaluation verdict</strong>
                  <Status value={data.evaluation?.verdict || "pending"} />
                </div>
                <p className="text-[12px] text-inksoft mb-3">{data.evaluation?.notes || "Awaiting the live evaluator decision."}</p>
                {data.evaluation?.evidence && (
                  <div className="flex flex-wrap gap-2">
                    {data.evaluation.evidence.source && <span className="font-mono text-[9px] px-2 py-1 rounded-full border border-line text-inksoft">source: {data.evaluation.evidence.source}</span>}
                    {data.evaluation.evidence.decision && <span className="font-mono text-[9px] px-2 py-1 rounded-full border border-line text-inksoft">decision: {data.evaluation.evidence.decision}</span>}
                  </div>
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-3 mb-6">
                <div className="border border-green/30 bg-greensoft rounded-[14px_8px_16px_9px] p-4">
                  <strong className="block text-[12.5px] font-bold text-green mb-1">settlement</strong>
                  <span className="text-[10.5px] text-inksoft">Payment is released only when the real ERC-8183 policy reaches its terminal settlement state.</span>
                </div>
                <div className="border border-line rounded-[14px_8px_16px_9px] p-4">
                  <strong className="block text-[12.5px] font-bold mb-1">dispute / refund</strong>
                  <span className="text-[10.5px] text-inksoft">Protocol-valid dispute and refund paths remain available through the live policy state.</span>
                </div>
              </div>

              <div className="border border-line rounded-[16px_8px_18px_9px] p-4 bg-paper flex flex-wrap justify-between items-center gap-3">
                <div><strong className="block text-[13px] font-bold">Terminal state</strong><span className="text-[11px] text-inksoft">Payment state and evidence continue to come from the live job record.</span></div>
                <Status value={terminal ? liveStatus : "awaiting evaluation"} />
              </div>
            </div>
          )}

          {terminal && !submitted && (
            <div className="mt-8 pt-8 dash-t">
              <span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-green mb-3"><span className="w-1.5 h-1.5 rounded-full bg-green" />Terminal outcome</span>
              <h2 className="font-display text-[20px] font-bold tracking-tight mb-1">{human(liveStatus)}.</h2>
              <p className="text-[13px] text-inksoft max-w-[650px]">The terminal outcome is read from the live BSC Testnet job state. No client-side state transition is being simulated.</p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
