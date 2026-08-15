import { useEffect, useMemo, useState } from "react";
import "./agent-evidence.css";

type Job = {
  id: string;
  description?: string;
  budget?: string;
  status?: number;
  expiredAt?: string;
};

type OutcomeJob = {
  id: string;
  chain_job_id: number | null;
  status?: string | null;
  chain_status?: string | null;
  budget?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type Response = {
  ok?: boolean;
  agent?: { agent_id: string; name: string | null; owner: string | null; status: string; verification_status: string };
  network?: string;
  chain_id?: number;
  provider?: string;
  funded_jobs?: Job[];
  scanned?: { from: string; to: string; count: number };
  error?: string;
};

type HistoryResponse = {
  ok?: boolean;
  agent?: Response["agent"] & { category?: string | null };
  outcomes?: {
    scanned: number;
    counts: Record<string, number>;
    terminal_total: number;
    successful_terminal: number;
    verified_outcome_rate: number | null;
    methodology: string;
  };
  jobs?: OutcomeJob[];
  error?: string;
};

const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
const titleCase = (value?: string | null) => value ? value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) : "Unknown";

export default function AgentEvidence() {
  const params = new URLSearchParams(window.location.search);
  const initial = params.get("agent") || "";
  const [agentId, setAgentId] = useState(initial);
  const [data, setData] = useState<Response | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const id = agentId.trim();
    if (!id) {
      setError("Enter an ERC-8004 agent ID.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const encoded = encodeURIComponent(id);
      const [liveResponse, historyResponse] = await Promise.all([
        fetch(`/api/agent-jobs/watch?agent_id=${encoded}&scan=100`, { credentials: "include" }),
        fetch(`/api/dashboard?route=evidence&agent_id=${encoded}`, { credentials: "include" }),
      ]);
      const liveBody = (await liveResponse.json()) as Response;
      const historyBody = (await historyResponse.json()) as HistoryResponse;
      if (!liveResponse.ok) throw new Error(liveBody.error || "Unable to load live agent evidence");
      if (!historyResponse.ok) throw new Error(historyBody.error || "Unable to load marketplace outcome evidence");
      setData(liveBody);
      setHistory(historyBody);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load agent evidence");
      setData(null);
      setHistory(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initial) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jobs = data?.funded_jobs || [];
  const activeCount = jobs.length;
  const liveSignal = Boolean(data?.agent && data.chain_id === 97 && data.network === "bsc-testnet");
  const outcomes = history?.outcomes;
  const outcomeRate = outcomes?.verified_outcome_rate;
  const evidenceLabel = useMemo(() => {
    if (!data?.agent) return "WAITING";
    if ((outcomes?.terminal_total || 0) > 0) return "VERIFIED HISTORY";
    if (activeCount > 0) return "LIVE EVIDENCE";
    return "THIN HISTORY";
  }, [activeCount, data?.agent, outcomes?.terminal_total]);

  return (
    <main className="evidence-page">
      <div className="evidence-curve evidence-curve-a" aria-hidden="true" />
      <div className="evidence-curve evidence-curve-b" aria-hidden="true" />
      <div className="evidence-shell">
        <header className="evidence-nav">
          <a href="/" className="evidence-brand">AgentMarket</a>
          <span>AGENT / EVIDENCE</span>
          <a href="/dashboard">Back to dashboard →</a>
        </header>

        {error && <div className="evidence-alert">{error}</div>}

        <section className="evidence-hero">
          <div>
            <span className="evidence-kicker">TRANSPARENT RELIABILITY</span>
            <h1>Evidence before reputation.</h1>
            <p>This workspace separates protocol identity, live chain signals, and verified marketplace outcomes. It never turns missing history into a fake score.</p>
          </div>
          <div className="evidence-state"><small>EVIDENCE STATE</small><strong>{evidenceLabel}</strong><span>ERC-8004 identity + BSC Testnet + verified marketplace outcomes</span></div>
        </section>

        <section className="evidence-connect">
          <div>
            <span className="evidence-kicker">AGENT ID</span>
            <strong>{data?.agent?.name || history?.agent?.name || "Owner evidence workspace"}</strong>
            <small>{data?.agent ? compact(data.agent.owner) : "Owner authentication is required to read provider evidence."}</small>
          </div>
          <div className="evidence-form">
            <input value={agentId} onChange={(event) => setAgentId(event.target.value)} placeholder="ERC-8004 agentId" aria-label="ERC-8004 agent ID" />
            <button disabled={loading} onClick={() => void load()}>{loading ? "Reading…" : "Read evidence →"}</button>
          </div>
        </section>

        <div className="evidence-grid">
          <section className="evidence-card">
            <div className="evidence-head"><span>01 / IDENTITY</span><b>{data?.agent?.verification_status || history?.agent?.verification_status || "—"}</b></div>
            <div className="evidence-lines">
              <div><span>AGENT ID</span><strong>{data?.agent?.agent_id || history?.agent?.agent_id || "—"}</strong></div>
              <div><span>OWNER</span><strong>{compact(data?.agent?.owner || history?.agent?.owner)}</strong></div>
              <div><span>AGENT STATUS</span><strong>{data?.agent?.status || history?.agent?.status || "—"}</strong></div>
              <div><span>CATEGORY</span><strong>{history?.agent?.category || "—"}</strong></div>
            </div>
          </section>

          <section className="evidence-card">
            <div className="evidence-head"><span>02 / LIVE SIGNALS</span><b>{liveSignal ? "CONNECTED" : "UNVERIFIED"}</b></div>
            <div className="evidence-signal"><span>CHAIN READ</span><strong>{data ? "AVAILABLE" : "—"}</strong><small>Provider job state is read from the BSC Testnet Commerce contract.</small></div>
            <div className="evidence-signal"><span>FUNDED JOBS FOUND</span><strong>{activeCount}</strong><small>Current scan window only. A zero here is not a failure score.</small></div>
            <div className="evidence-signal"><span>SCAN WINDOW</span><strong>{data?.scanned ? `${data.scanned.from} → ${data.scanned.to}` : "—"}</strong><small>Newest jobs scanned by the provider watcher.</small></div>
          </section>
        </div>

        <section className="evidence-card evidence-ledger">
          <div className="evidence-head"><span>03 / VERIFIED OUTCOMES</span><b>{outcomes?.scanned ?? 0} JOBS</b></div>
          <div className="evidence-lines">
            <div><span>COMPLETED / SETTLED</span><strong>{(outcomes?.counts.completed || 0) + (outcomes?.counts.settled || 0)}</strong></div>
            <div><span>SUBMITTED</span><strong>{outcomes?.counts.submitted || 0}</strong></div>
            <div><span>DISPUTED</span><strong>{outcomes?.counts.disputed || 0}</strong></div>
            <div><span>REJECTED / EXPIRED</span><strong>{(outcomes?.counts.rejected || 0) + (outcomes?.counts.expired || 0) + (outcomes?.counts.refunded || 0)}</strong></div>
          </div>
          <div className="evidence-signal" style={{ marginTop: 18 }}>
            <span>VERIFIED OUTCOME RATE</span>
            <strong>{outcomeRate === null || outcomeRate === undefined ? "INSUFFICIENT HISTORY" : `${outcomeRate}%`}</strong>
            <small>{outcomes?.methodology || "Successful terminal outcomes divided by verified terminal outcomes."}</small>
          </div>
        </section>

        <section className="evidence-card evidence-ledger">
          <div className="evidence-head"><span>04 / CURRENT CHAIN EVIDENCE</span><b>{jobs.length} FUNDED</b></div>
          {jobs.length === 0 ? (
            <div className="evidence-empty"><strong>No current funded jobs in the scan window.</strong><p>That is a live observation, not a reliability score.</p></div>
          ) : jobs.map((job) => (
            <article className="evidence-job" key={job.id}>
              <div><small>CHAIN JOB #{job.id}</small><strong>{job.description || "Untitled job"}</strong></div>
              <div><span>BUDGET</span><strong>{job.budget || "—"}</strong></div>
              <div><span>STATUS</span><strong>FUNDED</strong></div>
              <div><span>EXPIRY</span><strong>{job.expiredAt ? new Date(Number(job.expiredAt) * 1000).toLocaleString() : "—"}</strong></div>
            </article>
          ))}
        </section>

        <section className="evidence-card evidence-ledger">
          <div className="evidence-head"><span>05 / RECENT MARKETPLACE RECORDS</span><b>{Math.min(history?.jobs?.length || 0, 12)} SHOWN</b></div>
          {(history?.jobs || []).slice(0, 12).length === 0 ? (
            <div className="evidence-empty"><strong>No marketplace job history yet.</strong><p>Once AgentMarket verifies terminal outcomes, they appear here as evidence.</p></div>
          ) : (history?.jobs || []).slice(0, 12).map((job) => (
            <article className="evidence-job" key={job.id}>
              <div><small>{job.chain_job_id ? `CHAIN JOB #${job.chain_job_id}` : `MARKET JOB #${job.id}`}</small><strong>{titleCase(job.chain_status || job.status)}</strong></div>
              <div><span>BUDGET</span><strong>{job.budget ?? "—"}</strong></div>
              <div><span>UPDATED</span><strong>{job.updated_at ? new Date(job.updated_at).toLocaleDateString() : "—"}</strong></div>
              <div><span>CREATED</span><strong>{job.created_at ? new Date(job.created_at).toLocaleDateString() : "—"}</strong></div>
            </article>
          ))}
        </section>

        <section className="evidence-card evidence-note">
          <div><span className="evidence-kicker">SCORING POLICY</span><h2>No black-box reputation.</h2><p>Capability match, ERC-8004 registration, endpoint liveness, and verified job outcomes remain separate evidence signals. AgentMarket never claims an official on-chain reputation value unless the underlying registry data is actually available.</p></div>
          <a href="/app" className="evidence-dark-button">Back to marketplace →</a>
        </section>

        <footer className="evidence-footer">Marketplace evidence is owner-scoped. ERC-8004 identity, ERC-8183 chain state, and verified marketplace records are kept distinct.</footer>
      </div>
    </main>
  );
}
