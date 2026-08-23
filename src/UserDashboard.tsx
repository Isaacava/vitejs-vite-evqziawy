import { useEffect, useMemo, useState } from "react";
import type { AuthUser } from "./lib/walletAuth";
import { formatUnits } from "viem";

type Job = {
  id: string;
  status: string;
  budget: number;
  chain_job_id: number | null;
  updated_at: string;
  agent?: { agent_id: string; name: string | null; category: string; status: string; verification_status: string } | null;
};
type Mission = {
  id: string;
  title: string;
  goal: string;
  category: string;
  budget: number;
  status: string;
  created_at: string;
  updated_at: string;
  jobs: Job[];
};
type Activity = { id: string; mission_id: string | null; job_id: string | null; type: string; title: string; description: string | null; created_at: string };
type Payment = { id: string; mission_id: string | null; job_id: string | null; amount: number; token_symbol: string | null; status: string; tx_hash: string | null; updated_at: string };
type DashboardData = { user: AuthUser; stats: { active: number; completed: number; awaitingReview: number; escrow: number }; missions: Mission[]; activity: Activity[]; payments: Payment[] };
type ChainJob = {
  id: string | null;
  chain_job_id: number;
  chain_status: string;
  description: string;
  budget_raw: string;
  submitted_at: string | null;
  deliverable_hash: string;
  mission_id: string | null;
  mission_title: string | null;
  task_title: string;
  created_at: string | null;
  funded_at: string | null;
  terminal_at: string | null;
  updated_at: string | null;
  recoverable: boolean;
};
type ArchiveMeta = {
  status: "ARCHIVED + VERIFIED" | "CAPTURED / NOT VERIFIED" | "CAPTURE FAILED" | "NOT CAPTURED";
  verified: boolean;
  captured_at: string | null;
  response_bytes: number | null;
  content_type: string | null;
  verification_error: string | null;
};
type Tab = "overview" | "missions" | "activity" | "payments";

