import { useEffect, useMemo, useState } from "react";

type MissionJob = {
  id: string | null;
  mission_id: string | null;
  mission_title: string | null;
  mission_status: string | null;
  task_title: string | null;
  job_status: string | null;
  chain_job_id: number | null;
  chain_status: string | null;
  budget: string | number | null;
  created_at: string | null;
  funded_at: string | null;
  submitted_at: string | null;
  terminal_at: string | null;
  updated_at: string | null;
};

const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const terminalStates = new Set(["completed", "rejected", "cancelled", "expired", "terminal"]);
const reviewStates = new Set(["submitted", "awaiting_review"]);
const JSON_LABEL_KEYS = ["title", "mission_title", "task_title", "name", "goal", "description", "summary", "label"];

function cleanDisplay(value: unknown, fallback = "Untitled mission") {
  if (typeof value !== "string") return fallback;
  let text = value.trim();
  if (!text) return fallback;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!(text.startsWith("{") || text.startsWith("["))) break;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "string") {
        text = parsed.trim();
        continue;
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        for (const key of JSON_LABEL_KEYS) {
          const candidate = record[key];
          if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
        }
        const nested = record.mission;
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
          for (const key of JSON_LABEL_KEYS) {
            const candidate = (nested as Record<string, unknown>)[key];
            if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
          }
        }
      }
      break;
    } catch {
      break;
    }
  }
  return text;
}

function Status({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const state = terminalStates.has(lower)
    ? "green"
    : ["rejected", "cancelled", "expired", "disputed"].includes(lower)
      ? "rust"
      : "brass";
  return <span className={`font-mono text-[9.5px] px-2.5 py-1 rounded-lg status-${state}`}>{human(value)}</span>;
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
      const state = String(job.chain_status || job.job_status || "").toLowerCase();
      if (filter === "funded") return state === "funded";
      if (filter === "in_progress") return ["accepted", "in_progress"].includes(state);
      if (filter === "submitted") return reviewStates.has(state);
      if (filter === "terminal") return terminalStates.has(state);
      return true;
    });
  }, [filter, jobs]);

  const filters = [
    ["all", "All"],
    ["funded", "Funded"],
    ["in_progress", "In progress"],
    ["submitted", "Submitted"],
    ["terminal", "Terminal"],
  ] as const;

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 font-body text-ink md:px-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Missions / All</span>
        <a href="/app" className="btn-asym inline-flex shrink-0 items-center gap-2 bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi no-underline hover:bg-black">+ New mission</a>
      </div>

      <div className="mb-5 flex flex-wrap gap-2 font-mono text-[10.5px]">
        {filters.map(([value, label]) => (
          <button key={value} type="button" onClick={() => setFilter(value)} className={`cursor-pointer rounded-full px-3.5 py-1.5 ${filter === value ? "bg-ink text-paperhi" : "border border-line bg-paperhi text-inksoft"}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust">{error}</div>}

      {loading ? (
        <div className="card-asym bg-paperhi p-8 text-[13px] text-inksoft">Loading missions…</div>
      ) : (
        <section className="card-asym bg-paperhi p-[18px]">
          {filtered.map((job, index) => {
            const state = String(job.chain_status || job.job_status || "open");
            const fallbackTitle = cleanDisplay(job.task_title || job.mission_title, job.chain_job_id ? `Chain job #${job.chain_job_id}` : "Testnet mission");
            const title = cleanDisplay(job.mission_title, fallbackTitle);
            const category = cleanDisplay(job.task_title, "Mission");
            const description = cleanDisplay(job.task_title, title);
            const consoleTarget = job.id || (job.chain_job_id != null ? String(job.chain_job_id) : "");
            const rowKey = job.id || `chain-${job.chain_job_id ?? index}`;
            const last = index === filtered.length - 1;

            return (
              <article key={rowKey} className={`flex min-w-0 flex-col gap-4 py-[19px] sm:flex-row sm:items-start sm:justify-between ${!last ? "border-b border-line" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">{category}</div>
                  <h2 className="my-1.5 text-[16px] font-bold">{title}</h2>
                  <p className="max-w-[400px] text-[12px] text-inksoft">{description}</p>
                  {job.chain_job_id != null && state !== "terminal" && (
                    <span className="mt-2 inline-block rounded-full bg-brasssoft px-2 py-1 font-mono text-[9px] text-brass">◈ Chain job #{job.chain_job_id}</span>
                  )}
                </div>
                <div className="min-w-0 shrink-0 text-left sm:min-w-[150px] sm:text-right">
                  <Status value={state} />
                  <small className="my-2 block text-[11px] text-inksoft">{job.chain_job_id == null ? "Marketplace job" : "Agent provider"}</small>
                  {consoleTarget && <a href={`/mission?job=${encodeURIComponent(consoleTarget)}`} className="text-[11.5px] font-extrabold text-brass no-underline">Open console →</a>}
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
