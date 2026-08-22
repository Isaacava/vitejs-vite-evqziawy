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

const STATUS_LABELS: Record<string, string> = { open: "OPEN", accepted: "ACCEPTED", funded: "FUNDED", in_progress: "IN PROGRESS", submitted: "SUBMITTED", awaiting_review: "AWAITING REVIEW", completed: "COMPLETED", rejected: "REJECTED", cancelled: "CANCELLED", expired: "EXPIRED" };
const compact = (value?: string | number | null) => value == null ? "—" : String(value).length > 18 ? `${String(value).slice(0, 8)}…${String(value).slice(-6)}` : String(value);
function formatDate(value: string | null) { return value ? new Date(value).toLocaleString() : "—"; }
function isChainVerifiedSubmission(job: TestnetJob) { return Number.isFinite(Number(job.chain_job_id)) && String(job.chain_status || "").toLowerCase() === "submitted" && Boolean(job.submitted_at); }
function isTerminal(job: TestnetJob) { return ["completed", "rejected", "cancelled", "expired"].includes(String(job.chain_status || job.job_status).toLowerCase()); }
function isSubmitted(job: TestnetJob) { return String(job.chain_status || job.job_status).toLowerCase() === "submitted"; }
function statusLabel(job: TestnetJob) { if (isChainVerifiedSubmission(job)) return "SUBMITTED / CHAIN VERIFIED"; if (String(job.job_status).toLowerCase() === "submitted") return "SUBMITTED / NOT ON-CHAIN"; return STATUS_LABELS[job.job_status] || job.job_status.toUpperCase(); }

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

  const active = useMemo(() => jobs.filter((job) => !isTerminal(job) && !isSubmitted(job)), [jobs]);
  const terminal = useMemo(() => jobs.filter(isTerminal), [jobs]);
  const verifiedSubmitted = useMemo(() => jobs.filter(isChainVerifiedSubmission), [jobs]);

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a href="/testnet" className="console-brand">AgentMarket Testnet</a>
          <span>MISSION HISTORY</span>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}><a href="/testnet">Sandbox →</a><a href="/app">Marketplace →</a></div>
        </header>
        {error && <div className="console-alert console-alert-error">{error}</div>}
        <section className="console-hero">
          <div><span className="console-kicker">DEVELOPMENT / BSC TESTNET / CHAIN 97</span><h1>Every Testnet mission, one place.</h1><p>Review active and historical missions, resume recoverable jobs, and distinguish marketplace workflow states from submissions that are actually confirmed on ERC-8183.</p></div>
          <div className="console-state"><small>ENVIRONMENT</small><strong>TESTNET ONLY</strong><span>{jobs.length} chain-visible Testnet jobs · {verifiedSubmitted.length} chain-verified submissions</span></div>
        </section>
        <section className="console-grid">
          <div className="console-card"><div className="console-section-head"><span>ACTIVE</span><b>{active.length}</b></div><p className="console-evidence">OPEN, FUNDED, or other non-terminal jobs that are not already submitted on-chain.</p></div>
          <div className="console-card"><div className="console-section-head"><span>CHAIN-VERIFIED SUBMISSIONS</span><b>{verifiedSubmitted.length}</b></div><p className="console-evidence">Jobs with a real chain job ID, ERC-8183 SUBMITTED state, and submission timestamp.</p></div>
          <div className="console-card"><div className="console-section-head"><span>TERMINAL</span><b>{terminal.length}</b></div><p className="console-evidence">COMPLETED, REJECTED, CANCELLED, or EXPIRED jobs retained for history.</p></div>
        </section>
        {loading ? <section className="console-card"><p className="console-evidence">Loading verified Testnet jobs…</p></section> : jobs.length === 0 ? <section className="console-card"><p className="console-evidence">No Testnet jobs are recorded for this account yet. Start from the Testnet marketplace.</p><a className="console-brass-button" href="/app" style={{ textDecoration: "none", display: "inline-flex" }}>Open Testnet marketplace →</a></section> : (
          <section className="console-grid">
            {jobs.map((job) => {
              const chainVerified = isChainVerifiedSubmission(job);
              const resultAvailable = chainVerified || String(job.chain_status || "").toLowerCase() === "completed";
              const reviewHref = chainVerified ? `/testnet/review?job=${encodeURIComponent(String(job.chain_job_id))}&mission=${encodeURIComponent(job.mission_id || "")}&marketplaceJob=${encodeURIComponent(job.id)}` : "";
              const resultHref = resultAvailable ? `/testnet/result?job=${encodeURIComponent(String(job.chain_job_id))}` : "";
              return (
                <article className="console-card" key={job.id}>
                  <div className="console-section-head"><span>{statusLabel(job)}</span><b>{job.chain_status || "UNKNOWN"}</b></div>
                  <h2 style={{ marginTop: 0 }}>{job.mission_title}</h2>
                  <div className="console-stat"><span>Task</span><strong>{job.task_title}</strong></div>
                  <div className="console-stat"><span>Marketplace job</span><strong>{compact(job.id)}</strong></div>
                  <div className="console-stat"><span>Chain job</span><strong>{job.chain_job_id == null ? "Not created" : `#${job.chain_job_id}`}</strong></div>
                  <div className="console-stat"><span>Budget</span><strong>{job.budget ?? "—"}</strong></div>
                  <div className="console-stat"><span>Updated</span><strong>{formatDate(job.updated_at)}</strong></div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                    {job.recoverable && <a className="console-brass-button" href={`/testnet/recover?job=${encodeURIComponent(job.id)}`} style={{ textDecoration: "none", display: "inline-flex" }}>Resume job →</a>}
                    {resultHref && <a className="console-brass-button" href={resultHref} style={{ textDecoration: "none", display: "inline-flex" }}>View result &amp; verify →</a>}
                    {reviewHref && <a className="console-brass-button" href={reviewHref} style={{ textDecoration: "none", display: "inline-flex" }}>Review / dispute / settle →</a>}
                  </div>
                  <p className="console-evidence">Created {formatDate(job.created_at)} · Funded {formatDate(job.funded_at)} · Submitted {formatDate(job.submitted_at)} · Terminal {formatDate(job.terminal_at)}</p>
                  {String(job.job_status).toLowerCase() === "submitted" && !chainVerified && <div className="console-alert console-alert-error" style={{ marginTop: 12 }}>Marketplace marked this record submitted, but no ERC-8183 chain submission is verified yet. This is not counted as an agent on-chain submission.</div>}
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