const human = (v: string) => v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const compact = (v?: string | null) => v ? `${v.slice(0, 6)}…${v.slice(-4)}` : "—";
const terminal = ["completed", "rejected", "cancelled", "expired", "terminal"];
const ago = (v?: string | null) => {
  if (!v) return "—";
  const s = Math.max(1, Math.floor((Date.now() - new Date(v).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
const category = (v: string) => v.replace(/_/g, " ");
const chainState = (job: ChainJob | undefined, fallback?: string) => String(job?.chain_status || fallback || "open").toLowerCase();
const budgetFromRaw = (raw?: string | null) => {
  if (!raw) return "—";
  try { return formatUnits(BigInt(raw), 18); } catch { return raw; }
};
const recentPlanning = (mission: Mission) => {
  const age = Date.now() - new Date(mission.created_at).getTime();
  return age <= 24 * 60 * 60 * 1000 && ["planning", "open"].includes(String(mission.status).toLowerCase()) && mission.jobs.every(job => job.chain_job_id == null);
};

function Status({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const state = terminal.includes(lower) ? "green" : ["rejected", "cancelled", "expired", "disputed"].includes(lower) ? "rust" : "brass";
  return <span className={`font-mono text-[9.5px] px-2.5 py-1 rounded-lg status-${state}`}>{human(lower)}</span>;
}

function ArchiveBadge({ archive }: { archive?: ArchiveMeta }) {
  if (!archive) return null;
  const tone = archive.status === "ARCHIVED + VERIFIED" ? "status-green" : archive.status === "CAPTURE FAILED" ? "status-rust" : "status-brass";
  return <span className={`font-mono text-[8.5px] px-2 py-1 rounded-lg ${tone}`}>{archive.status}</span>;
}

function Lifecycle({ state }: { state: string }) {
  const lower = state.toLowerCase();
  const active = terminal.includes(lower) ? 3 : lower === "submitted" ? 2 : ["funded", "accepted", "in_progress"].includes(lower) ? 1 : 0;
  return <div className="grid grid-cols-2 sm:grid-cols-4 overflow-hidden rounded-lg bg-[#191a17]">
    {["planning", "executing", "review", "settled"].map((label, i) => <div key={label} className="border-b border-white/10 p-2 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><span className={`block font-mono text-[7.5px] uppercase ${i <= active ? "text-[#d2b05e]" : "text-[#726f60]"}`}>{label}</span><i className={`block w-1.5 h-1.5 rounded-full mt-1.5 ${i <= active ? "bg-[#d2b05e]" : "bg-[#3a3a30]"}`}/></div>)}
  </div>;
}

function Metric({ label, value, note, brass }: { label: string; value: string | number; note: string; brass?: boolean }) {
  return <div className="bg-[#fbfaf5] border border-[#d5cfbf] rounded-[20px_9px_22px_10px] p-4 min-h-[112px] flex flex-col"><span className="font-mono text-[9px] uppercase tracking-wide text-[#8a8477]">{label}</span><strong className={`font-[Space_Grotesk,sans-serif] text-[29px] font-bold tracking-tight mt-2.5 ${brass ? "text-[#9d7428]" : ""}`}>{value}</strong><small className="text-[10.5px] text-[#6d6a61] mt-auto pt-1.5">{note}</small></div>;
}

function Empty({ title, text, href }: { title: string; text: string; href: string }) {
  return <div className="py-8 text-[#6d6a61]"><strong className="block font-[Space_Grotesk,sans-serif] text-[21px] font-bold text-[#171714]">{title}</strong><p className="text-[12px] mt-2 mb-3">{text}</p><a className="font-extrabold text-[#9d7428] text-[11px] no-underline" href={href}>Open →</a></div>;
}

export default function UserDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [chainJobs, setChainJobs] = useState<ChainJob[]>([]);
  const [archives, setArchives] = useState<Record<string, ArchiveMeta>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(location.search).get("tab");
    return t === "missions" || t === "activity" || t === "payments" ? t : "overview";
  });

  async function readJson(response: Response) {
    const raw = await response.text();
    let body: Record<string, unknown> = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`${response.status}: ${raw.slice(0, 220)}`); }
    if (!response.ok) throw new Error(String(body.error || "Request failed"));
    return body;
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [dashboardResponse, chainResponse] = await Promise.all([
        fetch("/api/dashboard", { credentials: "include" }),
        fetch("/api/testnet/jobs-history", { credentials: "include" }),
      ]);
      const dashboardBody = await readJson(dashboardResponse) as unknown as DashboardData;
      const chainBody = await readJson(chainResponse);
      if (chainBody.network !== "bsc-testnet" || Number(chainBody.chain_id) !== 97) throw new Error("Chain history returned a non-Testnet environment.");
      const nextChain = Array.isArray(chainBody.jobs) ? chainBody.jobs as ChainJob[] : [];
      let nextArchives: Record<string, ArchiveMeta> = {};
      if (nextChain.length) {
        const archiveResponse = await fetch(`/api/archive-status?jobs=${nextChain.map(job => job.chain_job_id).join(",")}`, { credentials: "include" });
        if (archiveResponse.ok) {
          const archiveBody = await archiveResponse.json() as { archives?: Record<string, ArchiveMeta> };
          nextArchives = archiveBody.archives || {};
        }
      }
      setData(dashboardBody);
      setChainJobs(nextChain);
      setArchives(nextArchives);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function navigate(next: Tab) {
    setTab(next);
    const u = new URL(location.href);
    next === "overview" ? u.searchParams.delete("tab") : u.searchParams.set("tab", next);
    history.pushState({}, "", u.pathname + u.search);
  }

  const recentDbPlanning = useMemo(() => (data?.missions || []).filter(recentPlanning), [data]);
  const chainByMission = useMemo(() => {
    const map = new Map<string, ChainJob>();
    for (const job of chainJobs) if (job.mission_id && !map.has(job.mission_id)) map.set(job.mission_id, job);
    return map;
  }, [chainJobs]);

  const currentWork = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<{ chain?: ChainJob; mission?: Mission }> = [];
    for (const job of chainJobs) {
      const state = chainState(job);
      if (terminal.includes(state)) continue;
      const key = `chain:${job.chain_job_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ chain: job });
      if (items.length >= 3) return items;
    }
    for (const mission of recentDbPlanning) {
      const key = `mission:${mission.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!chainByMission.has(mission.id)) items.push({ mission });
      if (items.length >= 3) break;
    }
    return items;
  }, [chainJobs, recentDbPlanning, chainByMission]);

  const derived = useMemo(() => {
    const chainActive = chainJobs.filter(job => ["open", "funded", "accepted", "in_progress"].includes(chainState(job))).length;
    const chainReview = chainJobs.filter(job => chainState(job) === "submitted").length;
    const chainCompleted = chainJobs.filter(job => ["completed", "rejected", "expired"].includes(chainState(job))).length;
    const planning = recentDbPlanning.filter(m => !chainByMission.has(m.id)).length;
    const chainEscrow = chainJobs.filter(job => ["funded", "accepted", "in_progress", "submitted"].includes(chainState(job))).reduce((sum, job) => sum + Number(budgetFromRaw(job.budget_raw) || 0), 0);
    const paymentEscrow = (data?.payments || []).filter(p => ["pending", "funded", "escrowed", "locked"].includes(String(p.status).toLowerCase())).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    return {
      active: chainActive + planning,
      completed: chainCompleted,
      review: chainReview,
      escrow: chainEscrow || paymentEscrow,
    };
  }, [chainJobs, recentDbPlanning, chainByMission, data]);

  const recentMissions = useMemo(() => {
    const rows: Array<{ key: string; mission: Mission | null; chain: ChainJob | null }> = [];
    const seen = new Set<string>();
    for (const job of chainJobs) {
      const key = job.mission_id ? `mission:${job.mission_id}` : `chain:${job.chain_job_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const mission = job.mission_id ? data?.missions.find(item => item.id === job.mission_id) || null : null;
      rows.push({ key, mission, chain: job });
      if (rows.length >= 8) return rows;
    }
    for (const mission of recentDbPlanning) {
      if (chainByMission.has(mission.id) || seen.has(`mission:${mission.id}`)) continue;
      seen.add(`mission:${mission.id}`);
      rows.push({ key: `mission:${mission.id}`, mission, chain: null });
      if (rows.length >= 8) break;
    }
    return rows;
  }, [chainJobs, data, recentDbPlanning, chainByMission]);

  const mergedActivity = useMemo(() => {
    const archiveEvents = chainJobs
      .map(job => ({ job, archive: archives[String(job.chain_job_id)] }))
      .filter(item => item.archive?.verified && item.archive.captured_at)
      .map(item => ({
        id: `archive-${item.job.chain_job_id}`,
        created_at: item.archive!.captured_at!,
        title: "Deliverable archived + verified",
        description: `Chain job #${item.job.chain_job_id} · ${item.archive!.response_bytes ?? 0} bytes · exact-byte hash matches.`,
      }));
    const dbEvents = (data?.activity || []).map(event => ({ id: event.id, created_at: event.created_at, title: event.title, description: event.description || human(event.type) }));
    return [...archiveEvents, ...dbEvents].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [archives, chainJobs, data]);

  return <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 font-[Manrope,sans-serif] text-[#171714]">
    {error && <div className="mb-5 border border-[#cfad9f] bg-[#f3e6e1] rounded-[14px_8px_15px_9px] px-4 py-3 text-[12px] text-[#9b4733]">{error}</div>}
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute right-[-180px] top-[-10px] h-[220px] w-[560px] rotate-[-8deg] rounded-[58%_42%_0_0/80%_74%_0_0] border border-[rgba(157,116,40,.14)]" />
      <section className="relative z-10 grid gap-6 mb-8 lg:grid-cols-[1.5fr_.65fr]">
        <div><span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[#9d7428] mb-3"><span className="w-1.5 h-1.5 rounded-full bg-[#9d7428]"/> User operating system / 01</span><h1 className="font-[Space_Grotesk,sans-serif] text-[32px] md:text-[42px] font-bold tracking-tight leading-[1.03] mb-3">Your missions,<br/><em className="not-italic text-[#9d7428]">at a glance.</em></h1><p className="text-[13.5px] text-[#6d6a61] max-w-[480px] leading-relaxed">One place for active work, agent progress, evaluation evidence, payment state and the activity trail behind each mission.</p></div>
        <div className="bg-[#fbfaf5] border border-[#b9b09a] rounded-[20px_9px_22px_10px] shadow-[0_30px_60px_-36px_rgba(23,23,20,.35)] rotate-[1deg] overflow-hidden"><div className="flex justify-between px-4 py-2.5 font-mono text-[8.5px] text-[#8a8477] border-b border-dashed border-[#c8c0af]"><span>CONNECTED WALLET</span><span className="text-[#2d6b4f]">● SIGNED IN</span></div><div className="px-4 py-4"><small className="block font-mono text-[9px] uppercase text-[#8a8477] mb-1.5">Address</small><strong className="block text-[16px] font-bold">{compact(data?.user.wallet_address)}</strong></div><div className="flex justify-between items-center px-4 py-3 border-t border-dashed border-[#d5cfbf] bg-[#f2f0e7]"><span className="text-[10.5px] text-[#6d6a61]">Escrow authority scoped</span><a href="/app" className="text-[11.5px] font-extrabold no-underline">New mission <span className="text-[#9d7428]">→</span></a></div></div>
      </section>

      <nav className="relative z-10 flex gap-6 border-b border-[#d5cfbf] mb-6 overflow-x-auto">{(["overview","missions","activity","payments"] as Tab[]).map(t => <button key={t} onClick={() => navigate(t)} className={`text-[12px] font-bold pb-2.5 border-b-2 whitespace-nowrap ${tab === t ? "border-[#9d7428] text-[#171714]" : "border-transparent text-[#8a8477]"}`}>{human(t)}</button>)}</nav>

      {loading ? <div className="py-16 text-[13px] text-[#6d6a61]">Loading your mission state…</div> : tab === "overview" ? <>
        <div className="relative z-10 grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-6"><Metric label="Active missions" value={derived.active} note="planning · executing · review"/><Metric label="Completed" value={derived.completed} note="terminal missions"/><Metric label="Awaiting review" value={derived.review} note="submitted, not settled"/><Metric label="Escrow tracked" value={derived.escrow.toLocaleString()} note="chain-backed Testnet value" brass/></div>

        <div className="relative z-10 grid gap-4 lg:grid-cols-[1.5fr_1fr] mb-4">
          <section className="bg-[#fbfaf5] border border-[#d5cfbf] rounded-[20px_9px_22px_10px] p-[18px]"><div className="flex justify-between items-center pb-3 mb-1 border-b border-dashed border-[#c8c0af]"><span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">02 / Current work</span><button onClick={() => navigate("missions")} className="text-[11px] font-extrabold text-[#9d7428] underline underline-offset-4">View all →</button></div>
            {currentWork.length ? currentWork.map(({ chain, mission }) => {
              const state = chain ? chainState(chain) : String(mission?.status || "planning").toLowerCase();
              const title = chain?.mission_title || mission?.title || chain?.description || "Mission";
              const sub = chain?.task_title && chain.task_title !== title ? chain.task_title : mission?.goal && mission.goal !== title ? mission.goal : "Testnet mission";
              const archive = chain ? archives[String(chain.chain_job_id)] : undefined;
              return <div key={chain ? `chain-${chain.chain_job_id}` : `mission-${mission!.id}`} className="py-4 border-b border-[#e2ddcf] last:border-b-0"><div className="flex flex-col gap-3.5 sm:flex-row sm:justify-between"><div className="min-w-0"><div className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">{category(mission?.category || "testnet")}</div><h3 className="font-[Space_Grotesk,sans-serif] text-[14.5px] font-bold mt-1 mb-0.5">{title}</h3><p className="text-[11.5px] text-[#6d6a61] max-w-[340px]">{sub}</p></div><div className="shrink-0 sm:min-w-[150px] sm:text-right"><div className="flex flex-wrap gap-2 sm:justify-end"><Status value={state}/>{archive && <ArchiveBadge archive={archive}/>}</div><div className="text-[11px] text-[#6d6a61] my-1.5">{mission?.jobs?.[0]?.agent?.name || "Grid Strategy Agent"}</div>{chain?.chain_job_id ? <a href={`/mission?job=${encodeURIComponent(String(chain.id || ""))}`} className="text-[11px] font-extrabold text-[#9d7428] no-underline">Open →</a> : null}</div></div><div className="mt-3">{chain && <Lifecycle state={state}/>}</div></div>;
            }) : <Empty title="No active missions" text="Describe an outcome and hire an agent to create your first mission." href="/app"/>}
          </section>

          <aside className="bg-[#fbfaf5] border border-[#d5cfbf] rounded-[20px_9px_22px_10px] p-[18px]"><div className="flex justify-between items-center pb-3 mb-1 border-b border-dashed border-[#c8c0af]"><span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">03 / Activity</span><button onClick={() => navigate("activity")} className="text-[11px] font-extrabold text-[#9d7428] underline underline-offset-4">Full log →</button></div>
            {mergedActivity.slice(0, 7).map(event => <div key={event.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] py-3 border-b border-[#e2ddcf] last:border-b-0"><div><strong className="block text-[12px] font-bold">{event.title}</strong><p className="text-[10.5px] text-[#6d6a61] my-0.5 mb-1.5">{event.description}</p><i className="block h-[3px] bg-[#e2ddcf] rounded-full overflow-hidden"><u className="block h-full rounded-full bg-[#9d7428]" style={{width:"70%"}}/></i></div><small className="font-mono text-[9.5px] text-[#9aa3b1] sm:whitespace-nowrap">{ago(event.created_at)}</small></div>)}
          </aside>
        </div>

        <section className="relative z-10 bg-[#fbfaf5] border border-[#d5cfbf] rounded-[20px_9px_22px_10px] p-[18px]"><div className="flex justify-between items-center pb-3 mb-1 border-b border-dashed border-[#c8c0af]"><span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">04 / Recent missions</span><button onClick={() => navigate("missions")} className="text-[11px] font-extrabold text-[#9d7428] underline underline-offset-4">Mission log →</button></div>
          {recentMissions.map(row => { const state = row.chain ? chainState(row.chain) : String(row.mission?.status || "planning").toLowerCase(); const archive = row.chain ? archives[String(row.chain.chain_job_id)] : undefined; const title = row.chain?.mission_title || row.mission?.title || "Mission"; return <div key={row.key} className="flex flex-col gap-2 py-3.5 border-b border-[#e2ddcf] last:border-b-0 sm:flex-row sm:items-center sm:gap-3"><div className="min-w-0 flex-1"><strong className="text-[13px] font-bold">{title}</strong><span className="block text-[11px] text-[#6d6a61] mt-0.5">{category(row.mission?.category || "testnet")}</span></div><div className="flex flex-wrap items-center gap-2"><Status value={state}/>{archive && <ArchiveBadge archive={archive}/>}</div><small className="font-mono text-[10px] text-[#9aa3b1] sm:min-w-[150px] sm:text-right">{row.chain?.updated_at || row.mission?.updated_at ? new Date(row.chain?.updated_at || row.mission!.updated_at).toLocaleString() : "—"}</small></div>; })}
        </section>
      </> : tab === "missions" ? <MissionList missions={chainJobs} archives={archives} /> : tab === "activity" ? <ActivityList activity={mergedActivity} /> : <PaymentList payments={data?.payments || []} chainJobs={chainJobs} escrow={derived.escrow}/>} 
    </div>
  </main>;
}

function MissionList({ missions, archives }: { missions: ChainJob[]; archives: Record<string, ArchiveMeta> }) {
  return <section><div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between"><span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Missions / All</span><a href="/app" className="font-[Space_Grotesk,sans-serif] font-bold text-[11px] px-4 py-2.5 bg-[#171714] text-[#fbfaf5] rounded-[14px_8px_16px_9px] no-underline self-start">+ New mission</a></div><div className="flex gap-2 flex-wrap mb-5 font-mono text-[10.5px]"><span className="px-3.5 py-1.5 rounded-full bg-[#171714] text-[#fbfaf5]">All</span><span className="px-3.5 py-1.5 rounded-full border border-[#d5cfbf] bg-[#fbfaf5] text-[#6d6a61]">Planning</span><span className="px-3.5 py-1.5 rounded-full border border-[#d5cfbf] bg-[#fbfaf5] text-[#6d6a61]">Executing</span><span className="px-3.5 py-1.5 rounded-full border border-[#d5cfbf] bg-[#fbfaf5] text-[#6d6a61]">Review</span><span className="px-3.5 py-1.5 rounded-full border border-[#d5cfbf] bg-[#fbfaf5] text-[#6d6a61]">Completed</span></div><div className="bg-[#fbfaf5] border border-[#d5cfbf] rounded-[20px_9px_22px_10px] p-[18px]">{missions.map((job, index) => { const state = chainState(job); const archive = archives[String(job.chain_job_id)]; return <article key={job.chain_job_id} className={`py-[19px] ${index < missions.length - 1 ? "border-b border-[#d5cfbf]" : ""}`}><div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">{job.task_title || "Testnet task"}</div><h2 className="font-[Space_Grotesk,sans-serif] text-[16px] font-bold my-1.5">{job.mission_title || "Testnet mission"}</h2><p className="text-[12px] text-[#6d6a61] max-w-[540px]">{job.task_title && job.task_title !== job.mission_title ? job.task_title : job.description}</p><div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-2"><div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Chain job</small><strong className="mt-1 block font-mono text-[10.5px]">#{job.chain_job_id}</strong></div><div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Budget</small><strong className="mt-1 block font-mono text-[10.5px]">{budgetFromRaw(job.budget_raw)}</strong></div><div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Submitted</small><strong className="mt-1 block text-[10.5px]">{job.submitted_at ? new Date(job.submitted_at).toLocaleString() : "—"}</strong></div><div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Updated</small><strong className="mt-1 block text-[10.5px]">{job.updated_at ? new Date(job.updated_at).toLocaleString() : "—"}</strong></div></div></div><div className="shrink-0 lg:min-w-[300px]"><div className="flex flex-wrap items-center gap-2 lg:justify-end"><Status value={state}/>{archive && <ArchiveBadge archive={archive}/>}</div><div className="mt-3"><Lifecycle state={state}/></div><div className="mt-3 flex flex-wrap gap-2 lg:justify-end">{job.recoverable && <a href={`/testnet/recover?job=${encodeURIComponent(job.id || String(job.chain_job_id))}`} className="rounded-[14px_8px_16px_9px] border border-[#d5cfbf] bg-[#fbfaf5] px-4 py-2.5 font-mono text-[10px] font-medium text-[#171714] no-underline">Resume job</a>}{(["submitted","completed"].includes(state) && job.chain_job_id != null) && <a href={`/testnet/result?job=${encodeURIComponent(String(job.chain_job_id))}`} className="rounded-[14px_8px_16px_9px] border border-[#d5cfbf] bg-[#fbfaf5] px-4 py-2.5 font-mono text-[10px] font-medium text-[#171714] no-underline">View result &amp; verify</a>}{state === "submitted" && job.chain_job_id != null && <a href={`/testnet/review?job=${encodeURIComponent(String(job.chain_job_id))}&mission=${encodeURIComponent(job.mission_id || "")}&marketplaceJob=${encodeURIComponent(job.id || "")}`} className="rounded-[14px_8px_16px_9px] border border-[rgba(157,116,40,.4)] bg-[#f7ecd3] px-4 py-2.5 font-mono text-[10px] font-medium text-[#9d7428] no-underline">Review / dispute / settle</a>}</div></div></div></article>; })}</div></section>;
}

function ActivityList({ activity }: { activity: Array<{ id: string; created_at: string; title: string; description: string }> }) {
  return <section><div className="flex justify-between items-center mb-4"><span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Activity / Audit trail</span><b className="font-mono text-[10.5px] text-[#6d6a61]">{activity.length} EVENTS</b></div><div className="bg-[#fbfaf5] border border-[#d5cfbf] rounded-[20px_9px_22px_10px] p-[18px]">{activity.map(a => <div key={a.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] py-3 border-b border-[#e2ddcf] last:border-b-0"><div><strong className="block text-[12.5px] font-bold">{a.title}</strong><p className="text-[10.5px] text-[#6d6a61] my-0.5 mb-1.5">{a.description}</p><i className="block h-[3px] bg-[#e2ddcf] rounded-full overflow-hidden"><u className="block h-full rounded-full bg-[#9d7428]" style={{width:"70%"}}/></i></div><small className="font-mono text-[9.5px] text-[#9aa3b1] sm:whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</small></div>)}</div></section>;
}

function PaymentList({ payments, chainJobs, escrow }: { payments: Payment[]; chainJobs: ChainJob[]; escrow: number }) {
  const rows = chainJobs.filter(job => ["funded", "accepted", "in_progress", "submitted"].includes(chainState(job)));
  return <section><div className="flex justify-between items-center mb-6"><span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Payments / Escrow</span><b className="font-mono text-[10.5px] text-[#6d6a61]">ON-CHAIN STATUS SEPARATE</b></div><div className="relative min-h-[320px] grid place-items-center mb-8"><div className="relative w-[172px] h-[172px] rounded-full border border-[#c1b69d] bg-[#fbfaf5]/90 flex flex-col items-center justify-center text-center z-10 before:content-[''] before:absolute before:w-[222px] before:h-[222px] before:rounded-full before:border before:border-[#9d7428]/20 after:content-[''] after:absolute after:w-[272px] after:h-[272px] after:rounded-full after:border after:border-[#9d7428]/10"><span className="font-mono text-[9px] uppercase text-[#9d7428]">Escrow</span><strong className="font-[Space_Grotesk,sans-serif] text-[25px] font-bold mt-1">{escrow.toLocaleString()}</strong><em className="not-italic text-[10px] text-[#6d6a61] mt-1">chain-backed Testnet value</em></div></div><div className="bg-[#fbfaf5] border border-[#d5cfbf] rounded-[20px_9px_22px_10px] p-[18px]">{rows.map(job => <div key={`chain-pay-${job.chain_job_id}`} className="flex flex-col gap-2 py-4 border-b border-dashed border-[#c8c0af] sm:flex-row sm:justify-between sm:items-center"><div><strong className="font-[Space_Grotesk,sans-serif] text-[16px] font-bold">{budgetFromRaw(job.budget_raw)} tBNB</strong><span className="block font-mono text-[10.5px] text-[#9aa3b1] mt-1">Chain job #{job.chain_job_id}</span></div><Status value={chainState(job)}/></div>)}{payments.map(payment => <div key={payment.id} className="flex flex-col gap-2 py-4 border-b border-dashed border-[#c8c0af] sm:flex-row sm:justify-between sm:items-center"><div><strong className="font-[Space_Grotesk,sans-serif] text-[16px] font-bold">{payment.amount} {payment.token_symbol || "units"}</strong><span className="block font-mono text-[10.5px] text-[#9aa3b1] mt-1">{compact(payment.tx_hash)}</span></div><Status value={payment.status}/></div>)}{!rows.length && !payments.length && <Empty title="No payment rows yet" text="Funded Testnet jobs and payment records will appear here." href="/testnet/jobs"/>}</div></section>;
}
