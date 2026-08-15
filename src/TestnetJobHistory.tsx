import { useEffect, useMemo, useState } from "react";
import "./mission-console.css";

type TestnetJob = {
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

const STATUS_LABELS: Record<string, string> = {
  open: "OPEN",
  accepted: "ACCEPTED",
  funded: "FUNDED",
  in_progress: "IN PROGRESS",
  submitted: "SUBMITTED",
  awaiting_review: "AWAITING REVIEW",
  completed: "COMPLETED",
  rejected: "REJECTED",
  cancelled: "CANCELLED",
  expired: "EXPIRED",
};

const compact = (value?: string | number | null) => value == null ? "—" : String(value).length > 18 ? `${String(value).slice(0, 8)}…${String(value).slice(-6)}` : String(value);

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function TestnetJobHistory() {
  const [jobs, setJobs] = useState<TestnetJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/testnet/jobs-history", { credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Unable to load Testnet job history");
      if (body.network !== "bsc-testnet" || Number(body.chain_id) !== 97) throw new Error("History endpoint returned a non-Testnet environment.");
      setJobs(Array.isArray(body.jobs) ? body.jobs : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Testnet job history");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const active = useMemo(() => jobs.filter((job) => !["completed", "rejected", "cancelled", "expired"].includes(String(job.job_status).toLowerCase())), [jobs]);
  const completed = useMemo(() => jobs.filter((job) => ["completed", "rejected", "cancelled", "expired"].includes(String(job.job_status).toLowerCase())), [jobs]);

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a href="/" className="console-brand">AgentMarket</a>
          <span>TESTNET JOB HISTORY</span>
          <a href="/testnet">Sandbox →</a>
        </header>

        {error && <div className="console-alert console-alert-error">{error}</div>}

        <section className="console-hero">
          <div>
            <span className="console-kicker">DEVELOPMENT / BSC TESTNET / CHAIN 97</span>
            <h1>Every Testnet job, one place.</h1>
            <p>Recover unfinished jobs after a browser close or refresh. AgentMarket verifies the real Testnet Commerce job before showing it here.</p>
          </div>
          <div className="console-state"><small>ENVIRONMENT</small><strong>TESTNET ONLY</strong><span>{jobs.length} verified Testnet jobs</span></div>
        </section>

        <section className="console-grid">
          <div className="console-card"><div className="console-section-head"><span>ACTIVE</span><b>{active.length}</b></div><p className="console-evidence">Jobs that may still require execution, provider completion, settlement, or another protocol action.</p></div>
          <div className="console-card"><div className="console-section-head"><span>TERMINAL</span><b>{completed.length}</b></div><p className="console-evidence">Completed, rejected, cancelled, or expired jobs retained for Testnet history.</p></div>
        </section>

        {loading ? (
          <section className="console-card"><p className="console-evidence">Loading verified Testnet jobs…</p></section>
        ) : jobs.length === 0 ? (
          <section className="console-card"><p className="console-evidence">No verified Testnet jobs are recorded for this account yet. Start from the Testnet sandbox.</p><a className="console-brass-button" href="/testnet" style={{ textDecoration: "none", display: "inline-flex" }}>Open Testnet sandbox →</a></section>
        ) : (
          <section className="console-grid">
            {jobs.map((job) => (
              <article className="console-card" key={job.id}>
                <div className="console-section-head"><span>{STATUS_LABELS[job.job_status] || job.job_status.toUpperCase()}</span><b>{job.chain_status || "UNKNOWN"}</b></div>
                <h2 style={{ marginTop: 0 }}>{job.mission_title}</h2>
                <div className="console-stat"><span>Task</span><strong>{job.task_title}</strong></div>
                <div className="console-stat"><span>Marketplace job</span><strong>{compact(job.id)}</strong></div>
                <div className="console-stat"><span>Chain job</span><strong>#{job.chain_job_id}</strong></div>
                <div className="console-stat"><span>Budget</span><strong>{job.budget ?? "—"}</strong></div>
                <div className="console-stat"><span>Updated</span><strong>{formatDate(job.updated_at)}</strong></div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                  {job.recoverable && <a className="console-brass-button" href={`/testnet/recover?job=${encodeURIComponent(job.id)}`} style={{ textDecoration: "none", display: "inline-flex" }}>Resume job →</a>}
                </div>
                <p className="console-evidence">Created {formatDate(job.created_at)} · Funded {formatDate(job.funded_at)} · Submitted {formatDate(job.submitted_at)} · Terminal {formatDate(job.terminal_at)}</p>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
