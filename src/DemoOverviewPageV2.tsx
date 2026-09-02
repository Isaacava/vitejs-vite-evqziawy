import { useEffect, useMemo, useState } from "react";
import type { AuthUser } from "./lib/walletAuth";
import { formatUnits } from "viem";

type Activity = { id: string; title: string; description: string | null; created_at: string };
type Payment = { id: string; amount: number; token_symbol: string | null; status: string; tx_hash: string | null; updated_at: string };
type Mission = { id: string; title: string; goal: string; category: string; status: string; created_at: string; updated_at: string; jobs: Array<{ id: string; chain_job_id: number | null; updated_at: string; agent?: { name: string | null } | null }> };
type Dashboard = { user: AuthUser; missions: Mission[]; activity: Activity[]; payments: Payment[] };
type ChainJob = {
  id: string | null;
  chain_job_id: number;
  chain_status: string;
  description: string;
  budget_raw: string;
  mission_id: string | null;
  mission_title: string | null;
  task_title: string;
  updated_at: string | null;
  agent?: { name: string | null } | null;
};

authority;

const ACTIVE = new Set(["open", "funded", "accepted", "in_progress"]);
const TERMINAL = new Set(["completed", "rejected", "cancelled", "expired", "terminal", "settled"]);
const ESCROWED = new Set(["funded", "accepted", "in_progress", "submitted"]);

function human(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function compact(value?: string | null) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "0x••••…••••";
}

