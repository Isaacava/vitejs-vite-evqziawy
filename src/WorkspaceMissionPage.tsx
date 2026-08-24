import { useEffect, useMemo, useState } from "react";

type MissionJob = {
  id: string;
  mission_id: string | null;
  mission_title: string;
  mission_status: string;
  task_title: string;
  job_status: string;
  chain_job_id: number | null;
  chain_status: string | null;
  budget: string | number | null;
  created_at: string;
  funded_at: string | null;
  submitted_at: string | null;
  terminal_at: string | null;
  updated_at: string;
};

const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const terminalStates = new Set(["completed", "rejected", "cancelled", "expired", "terminal"]);
const reviewStates = new Set(["submitted", "awaiting_review"]);

function Status({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const state = terminalStates.has(lower) ? "green" : ["rejected", "cancelled", "expired", "disputed"].includes(lower) ? "rust" : "brass";
  return <span className={`font-mono text-[9.5px] px-2.5 py-1 rounded-lg status-${state}`}>{human(value)}</span>;
}

function Lifecycle({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const active = terminalStates.has(lower) ? 3 : reviewStates.has(lower) ? 2 : ["funded", "accepted", "in_progress"].includes(lower) ? 1 : 0;
  return (
    <div className="grid grid-cols-4 overflow-hidden rounded-lg bg-deep">
      {["Planning", "Executing", "Review", "Settled"].map((label, index) => (
        <div key={label} className="border-r border-white/10 p-2 last:border-r-0">
          <span className={`block font-mono text-[7.5px] uppercase ${index <= active ? "text-brasslt" : "text-[#726f60]"}`}>{label}</span>
          <i className={`mt-1.5 block h-1.5 w-1.5 rounded-full ${index <= active ? "bg-brasslt" : "bg-[#3a3a30]"}`} />
        </div>
      ))}
    </div>
  );
}

function date(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function WorkspaceMissionPage() {
  const [jobs, setJobs] = useState<MissionJob[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/testnet/jobs-history", { credentials: "include" });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "Unable to load mission history");
        if (body.network !== "bsc-testnet" || Number(body.chain_id) !== 97) throw new Error("Mission history returned a non-Testnet environment.");
        setJobs(Array.isArray(body.jobs) ? body.jobs : []);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to load mission history");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return jobs;
    return jobs.filter((job) => {
      const state = String(job.chain_status || job.job_status).toLowerCase();
      if (filter === "planning") return ["open", "planning"].includes(state);
      if (filter === "executing") return ["funded", "accepted", "in_progress"].includes(state);
      if (filter === "review") return reviewStates.has(state);
      if (filter === "completed") return terminalStates.has(state);
      return true;
    });
  }, [filter, jobs]);

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 font-body text-ink md:px-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Missions / All</span>
        <a href="/app" className="btn-asym inline-flex items-center gap-2 bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi no-underline hover:bg-black">+ New mission</a>
      </div>

      <div className="mb-5 flex flex-wrap gap-2 font-mono text-[10.5px]">
        {["all", "planning", "executing", "review", "completed"].map((value) => (
          <span
            key={value}
            onClick={() => setFilter(value)}
            className={`cursor-pointer rounded-full px-3.5 py-1.5 ${filter === value ? "bg-ink text-paperhi" : "border border-line bg-paperhi text-inksoft"}`}
          >
            {value === "all" ? "All" : human(value)}
          </span>
        ))}
      </div>

      {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust">{error}</div>}

      {loading ? (
        <div className="card-asym bg-paperhi p-8 text-[13px] text-inksoft">Loading missions…</div>
      ) : (
        <section className="card-asym bg-paperhi p-[18px]">
          {filtered.map((job, index) => {
            const state = job.chain_status || job.job_status;
            return (
              <article key={job.id} className={`flex justify-between items-start gap-4 py-[19px] ${index < filtered.length - 1 ? "border-b border-line" : ""}`}>
                <div className="min-w-0">
                  <div className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">{job.task_title || job.mission_title}</div>
                  <h2 className="text-[16px] font-bold my-1.5">{job.mission_title}</h2>
                  <p className="text-[12px] text-inksoft max-w-[460px]">{job.task_title || job.mission_title}</p>
                </div>
                <div className="text-right shrink-0 min-w-[150px]">
                  <Status value={state} />
                  <small className="block text-[11px] text-inksoft my-2">{job.chain_job_id == null ? "Marketplace job" : `Chain job #${job.chain_job_id}`}</small>
                  <a href={`/mission?job=${encodeURIComponent(job.id)}`} className="text-[11.5px] font-extrabold text-brass no-underline">Open console →</a>
                </div>
              </article>
            );
          })}
          {!filtered.length && <div className="py-10 text-[13px] text-inksoft">No missions in this view.</div>}
        </section>
      )}
    </main>
  );
}
