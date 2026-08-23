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
  recoverable: boolean;
};

const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const compact = (value?: string | number | null) => (value == null ? "—" : String(value).length > 18 ? `${String(value).slice(0, 8)}…${String(value).slice(-6)}` : String(value));
const terminalStates = new Set(["completed", "rejected", "cancelled", "expired", "terminal"]);
const reviewStates = new Set(["submitted", "awaiting_review"]);

function isChainVerifiedSubmission(job: MissionJob) {
  return Number.isFinite(Number(job.chain_job_id)) && String(job.chain_status || "").toLowerCase() === "submitted" && Boolean(job.submitted_at);
}

function isTerminal(job: MissionJob) {
  return terminalStates.has(String(job.chain_status || job.job_status).toLowerCase());
}

function workflowIndex(job: MissionJob) {
  const value = String(job.chain_status || job.job_status).toLowerCase();
  if (isTerminal(job)) return 3;
  if (reviewStates.has(value)) return 2;
  if (["funded", "accepted", "in_progress"].includes(value)) return 1;
  return 0;
}

function Status({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const state = terminalStates.has(lower) ? "green" : ["rejected", "cancelled", "expired", "disputed"].includes(lower) ? "rust" : "brass";
  return <span className={`font-mono text-[9.5px] px-2.5 py-1 rounded-lg status-${state}`}>{human(value)}</span>;
}

function Lifecycle({ job }: { job: MissionJob }) {
  const active = workflowIndex(job);
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-lg bg-deep sm:grid-cols-4">
      {["Planning", "Executing", "Review", "Settled"].map((label, index) => (
        <div key={label} className="border-b border-white/10 p-2 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
          <span className={`block font-mono text-[7.5px] uppercase ${index <= active ? "text-brasslt" : "text-[#726f60]"}`}>{label}</span>
          <i className={`mt-1.5 block h-1.5 w-1.5 rounded-full ${index <= active ? "bg-brasslt" : "bg-[#3a3a30]"}`} />
        </div>
      ))}
    </div>
  );
}