function ago(value?: string | null) {
  if (!value) return "—";
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function amount(raw: string) {
  try { return formatUnits(BigInt(raw), 18); } catch { return raw; }
}

function statusTone(value: string) {
  const state = value.toLowerCase();
  if (["completed", "settled", "terminal"].includes(state)) return "status-green";
  if (["rejected", "cancelled", "expired", "disputed"].includes(state)) return "status-rust";
  return "status-brass";
}

function Status({ value }: { value: string }) {
  return <span className={`rounded-lg px-2.5 py-1 font-mono text-[9px] ${statusTone(value)}`}>{human(value)}</span>;
}

function Metric({ label, value, note, brass = false }: { label: string; value: string | number; note: string; brass?: boolean }) {
  return <section className={`card-asym min-h-[112px] border p-4 ${brass ? "border-brass/40 bg-brasssoft/30" : "border-line bg-paperhi"}`}>
    <span className={`font-mono text-[9px] uppercase tracking-wide ${brass ? "text-brass" : "text-[#8a8477]"}`}>{label}</span>
    <strong className={`mt-2.5 block font-display text-[29px] font-bold tracking-tight ${brass ? "text-brass" : ""}`}>{value}</strong>
    <small className="mt-1.5 block text-[10.5px] text-inksoft">{note}</small>
  </section>;
}

function Lifecycle({ state }: { state: string }) {
  const current = state.toLowerCase();
  const active = TERMINAL.has(current) ? 4 : current === "submitted" ? 3 : ["funded", "accepted", "in_progress"].includes(current) ? 1 : 0;
  const labels = ["Open", "Funded", "Accepted", "In progress", "Submitted"];
  return <div className="grid grid-cols-2 overflow-hidden rounded-[12px_7px_13px_8px] bg-deep sm:grid-cols-5">
    {labels.map((label, index) => <div key={label} className="border-r border-white/10 p-2.5 last:border-r-0">
      <span className={`block font-mono text-[7.5px] uppercase ${index <= active ? "text-brasslt" : "text-[#726f60]"}`}>{label}</span>
      <i className={`mt-2 block h-1.5 w-1.5 rounded-full ${index <= active ? "bg-brasslt" : "bg-[#3a3a30]"}`} />
    </div>)}
  </div>;
}

export default function DemoOverviewPageV2() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [jobs, setJobs] = useState<ChainJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [dashboardResponse, historyResponse] = await Promise.all([
          fetch("/api/dashboard", { credentials: "include", cache: "no-store" }),
          fetch("/api/testnet/jobs-history", { credentials: "include", cache: "no-store" }),
        ]);
        const dashboardBody = await dashboardResponse.json() as Dashboard & { error?: string };
        const historyBody = await historyResponse.json() as { network?: string; chain_id?: number; jobs?: ChainJob[]; error?: string };
        if (!dashboardResponse.ok) throw new Error(dashboardBody.error || "Unable to load dashboard");
        if (!historyResponse.ok) throw new Error(historyBody.error || "Unable to load mission history");
        if (historyBody.network !== "bsc-testnet" || Number(historyBody.chain_id) !== 97) throw new Error("Mission history is unavailable right now.");
        if (!mounted) return;
        setDashboard(dashboardBody);
        setJobs(Array.isArray(historyBody.jobs) ? historyBody.jobs : []);
      } catch (cause) {
        if (mounted) setError(cause instanceof Error ? cause.message : "Unable to load dashboard");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const activeJobs = useMemo(() => jobs.filter((job) => ACTIVE.has(job.chain_status.toLowerCase())), [jobs]);
  const reviewJobs = useMemo(() => jobs.filter((job) => job.chain_status.toLowerCase() === "submitted"), [jobs]);
  const completedJobs = useMemo(() => jobs.filter((job) => TERMINAL.has(job.chain_status.toLowerCase())), [jobs]);
  const escrow = useMemo(() => {
    const chain = jobs.filter((job) => ESCROWED.has(job.chain_status.toLowerCase())).reduce((sum, job) => sum + Number(amount(job.budget_raw) || 0), 0);
    const db = (dashboard?.payments || []).filter((payment) => ["pending", "funded", "escrowed", "locked"].includes(payment.status.toLowerCase())).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    return chain || db;
  }, [dashboard, jobs]);
  const activities = dashboard?.activity || [];
  const recentMissions = dashboard?.missions || [];

  return <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 text-ink">
    {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[11px] text-rust">{error}</div>}

    <section className="relative mb-7 grid gap-5 lg:grid-cols-[1.45fr_.7fr]">
      <div className="relative overflow-hidden py-1">
        <div className="pointer-events-none absolute -right-28 top-0 h-48 w-[460px] rotate-[-8deg] rounded-[58%_42%_0_0/80%_74%_0_0] border border-[rgba(157,116,40,.14)]" />
        <span className="relative z-10 mb-3 inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-brass"><span className="h-1.5 w-1.5 rounded-full bg-brass" />Overview</span>
        <h1 className="relative z-10 font-display text-[32px] font-bold leading-[1.02] tracking-tight md:text-[44px]">Your missions,<br /><em className="not-italic text-brass">at a glance.</em></h1>
        <div className="relative z-10 mt-4 flex flex-wrap gap-2">
          <a href="/app" className="btn-asym bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi no-underline">Create mission →</a>
          <a href="/discover" className="px-2 py-2.5 text-[11px] font-extrabold text-inksoft no-underline">Discover agents</a>
        </div>
      </div>

      <div className="card-asym rotate-[1deg] overflow-hidden border border-[#b9b09a] bg-paperhi">
        <div className="flex justify-between border-b border-dashed border-[#c8c0af] px-4 py-2.5 font-mono text-[8.5px] text-[#8a8477]"><span>CONNECTED WALLET</span><span className="text-green">● ACTIVE</span></div>
        <div className="px-4 py-4"><small className="mb-1.5 block font-mono text-[8.5px] uppercase text-[#8a8477]">Address</small><strong className="block text-[15px] font-bold">{compact(dashboard?.user.wallet_address)}</strong></div>
        <div className="flex items-center justify-between border-t border-dashed border-line bg-[#f2f0e7] px-4 py-3"><span className="text-[10.5px] text-inksoft">BSC Testnet</span><a href="/execution-wallet" className="text-[10.5px] font-extrabold text-ink no-underline">Wallet →</a></div>
      </div>
    </section>

    {loading ? <div className="py-16 text-[12px] text-inksoft">Loading…</div> : <>
      <div className="mb-6 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <Metric label="Active missions" value={activeJobs.length} note="funded · executing" />
        <Metric label="Completed" value={completedJobs.length} note="terminal missions" />
        <Metric label="Awaiting review" value={reviewJobs.length} note="submitted, not settled" />
        <Metric label="Escrow tracked" value={escrow.toLocaleString()} note="tBNB" brass />
      </div>

      <section className="mb-4 grid gap-4 lg:grid-cols-[1.45fr_.85fr]">
        <div className="card-asym border border-line bg-paperhi p-[18px]">
          <div className="mb-1 flex items-center justify-between border-b border-dashed border-[#c8c0af] pb-3"><span className="font-mono text-[9px] uppercase tracking-wide text-[#8a8477]">Current work</span><a href="/missions" className="text-[10.5px] font-extrabold text-brass no-underline">View all →</a></div>
          {activeJobs.length ? activeJobs.slice(0, 3).map((job) => <article key={job.chain_job_id} className="border-b border-linesoft py-4 last:border-b-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><span className="font-mono text-[8.5px] uppercase tracking-wide text-[#8a8477]">{job.task_title || "Mission"}</span><h2 className="mt-1 text-[14px] font-bold">{job.mission_title || job.description || "Mission"}</h2><div className="mt-1.5 text-[10.5px] text-inksoft">{job.agent?.name || "Agent"}</div></div>
              <div className="shrink-0 sm:text-right"><Status value={job.chain_status} /><a href={`/mission?job=${encodeURIComponent(String(job.id || ""))}`} className="ml-2 text-[10.5px] font-extrabold text-brass no-underline">Open →</a></div>
            </div>
            <div className="mt-3"><Lifecycle state={job.chain_status}/></div>
          </article>) : <div className="py-8"><strong className="font-display text-[20px]">No active missions</strong><p className="mt-1.5 text-[11px] text-inksoft">Start with a new mission.</p><a href="/app" className="mt-2 inline-block text-[11px] font-extrabold text-brass no-underline">Create mission →</a></div>}
        </div>

        <aside className="card-asym border border-line bg-paperhi p-[18px]">
          <div className="mb-1 flex items-center justify-between border-b border-dashed border-[#c8c0af] pb-3"><span className="font-mono text-[9px] uppercase tracking-wide text-[#8a8477]">Recent activity</span><a href="/activity" className="text-[10.5px] font-extrabold text-brass no-underline">Full log →</a></div>
          {activities.slice(0, 5).map((event, index) => <div key={event.id} className={`py-3 ${index < Math.min(activities.length, 5) - 1 ? "border-b border-linesoft" : ""}`}><strong className="block text-[11.5px] font-bold">{event.title}</strong><p className="my-0.5 text-[10px] leading-4 text-inksoft">{event.description || "Activity recorded."}</p><small className="font-mono text-[8.5px] text-[#9aa3b1]">{ago(event.created_at)}</small></div>)}
          {!activities.length && <div className="py-8 text-[11px] text-inksoft">No activity yet.</div>}
        </aside>
      </section>

      <section className="card-asym border border-line bg-paperhi p-[18px]">
        <div className="mb-1 flex items-center justify-between border-b border-dashed border-[#c8c0af] pb-3"><span className="font-mono text-[9px] uppercase tracking-wide text-[#8a8477]">Recent missions</span><a href="/missions" className="text-[10.5px] font-extrabold text-brass no-underline">Mission history →</a></div>
        {recentMissions.length ? recentMissions.slice(0, 5).map((mission, index) => {
          const job = mission.jobs?.[0];
          const state = job?.chain_job_id ? jobs.find((item) => item.chain_job_id === job.chain_job_id)?.chain_status || mission.status : mission.status;
          return <a key={mission.id} href={job?.id ? `/mission?job=${encodeURIComponent(job.id)}` : "/missions"} className="flex items-center justify-between gap-4 border-b border-linesoft py-3.5 no-underline last:border-b-0">
            <div className="min-w-0"><strong className="block truncate text-[12px] font-bold">{mission.title || mission.goal}</strong><span className="text-[10px] text-inksoft">{mission.category || "Mission"} · {ago(mission.updated_at || mission.created_at)}</span></div>
            <div className="flex shrink-0 items-center gap-2"><Status value={state || "open"} /><span className="text-[12px] text-brass">→</span></div>
          </a>;
        }) : <div className="py-8 text-[11px] text-inksoft">No missions yet.</div>}
      </section>
    </>}
  </main>;
}
