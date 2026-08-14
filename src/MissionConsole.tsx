import { useCallback, useEffect, useState } from "react";
import "./mission-console.css";

type JobView = {
  job: { id: string; status: string; description: string; budget: number; chain_job_id: number | null; deliverable: string | null };
  task: { id: string; status: string; title: string; role: string } | null;
  mission: { id: string; title: string; goal: string; status: string; category: string } | null;
  evaluation: { verdict: string; notes: string | null; evidence?: { source?: string; decision?: string; reasons?: string[] } | null } | null;
  payment: { amount: number; status: string; tx_hash: string | null; token_symbol: string | null } | null;
};

const STEPS = ["open", "funded", "accepted", "in_progress", "submitted", "terminal"];
const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

export default function MissionConsole() {
  const [jobId] = useState(() => new URLSearchParams(window.location.search).get("job") || "");
  const [data, setData] = useState<JobView | null>(null);
  const [deliverable, setDeliverable] = useState("Completed the requested task and prepared the result for review.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!jobId) return;
    const response = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || "Unable to load job");
    setData(body as JobView);
  }, [jobId]);

  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load job"));
  }, [load]);

  async function action(name: string) {
    if (!jobId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, action: name, deliverable }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Job action failed");
      setMessage(`${human(name)} recorded. Current state: ${human(body.state)}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Job action failed");
    } finally {
      setBusy(false);
    }
  }

  if (!jobId) {
    return <main className="console-page"><div className="console-shell"><section className="console-card"><span className="console-kicker">MISSION CONSOLE</span><h1>No mission selected.</h1><p>Open this page with <code>?job=&lt;job-id&gt;</code>.</p><a className="console-dark-button" href="/app">Back to marketplace →</a></section></div></main>;
  }

  const statusIndex = data ? STEPS.indexOf(data.job.status) : -1;
  const canPrepare = !!data && (data.job.status === "open" || data.job.status === "funded") && !data.job.chain_job_id;
  const riskEvidence = data?.evaluation?.evidence;

  return (
    <main className="console-page">
      <div className="console-curve console-curve-a" aria-hidden="true" />
      <div className="console-curve console-curve-b" aria-hidden="true" />
      <div className="console-shell">
        <header className="console-nav">
          <a href="/" className="console-brand">AgentMarket</a>
          <span>MISSION / CONSOLE</span>
          <a href="/app">Back to marketplace →</a>
        </header>

        {error && <div className="console-alert console-alert-error">{error}</div>}
        {message && <div className="console-alert console-alert-success">{message}</div>}

        {!data ? <section className="console-card console-loading">Loading mission…</section> : <>
          <section className="console-hero">
            <div>
              <span className="console-kicker">MISSION {compact(data.mission?.id)}</span>
              <h1>{data.mission?.title || "Agent mission"}</h1>
              <p>{data.mission?.goal || data.job.description}</p>
              <div className="console-tags"><span>{human(data.job.status)}</span><span>{data.mission?.category || "general"}</span><span>{data.task ? human(data.task.status) : "Task pending"}</span></div>
            </div>
            <div className="console-state"><small>WORKFLOW STATE</small><strong>{human(data.job.status)}</strong><span>{data.job.chain_job_id ? `On-chain job #${data.job.chain_job_id}` : "No chain job yet"}</span></div>
          </section>

          <section className="console-timeline">
            {STEPS.map((step, index) => (
              <div className="console-timeline-step" key={step}>
                <span className={statusIndex >= index ? "done" : ""}>{String(index + 1).padStart(2, "0")}</span>
                <strong>{human(step)}</strong>
                {index < STEPS.length - 1 && <i />}
              </div>
            ))}
          </section>

          <div className="console-grid">
            <section className="console-card">
              <div className="console-section-head"><span>01 / AGENT WORKFLOW</span><b>{data.task?.role || "Provider"}</b></div>
              <h2>Execute the job</h2>
              {canPrepare && (
                <div className="console-chain-callout">
                  <div><small>ERC-8183</small><strong>Turn this mission into a wallet-ready job.</strong><span>Create → policy → budget → approve → fund.</span></div>
                  <a href={`/prepare?mission=${encodeURIComponent(data.mission?.id || "")}`} className="console-brass-button">Prepare on-chain →</a>
                </div>
              )}
              {data.job.status === "open" ? <button className="console-dark-button" disabled={busy} onClick={() => void action("accept")}>Accept job</button> : null}
              {data.job.status === "accepted" ? <button className="console-dark-button" disabled={busy} onClick={() => void action("start")}>Start execution</button> : null}
              {data.job.status === "in_progress" ? <><textarea value={deliverable} onChange={(event) => setDeliverable(event.target.value)} rows={6} className="console-textarea" /><button className="console-dark-button" disabled={busy || !deliverable.trim()} onClick={() => void action("submit")}>Submit deliverable</button></> : null}
              {data.job.status === "submitted" ? <div className="console-review-wait"><small>EVALUATION / SETTLEMENT</small><strong>Waiting for the real evaluator and ERC-8183 settlement flow.</strong><p>The marketplace will not mark payment released or terminal merely because a UI button was pressed.</p></div> : null}
              {data.job.status === "terminal" ? <div className="console-complete">The job is terminal. Review the evidence and real transaction record before treating the mission as fully complete.</div> : null}
            </section>

            <aside className="console-card">
              <div className="console-section-head"><span>02 / ESCROW & EVIDENCE</span><b>{data.payment?.status || "pending"}</b></div>
              <div className="console-stat"><span>Budget</span><strong>{data.job.budget}</strong></div>
              <div className="console-stat"><span>Chain job</span><strong>{data.job.chain_job_id ?? "Pending"}</strong></div>
              <div className="console-stat"><span>Evaluation</span><strong>{data.evaluation?.verdict || "Pending"}</strong></div>
              <div className="console-stat"><span>Payment TX</span><strong>{compact(data.payment?.tx_hash)}</strong></div>
              {riskEvidence?.source === "risk_guardian_runtime" && (
                <div className="console-evidence">
                  <small>RISK GUARDIAN</small>
                  <strong>{human(riskEvidence.decision || "pending")}</strong>
                  <p>{riskEvidence.reasons?.join(" ") || "Decision recorded without additional reasons."}</p>
                </div>
              )}
              <div className="console-evidence"><small>SOURCE OF TRUTH</small><p>Supabase stores marketplace workflow records. A blockchain job ID and transaction hash are shown only when real chain records exist.</p></div>
            </aside>
          </div>
        </>}
      </div>
    </main>
  );
}