function MissionActions({ job }: { job: MissionJob }) {
  const chainVerified = isChainVerifiedSubmission(job);
  const resultAvailable = chainVerified || String(job.chain_status || "").toLowerCase() === "completed";

  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={job.id ? `/mission?job=${encodeURIComponent(job.id)}` : "/missions"}
        className="font-display rounded-[14px_8px_16px_9px] bg-ink px-4 py-2.5 text-[11px] font-bold text-paperhi no-underline hover:bg-black"
      >
        Open console →
      </a>
      {job.recoverable && (
        <a
          href={`/testnet/recover?job=${encodeURIComponent(job.id)}`}
          className="rounded-[14px_8px_16px_9px] border border-line bg-paperhi px-4 py-2.5 font-mono text-[10px] font-medium text-ink no-underline hover:bg-paper"
        >
          Resume job
        </a>
      )}
      {resultAvailable && job.chain_job_id != null && (
        <a
          href={`/testnet/result?job=${encodeURIComponent(String(job.chain_job_id))}`}
          className="rounded-[14px_8px_16px_9px] border border-line bg-paperhi px-4 py-2.5 font-mono text-[10px] font-medium text-ink no-underline hover:bg-paper"
        >
          View result & verify
        </a>
      )}
      {chainVerified && job.chain_job_id != null && (
        <a
          href={`/testnet/review?job=${encodeURIComponent(String(job.chain_job_id))}&mission=${encodeURIComponent(job.mission_id || "")}&marketplaceJob=${encodeURIComponent(job.id)}`}
          className="rounded-[14px_8px_16px_9px] border border-brass/40 bg-brasssoft px-4 py-2.5 font-mono text-[10px] font-medium text-brass no-underline hover:bg-[#f1e2bf]"
        >
          Review / dispute / settle
        </a>
      )}
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

  async function load() {
    setLoading(true);
    setError("");
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
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return jobs;
    return jobs.filter((job) => {
      const state = String(job.chain_status || job.job_status).toLowerCase();
      if (filter === "planning") return ["open", "planning"].includes(state);
      if (filter === "executing") return ["funded", "accepted", "in_progress"].includes(state);
      if (filter === "review") return reviewStates.has(state);
      if (filter === "completed") return isTerminal(job);
      return true;
    });
  }, [filter, jobs]);

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 font-body text-ink md:px-8">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Missions / All</span>
        <a href="/app" className="btn-asym inline-flex items-center gap-2 self-start bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi no-underline hover:bg-black sm:self-auto">
          + New mission
        </a>
      </div>

      <div className="mb-5 flex flex-wrap gap-2 font-mono text-[10.5px]">
        {["all", "planning", "executing", "review", "completed"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-3.5 py-1.5 ${
              filter === value ? "bg-ink text-paperhi" : "border border-line bg-paperhi text-inksoft hover:text-ink"
            }`}
          >
            {value === "all" ? "All" : human(value)}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust">{error}</div>}

      {loading ? (
        <div className="card-asym bg-paperhi p-8 text-[13px] text-inksoft">Loading verified Testnet missions…</div>
      ) : filtered.length === 0 ? (
        <section className="card-asym bg-paperhi p-8">
          <strong className="font-display text-[21px] font-bold">No missions in this view.</strong>
          <p className="mt-2 max-w-[520px] text-[12px] text-inksoft">Mission state is read from the real marketplace/Testnet workflow. Start a mission or change the filter to see other records.</p>
          <a href="/app" className="mt-4 inline-flex font-extrabold text-[11px] text-brass no-underline">Create a mission →</a>
        </section>
      ) : (
        <section className="card-asym bg-paperhi p-[18px]">
          {filtered.map((job, index) => {
            const state = job.chain_status || job.job_status;
            return (
              <article key={job.id} className={`py-[19px] ${index < filtered.length - 1 ? "border-b border-line" : ""}`}>
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">{job.task_title || job.mission_title}</div>
                    <h2 className="mt-1.5 font-display text-[16px] font-bold">{job.mission_title}</h2>
                    <p className="mt-1.5 max-w-[650px] text-[12px] leading-relaxed text-inksoft">{job.task_title}</p>

                    <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
                      <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Marketplace job</small><strong className="mt-1 block font-mono text-[10.5px]">{compact(job.id)}</strong></div>
                      <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Chain job</small><strong className="mt-1 block font-mono text-[10.5px]">{job.chain_job_id == null ? "Not created" : `#${job.chain_job_id}`}</strong></div>
                      <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Budget</small><strong className="mt-1 block font-mono text-[10.5px]">{job.budget ?? "—"}</strong></div>
                      <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Updated</small><strong className="mt-1 block text-[10.5px]">{date(job.updated_at)}</strong></div>
                    </div>
                  </div>

                  <div className="shrink-0 lg:min-w-[300px]">
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <Status value={state} />
                      <small className="font-mono text-[10px] text-inksoft">{job.chain_status ? `chain: ${human(job.chain_status)}` : "marketplace workflow"}</small>
                    </div>
                    <div className="mt-3 text-left lg:text-right">
                      <Lifecycle job={job} />
                    </div>
                    <div className="mt-3 lg:text-right">
                      <MissionActions job={job} />
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-dashed border-[#d5cfbf] pt-3 font-mono text-[9.5px] text-[#8a8477]">
                  <span>Created {date(job.created_at)}</span>
                  <span>Funded {date(job.funded_at)}</span>
                  <span>Submitted {date(job.submitted_at)}</span>
                  <span>Terminal {date(job.terminal_at)}</span>
                </div>

                {String(job.job_status).toLowerCase() === "submitted" && !isChainVerifiedSubmission(job) && (
                  <div className="mt-3 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-3.5 py-2.5 text-[10.5px] text-rust">
                    Marketplace marked this mission submitted, but there is no verified ERC-8183 chain submission yet. It is not treated as an on-chain agent submission.
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
