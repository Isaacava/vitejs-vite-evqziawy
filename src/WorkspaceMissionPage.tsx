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

const stateLabel = (value: string) => {
  const lower = value.toLowerCase();
  if (lower === "open") return "Ready to start";
  if (lower === "funded") return "Payment secured";
  if (lower === "accepted") return "Agent accepted";
  if (lower === "in_progress") return "Agent is working";
  if (lower === "submitted" || lower === "awaiting_review") return "Work submitted";
  if (lower === "completed" || lower === "terminal") return "Mission complete";
  if (lower === "rejected") return "Could not start";
  if (lower === "cancelled") return "Cancelled";
  if (lower === "expired") return "Expired";
  return human(value);
};

function Status({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const state = terminalStates.has(lower) && !["rejected", "cancelled", "expired"].includes(lower)
    ? "green"
    : ["rejected", "cancelled", "expired", "disputed"].includes(lower)
      ? "rust"
      : "brass";
  return <span className={`font-mono text-[9.5px] px-2.5 py-1 rounded-lg status-${state}`}>{stateLabel(value)}</span>;
}

function HelpfulError() {
  return <div className="rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust"><strong>We couldn't load your missions.</strong><span className="ml-1">Refresh the page and try again.</span></div>;
}

export default function WorkspaceMissionPage() {
  const [jobs, setJobs] = useState<MissionJob[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/testnet/jobs-history", { credentials: "include" });
        const body = await response.json();
        if (!response.ok) throw new Error("Unable to load mission history");
        if (body.network !== "bsc-testnet" || Number(body.chain_id) !== 97) throw new Error("Mission history is unavailable right now.");
        setJobs(Array.isArray(body.jobs) ? body.jobs : []);
      } catch {
        setError(true);
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
      if (filter === "completed") return terminalStates.has(state) && !["rejected", "cancelled", "expired"].includes(state);
      return true;
    });
  }, [filter, jobs]);

  const filters = [
    ["all", "All missions"],
    ["funded", "Payment secured"],
    ["in_progress", "In progress"],
    ["submitted", "Needs review"],
    ["completed", "Completed"],
  ] as const;

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 font-body text-ink md:px-8">
      <header className="mb-6 flex flex-col gap-4 border-b border-dashed border-[#c8c0af] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="am-kicker">Your work / Missions</span>
          <h1 className="mt-2 font-display text-[32px] font-bold tracking-tight md:text-[40px]">Keep every mission in view.</h1>
          <p className="mt-2 max-w-[560px] text-[12.5px] leading-relaxed text-inksoft">See what is running, what needs your attention, and what has already finished.</p>
        </div>
        <a href="/app" className="btn-asym inline-flex shrink-0 items-center justify-center gap-2 bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi no-underline hover:bg-black">Create a mission <span className="text-brasslt">+</span></a>
      </header>

      <div className="mb-5 flex flex-wrap gap-2 font-mono text-[10.5px]" aria-label="Mission filters">
        {filters.map(([value, label]) => (
          <button key={value} type="button" onClick={() => setFilter(value)} className={`cursor-pointer rounded-[10px_6px_11px_7px] px-3.5 py-2 ${filter === value ? "bg-ink text-paperhi" : "border border-line bg-paperhi text-inksoft hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4"><HelpfulError /></div>}

      {loading ? (
        <section className="card-asym border border-line bg-paperhi p-8 text-[13px] text-inksoft" aria-live="polite">Loading your missions…</section>
      ) : (
        <section className="card-asym border border-line bg-paperhi p-[18px]">
          {filtered.map((job, index) => {
            const state = String(job.chain_status || job.job_status || "open");
            const fallbackTitle = cleanDisplay(job.task_title || job.mission_title, "Your mission");
            const title = cleanDisplay(job.mission_title, fallbackTitle);
            const category = cleanDisplay(job.task_title, "Mission");
            const description = cleanDisplay(job.task_title, title);
            const consoleTarget = job.id || (job.chain_job_id != null ? String(job.chain_job_id) : "");
            const rowKey = job.id || `mission-${job.chain_job_id ?? index}`;
            const last = index === filtered.length - 1;

            return (
              <article key={rowKey} className={`flex min-w-0 flex-col gap-4 py-[19px] sm:flex-row sm:items-start sm:justify-between ${!last ? "border-b border-line" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">{category}</div>
                  <h2 className="my-1.5 text-[16px] font-bold">{title}</h2>
                  <p className="max-w-[470px] text-[12px] leading-relaxed text-inksoft">{description}</p>
                  {job.chain_job_id != null && <span className="mt-2 inline-block font-mono text-[9px] text-inksoft">Tracked securely in the BNB Testnet</span>}
                </div>
                <div className="min-w-0 shrink-0 text-left sm:min-w-[170px] sm:text-right">
                  <Status value={state} />
                  <small className="my-2 block text-[11px] text-inksoft">{state.toLowerCase() === "in_progress" ? "Agent is working on it" : state.toLowerCase() === "submitted" ? "Ready for your review" : "Marketplace mission"}</small>
                  {consoleTarget && <a href={`/mission?job=${encodeURIComponent(consoleTarget)}`} className="text-[11.5px] font-extrabold text-brass no-underline">Review mission →</a>}
                </div>
              </article>
            );
          })}
          {!filtered.length && <div className="py-12 text-center"><strong className="font-display text-[21px]">Nothing here yet.</strong><p className="mt-2 text-[12px] text-inksoft">Create a mission or choose another filter to see more.</p><a href="/app" className="mt-3 inline-block text-[11px] font-extrabold text-brass no-underline">Create your first mission →</a></div>}
        </section>
      )}
    </main>
  );
}
