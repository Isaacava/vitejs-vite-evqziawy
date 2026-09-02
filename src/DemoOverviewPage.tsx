import { useEffect, useMemo, useState } from "react";
import type { AuthUser } from "./lib/walletAuth";
import { formatUnits } from "viem";

type Job = { id: string; chain_job_id: number | null; updated_at: string; agent?: { name: string | null } | null };
type Mission = { id: string; title: string; goal: string; category: string; status: string; created_at: string; updated_at: string; jobs: Job[] };
type Activity = { id: string; title: string; description: string | null; created_at: string };
type Payment = { id: string; amount: number; token_symbol: string | null; status: string; tx_hash: string | null; updated_at: string };
type DashboardData = { user: AuthUser; missions: Mission[]; activity: Activity[]; payments: Payment[] };
type ChainJob = { id: string | null; chain_job_id: number; chain_status: string; description: string; budget_raw: string; mission_id: string | null; mission_title: string | null; task_title: string; updated_at: string | null };

const terminal = ["completed", "rejected", "cancelled", "expired", "terminal"];
const activeStates = ["open", "funded", "accepted", "in_progress"];
const escrowStates = ["funded", "accepted", "in_progress", "submitted"];

const stateLabel = (value: string) => {
  const state = value.toLowerCase();
  if (state === "open") return "Ready to start";
  if (state === "funded") return "Payment secured";
  if (state === "accepted") return "Agent accepted";
  if (state === "in_progress") return "Agent is working";
  if (state === "submitted") return "Work submitted";
  if (state === "completed" || state === "terminal") return "Mission complete";
  if (state === "rejected") return "Could not start";
  if (state === "cancelled") return "Cancelled";
  if (state === "expired") return "Expired";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};
const compact = (value?: string | null) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Wallet not connected";
const ago = (value?: string | null) => {
  if (!value) return "—";
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};
const chainState = (job: ChainJob) => String(job.chain_status || "open").toLowerCase();
const budget = (raw: string) => { try { return formatUnits(BigInt(raw), 18); } catch { return raw; } };

function Status({ value }: { value: string }) {
  const state = value.toLowerCase();
  const tone = ["rejected", "cancelled", "expired", "disputed"].includes(state) ? "status-rust" : terminal.includes(state) ? "status-green" : "status-brass";
  return <span className={`font-mono text-[9.5px] px-2.5 py-1 rounded-lg ${tone}`}>{stateLabel(state)}</span>;
}

function Metric({ label, value, note, brass = false }: { label: string; value: string | number; note: string; brass?: boolean }) {
  return <section className={`min-h-[112px] flex flex-col p-4 card-asym border ${brass ? "border-brass/40 bg-brasssoft/30" : "border-line bg-paperhi"}`}>
    <span className={`font-mono text-[9px] uppercase tracking-wide ${brass ? "text-brass" : "text-[#8a8477]"}`}>{label}</span>
    <strong className={`font-display text-[29px] font-bold tracking-tight mt-2.5 ${brass ? "text-brass" : ""}`}>{value}</strong>
    <small className="mt-auto pt-1.5 text-[10.5px] text-inksoft">{note}</small>
  </section>;
}

function Lifecycle({ state }: { state: string }) {
  const lower = state.toLowerCase();
  const active = terminal.includes(lower) ? 3 : lower === "submitted" ? 2 : ["funded", "accepted", "in_progress"].includes(lower) ? 1 : 0;
  return <div className="grid grid-cols-4 overflow-hidden rounded-[12px_7px_13px_8px] bg-deep" aria-label={`Mission progress: ${stateLabel(lower)}`}>
    {["ready", "working", "review", "complete"].map((label, index) => <div key={label} className="border-r border-white/10 p-2.5 last:border-r-0">
      <span className={`block font-mono text-[7.5px] uppercase ${index <= active ? "text-brasslt" : "text-[#726f60]"}`}>{label}</span>
      <i className={`mt-2 block h-1.5 w-1.5 rounded-full ${index <= active ? "bg-brasslt" : "bg-[#3a3a30]"}`} />
    </div>)}
  </div>;
}

