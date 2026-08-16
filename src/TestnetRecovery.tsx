import { useEffect, useState } from "react";
import "./mission-console.css";

type RecoveryResponse = {
  ok: boolean;
  network: string;
  chain_id: number;
  marketplace_job: { id: string; status: string; chain_job_id: number | null; chain_status: string; updated_at: string };
  onchain_job: { id: string; status_name: string; provider: string; budget: string; expired_at: string } | null;
  recovery: { next_step: string; requires_chain_sync: boolean; can_resume: boolean };
};

const ACTION_PATH: Record<string, (job: RecoveryResponse) => string> = {
  create: () => "/app",
  register: (job) => `/testnet/execute?job=${encodeURIComponent(job.marketplace_job.id)}`,
  provider_execution: (job) => `/testnet/execute?job=${encodeURIComponent(job.marketplace_job.id)}`,
  settle_or_dispute: (job) => `/testnet/execute?job=${encodeURIComponent(job.marketplace_job.id)}`,
  claim_refund: (job) => `/lifecycle?job=${encodeURIComponent(String(job.marketplace_job.chain_job_id || ""))}`,
};

export default function TestnetRecovery() {
  const jobId = new URLSearchParams(window.location.search).get("job") || "";
  const [data, setData] = useState<RecoveryResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (!jobId) throw new Error("Open this page with ?job=<marketplace-job-id>.");
        const response = await fetch(`/api/testnet/recover-job?job_id=${encodeURIComponent(jobId)}`, { credentials: "include" });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "Unable to recover Testnet job");
        if (body.network !== "bsc-testnet" || Number(body.chain_id) !== 97) throw new Error("Recovery returned a non-Testnet environment.");
        if (active) setData(body as RecoveryResponse);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to recover Testnet job");
      }
    }
    void load();
    return () => { active = false; };
  }, [jobId]);

  const nextPath = data ? ACTION_PATH[data.recovery.next_step]?.(data) : null;

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a href="/" className="console-brand">AgentMarket</a>
          <span>TESTNET / JOB RECOVERY</span>
          <a href="/testnet">Sandbox →</a>
        </header>
        {error && <div className="console-alert console-alert-error">{error}</div>}
        <section className="console-hero">
          <div>
            <span className="console-kicker">RECOVER AFTER RELOAD / CHAIN 97</span>
            <h1>Resume from the blockchain, not from memory.</h1>
            <p>AgentMarket reads the persisted marketplace job and the real BSC Testnet ERC-8183 job, then chooses the next safe step.</p>
          </div>
          <div className="console-state"><small>ENVIRONMENT</small><strong>TESTNET ONLY</strong><span>Source of truth: BSC Testnet</span></div>
        </section>

        {data ? (
          <>
            <section className="console-grid">
              <div className="console-card">
                <div className="console-section-head"><span>MARKETPLACE JOB</span><b>{data.marketplace_job.status}</b></div>
                <div className="console-stat"><span>ID</span><strong>{data.marketplace_job.id}</strong></div>
                <div className="console-stat"><span>Stored chain job</span><strong>{data.marketplace_job.chain_job_id ?? "Not created"}</strong></div>
                <div className="console-stat"><span>Stored chain status</span><strong>{data.marketplace_job.chain_status}</strong></div>
              </div>
              <div className="console-card">
                <div className="console-section-head"><span>ON-CHAIN JOB</span><b>{data.onchain_job?.status_name || "NOT CREATED"}</b></div>
                <div className="console-stat"><span>Job</span><strong>{data.onchain_job?.id || "—"}</strong></div>
                <div className="console-stat"><span>Provider</span><strong>{data.onchain_job?.provider || "—"}</strong></div>
                <div className="console-stat"><span>Budget</span><strong>{data.onchain_job?.budget || "—"}</strong></div>
                <div className="console-stat"><span>Needs DB sync</span><strong>{data.recovery.requires_chain_sync ? "Yes" : "No"}</strong></div>
              </div>
            </section>

            <section className="console-card console-plan-card">
              <div className="console-section-head"><span>RECOVERY DECISION</span><b>{data.recovery.can_resume ? data.recovery.next_step : "terminal"}</b></div>
              <p className="console-evidence">The recovery decision uses the Testnet Commerce state. This prevents a browser reload from replaying a transaction that already succeeded.</p>
              {nextPath && data.recovery.can_resume ? (
                <a className="console-brass-button" href={nextPath} style={{ display: "inline-flex", textDecoration: "none" }}>
                  Resume Testnet job →
                </a>
              ) : (
                <p className="console-evidence">This job is already terminal. Review the recorded state instead of replaying wallet transactions.</p>
              )}
            </section>
          </>
        ) : !error ? (
          <section className="console-card"><p className="console-evidence">Reading the Testnet marketplace job and BSC Testnet Commerce state…</p></section>
        ) : null}
      </div>
    </main>
  );
}
