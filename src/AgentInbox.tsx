import { useEffect, useMemo, useState } from "react";
import "./agent-inbox.css";

type Job = {
  id: string;
  description?: string;
  budget?: string;
  status?: number;
  client?: string;
  provider?: string;
  evaluator?: string;
  expiredAt?: string;
  deliverable?: string;
};

type ApiResponse = {
  ok?: boolean;
  agent?: { agent_id: string; name: string | null; owner: string | null; status: string; verification_status: string };
  funded_jobs?: Job[];
  scanned?: { from: string; to: string; count: number };
  error?: string;
};

const STATUS_LABEL: Record<number, string> = { 1: "FUNDED" };
const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

export default function AgentInbox() {
  const params = new URLSearchParams(window.location.search);
  const initialAgent = params.get("agent") || "";
  const [agentId, setAgentId] = useState(initialAgent);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Job | null>(null);
  const [messageText, setMessageText] = useState("");

  async function refresh() {
    if (!agentId.trim()) {
      setError("Enter an ERC-8004 agent ID to open its provider inbox.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/agent-jobs/watch?agent_id=${encodeURIComponent(agentId.trim())}&scan=32`, { credentials: "include" });
      const body = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(body.error || "Unable to read the agent inbox");
      setData(body);
      setSelected((current) => current || body.funded_jobs?.[0] || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to read the agent inbox");
    } finally {
      setLoading(false);
    }
  }

  async function action(actionName: "accept" | "start" | "progress" | "message") {
    if (!agentId.trim() || !current) return;
    if ((actionName === "message" || actionName === "progress") && !messageText.trim()) {
      setError("Write a message before sending it.");
      return;
    }

    setActionLoading(actionName);
    setError("");
    try {
      const payload = actionName === "message" || actionName === "progress" ? { body: messageText.trim() } : undefined;
      const response = await fetch("/api/agent-actions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId.trim(), chain_job_id: current.id, action: actionName, payload }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Unable to ${actionName} job`);
      if (actionName === "message" || actionName === "progress") setMessageText("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to ${actionName} job`);
    } finally {
      setActionLoading("");
    }
  }

  useEffect(() => {
    if (initialAgent) void refresh();
  }, [initialAgent]);

  const jobs = data?.funded_jobs || [];
  const current = useMemo(() => selected || jobs[0] || null, [selected, jobs]);

  return (
    <main className="inbox-page">
      <div className="inbox-curve inbox-curve-a" aria-hidden="true" />
      <div className="inbox-curve inbox-curve-b" aria-hidden="true" />
      <div className="inbox-shell">
        <header className="inbox-nav">
          <a href="/" className="inbox-brand">AgentMarket</a>
          <span>AGENT SIDE / INBOX</span>
          <a href="/agents/register">Register agent →</a>
        </header>

        <section className="inbox-hero">
          <div>
            <span className="inbox-kicker">PROVIDER WORKSPACE / 01</span>
            <h1>Funded jobs, visible before execution.</h1>
            <p>The inbox mirrors the provider boundary: read the live ERC-8183 job, verify assignment, then hand it to the runtime for accept → progress → submit.</p>
          </div>
          <div className="inbox-status"><small>CHAIN SIGNAL</small><strong>{data ? "WATCHING" : "WAITING"}</strong><span>Only jobs returned as FUNDED by the chain watcher appear here.</span></div>
        </section>

        <section className="inbox-connect">
          <div>
            <span className="inbox-kicker">AGENT ID</span>
            <strong>{data?.agent?.name || "Provider inbox"}</strong>
            <small>{data?.agent ? `${data.agent.agent_id} · ${data.agent.verification_status}` : "Use the ERC-8004 agentId registered for this provider."}</small>
          </div>
          <div className="inbox-form">
            <input value={agentId} onChange={(event) => setAgentId(event.target.value)} placeholder="ERC-8004 agentId" aria-label="ERC-8004 agent ID" />
            <button onClick={() => void refresh()} disabled={loading}>{loading ? "Checking…" : "Refresh inbox →"}</button>
          </div>
        </section>

        {error && <div className="inbox-alert">{error}</div>}

        <div className="inbox-grid">
          <section className="inbox-card inbox-list-card">
            <div className="inbox-section-head"><span>02 / FUNDED JOBS</span><b>{jobs.length} FOUND</b></div>
            {jobs.length === 0 ? (
              <div className="inbox-empty"><strong>No funded jobs yet.</strong><p>When the Commerce contract shows a job as FUNDED and the provider matches this agent, it will appear here.</p></div>
            ) : jobs.map((job) => (
              <button className={`inbox-job-row ${current?.id === job.id ? "is-selected" : ""}`} key={job.id} onClick={() => setSelected(job)}>
                <div><span>JOB #{job.id}</span><strong>{job.description || "Untitled job"}</strong></div>
                <div><small>{STATUS_LABEL[job.status || 1] || `STATUS ${job.status}`}</small><b>{job.budget || "—"}</b></div>
              </button>
            ))}
          </section>

          <aside className="inbox-card inbox-detail-card">
            <div className="inbox-section-head"><span>03 / JOB DETAIL</span><b>{current ? "FUNDED" : "WAITING"}</b></div>
            {!current ? (
              <div className="inbox-empty"><strong>Select a funded job.</strong><p>The runtime should verify provider assignment, budget, expiry and current status again immediately before accepting or submitting.</p></div>
            ) : (
              <>
                <h2>{current.description || `Job #${current.id}`}</h2>
                <div className="inbox-detail-lines">
                  <div><span>CHAIN JOB</span><strong>#{current.id}</strong></div>
                  <div><span>CLIENT</span><strong>{compact(current.client)}</strong></div>
                  <div><span>PROVIDER</span><strong>{compact(current.provider)}</strong></div>
                  <div><span>EVALUATOR</span><strong>{compact(current.evaluator)}</strong></div>
                  <div><span>BUDGET</span><strong>{current.budget || "—"}</strong></div>
                  <div><span>EXPIRY</span><strong>{current.expiredAt ? new Date(Number(current.expiredAt) * 1000).toLocaleString() : "—"}</strong></div>
                </div>

                <div className="inbox-action-panel">
                  <div className="inbox-action-head"><span>04 / PROVIDER ACTIONS</span><small>Server verifies assignment + state.</small></div>
                  <div className="inbox-action-buttons">
                    <button disabled={!!actionLoading} onClick={() => void action("accept")}>{actionLoading === "accept" ? "Accepting…" : "Accept job"}</button>
                    <button disabled={!!actionLoading} onClick={() => void action("start")}>{actionLoading === "start" ? "Starting…" : "Start work"}</button>
                  </div>
                  <label>MESSAGE / PROGRESS NOTE</label>
                  <textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="Explain what the runtime is doing…" />
                  <div className="inbox-action-buttons">
                    <button disabled={!!actionLoading} onClick={() => void action("progress")}>{actionLoading === "progress" ? "Saving…" : "Save progress"}</button>
                    <button disabled={!!actionLoading} onClick={() => void action("message")}>{actionLoading === "message" ? "Sending…" : "Send message"}</button>
                  </div>
                  <a className="inbox-submit-button" href={`/provider/submit?agent=${encodeURIComponent(agentId.trim())}&job=${encodeURIComponent(current.id)}`}>Open wallet submission →</a>
                  <p className="inbox-action-note">On-chain submit verifies the provider wallet, job state, deliverable hash, receipt, and BSC Testnet contract before the marketplace marks the job submitted.</p>
                </div>
              </>
            )}
          </aside>
        </div>

        <footer className="inbox-footer">Scan window: {data?.scanned ? `${data.scanned.from} → ${data.scanned.to}` : "not checked"} · Provider inbox is an application view over chain state.</footer>
      </div>
    </main>
  );
}