export default function DemoOverviewPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [jobs, setJobs] = useState<ChainJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [dashboardResponse, jobsResponse] = await Promise.all([
          fetch("/api/dashboard", { credentials: "include" }),
          fetch("/api/testnet/jobs-history", { credentials: "include" }),
        ]);
        const dashboard = await dashboardResponse.json() as DashboardData & { error?: string };
        const history = await jobsResponse.json() as { network?: string; chain_id?: number; jobs?: ChainJob[]; error?: string };
        if (!dashboardResponse.ok) throw new Error("Unable to load dashboard");
        if (!jobsResponse.ok) throw new Error("Unable to load mission history");
        if (history.network !== "bsc-testnet" || Number(history.chain_id) !== 97) throw new Error("Mission history is unavailable right now.");
        if (!active) return;
        setData(dashboard);
        setJobs(Array.isArray(history.jobs) ? history.jobs : []);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load dashboard");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const activeJobs = useMemo(() => jobs.filter((job) => activeStates.includes(chainState(job))), [jobs]);
  const reviewJobs = useMemo(() => jobs.filter((job) => chainState(job) === "submitted"), [jobs]);
  const completedJobs = useMemo(() => jobs.filter((job) => terminal.includes(chainState(job))), [jobs]);
  const escrow = useMemo(() => {
    const chain = jobs.filter((job) => escrowStates.includes(chainState(job))).reduce((sum, job) => sum + Number(budget(job.budget_raw) || 0), 0);
    const db = (data?.payments || []).filter((p) => ["pending", "funded", "escrowed", "locked"].includes(String(p.status).toLowerCase())).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    return chain || db;
  }, [data, jobs]);
  const currentWork = useMemo(() => [...activeJobs].slice(0, 3), [activeJobs]);
  const activities = data?.activity || [];

  return <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 text-ink">
    {error && <div className="mb-5 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust"><strong>We couldn't load your dashboard.</strong> Refresh the page and try again.</div>}
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute right-[-180px] top-[-10px] h-[220px] w-[560px] rotate-[-8deg] rounded-[58%_42%_0_0/80%_74%_0_0] border border-[rgba(157,116,40,.14)]" />
      <section className="relative z-10 mb-8 grid gap-6 lg:grid-cols-[1.5fr_.65fr]">
        <div>
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-brass mb-3"><span className="h-1.5 w-1.5 rounded-full bg-brass" /> Your workspace / 01</span>
          <h1 className="font-display text-[32px] font-bold tracking-tight leading-[1.03] md:text-[42px]">Your missions,<br/><em className="not-italic text-brass">at a glance.</em></h1>
          <p className="mt-3 max-w-[520px] text-[13.5px] leading-relaxed text-inksoft">See what is running, what needs your attention, what has finished, and how much is currently reserved for active work.</p>
        </div>
        <div className="card-asym rotate-[1deg] overflow-hidden border border-[#b9b09a] bg-paperhi shadow-[0_30px_60px_-36px_rgba(23,23,20,.35)]">
          <div className="flex justify-between border-b border-dashed border-[#c8c0af] px-4 py-2.5 font-mono text-[8.5px] text-[#8a8477]"><span>ACCOUNT</span><span className="text-green">● CONNECTED</span></div>
          <div className="px-4 py-4"><small className="mb-1.5 block font-mono text-[9px] uppercase text-[#8a8477]">Wallet</small><strong className="block text-[16px] font-bold">{compact(data?.user.wallet_address)}</strong></div>
          <div className="flex items-center justify-between border-t border-dashed border-line bg-[#f2f0e7] px-4 py-3"><span className="text-[10.5px] text-inksoft">Payments stay reserved until mission progress allows a change.</span><a href="/app" className="shrink-0 text-[11.5px] font-extrabold no-underline">New mission <span className="text-brass">→</span></a></div>
        </div>
      </section>

      {loading ? <div className="py-16 text-[13px] text-inksoft">Loading your workspace…</div> : <>
        <div className="relative z-10 mb-6 grid grid-cols-2 gap-3.5 md:grid-cols-5">
          <Metric label="Active missions" value={activeJobs.length} note="running or ready" />
          <Metric label="Completed" value={completedJobs.length} note="finished missions" />
          <Metric label="Needs review" value={reviewJobs.length} note="work submitted" />
          <Metric label="Reserved" value={escrow.toLocaleString()} note="currently held for work" brass />
          <Metric label="Agent access" value="—" note="No active permission record here" brass />
        </div>

        <div className="relative z-10 mb-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <section className="card-asym border border-line bg-paperhi p-[18px]">
            <div className="mb-1 flex items-center justify-between border-b border-dashed border-[#c8c0af] pb-3"><span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">02 / Current work</span><a href="/missions" className="text-[11px] font-extrabold text-brass no-underline">View all →</a></div>
            {currentWork.length ? currentWork.map((job) => {
              const state = chainState(job);
              return <article key={job.chain_job_id} className="border-b border-linesoft py-4 last:border-b-0">
                <div className="flex flex-col gap-3.5 sm:flex-row sm:justify-between">
                  <div className="min-w-0"><div className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Mission</div><h2 className="mt-1 text-[14.5px] font-bold">{job.mission_title || job.task_title || "Your mission"}</h2><p className="max-w-[340px] text-[11.5px] leading-relaxed text-inksoft">{job.description || "Your selected agent is handling this mission."}</p></div>
                  <div className="shrink-0 sm:min-w-[150px] sm:text-right"><Status value={state}/><span className="my-1.5 block text-[11px] text-inksoft">{job.agent?.name || "Assigned provider"}</span><a href={`/mission?job=${encodeURIComponent(String(job.id || ""))}`} className="text-[11px] font-extrabold text-brass no-underline">Review →</a></div>
                </div>
                <div className="mt-3"><Lifecycle state={state}/></div>
                <div className="mt-2 font-mono text-[9px] text-[#8a8477]">updated {ago(job.updated_at)}</div>
              </article>;
            }) : <div className="py-8"><strong className="font-display text-[21px]">No active missions</strong><p className="mt-2 text-[12px] text-inksoft">Start with an outcome in plain English. AgentMarket will help you find a suitable provider.</p><a href="/app" className="text-[11px] font-extrabold text-brass no-underline">Create a mission →</a></div>}
          </section>

          <aside className="card-asym border border-line bg-paperhi p-[18px]">
            <div className="mb-1 flex items-center justify-between border-b border-dashed border-[#c8c0af] pb-3"><span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">03 / Activity</span><a href="/activity" className="text-[11px] font-extrabold text-brass no-underline">Full history →</a></div>
            {activities.slice(0, 6).map((event, index) => <div key={event.id} className={`py-3 ${index < Math.min(activities.length, 6) - 1 ? "border-b border-linesoft" : ""}`}><strong className="block text-[12px] font-bold">{event.title}</strong><p className="my-0.5 text-[10.5px] text-inksoft">{event.description || "Your workspace changed."}</p><small className="font-mono text-[9.5px] text-[#9aa3b1]">{ago(event.created_at)}</small></div>)}
            {!activities.length && <div className="py-8 text-[12px] text-inksoft">Nothing has changed yet.</div>}
          </aside>
        </div>

        <section className="relative z-10 card-asym border border-line bg-paperhi p-[18px]">
          <div className="mb-1 flex items-center justify-between border-b border-dashed border-[#c8c0af] pb-3"><span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">04 / Recent missions</span><a href="/missions" className="text-[11px] font-extrabold text-brass no-underline">Mission history →</a></div>
          {jobs.slice(0, 8).map((job) => <div key={job.chain_job_id} className="flex flex-col gap-2 border-b border-linesoft py-3.5 last:border-b-0 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><strong className="block text-[13px] font-bold">{job.mission_title || job.task_title || "Your mission"}</strong><span className="text-[11px] text-inksoft">{stateLabel(chainState(job))}</span></div><Status value={chainState(job)}/><small className="font-mono text-[10px] text-[#9aa3b1] sm:min-w-[130px] sm:text-right">{ago(job.updated_at)}</small></div>)}
          {!jobs.length && <div className="py-8 text-[12px] text-inksoft">No missions yet. Your first one can start from a simple goal.</div>}
        </section>
      </>}
    </div>
  </main>;
}
