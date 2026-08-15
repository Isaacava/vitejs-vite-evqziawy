import { useEffect, useMemo, useState } from "react";
import "./agent-evidence.css";

type Job = {
  id: string;
  description?: string;
  budget?: string;
  status?: number;
  expiredAt?: string;
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

const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

export default function AgentEvidence() {
  const params = new URLSearchParams(window.location.search);
  const initial = params.get("agent") || "";
  const [agentId, setAgentId] = useState(initial);
  const [data, setData] = useState<Response | null>(null);
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
      const response = await fetch(`/api/agent-jobs/watch?agent_id=${encodeURIComponent(id)}&scan=100`, { credentials: "include" });
      const body = (await response.json()) as Response;
      if (!response.ok) throw new Error(body.error || "Unable to load agent evidence");
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load agent evidence");
      setData(null);
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
  const evidenceLabel = useMemo(() => {
    if (!data?.agent) return "WAITING";
    if (activeCount > 0) return "LIVE EVIDENCE";
    return "THIN HISTORY";
  }, [activeCount, data?.agent]);

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
            <p>This workspace shows the signals AgentMarket can verify directly. It does not invent an official ERC-8004 reputation number or hide thin history behind a polished score.</p>
          </div>
          <div className="evidence-state"><small>EVIDENCE STATE</small><strong>{evidenceLabel}</strong><span>ERC-8004 identity + live BSC Testnet job signal</span></div>
        </section>

        <section className="evidence-connect">
          <div>
            <span className="evidence-kicker">AGENT ID</span>
            <strong>{data?.agent?.name || "Owner evidence workspace"}</strong>
            <small>{data?.agent ? compact(data.agent.owner) : "Owner authentication is required to read provider evidence."}</small>
          </div>
          <div className="evidence-form">
            <input value={agentId} onChange={(event) => setAgentId(event.target.value)} placeholder="ERC-8004 agentId" aria-label="ERC-8004 agent ID" />
            <button disabled={loading} onClick={() => void load()}>{loading ? "Reading…" : "Read evidence →"}</button>
          </div>
        </section>

        <div className="evidence-grid">
          <section className="evidence-card">
            <div className="evidence-head"><span>01 / IDENTITY</span><b>{data?.agent?.verification_status || "—"}</b></div>
            <div className="evidence-lines">
              <div><span>AGENT ID</span><strong>{data?.agent?.agent_id || "—"}</strong></div>
              <div><span>OWNER</span><strong>{compact(data?.agent?.owner)}</strong></div>
              <div><span>AGENT STATUS</span><strong>{data?.agent?.status || "—"}</strong></div>
              <div><span>NETWORK</span><strong>{data ? `${data.network || "—"} / ${data.chain_id || "—"}` : "—"}</strong></div>
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
          <div className="evidence-head"><span>03 / EVIDENCE LEDGER</span><b>{jobs.length} CURRENT</b></div>
          {jobs.length === 0 ? (
            <div className="evidence-empty"><strong>No current funded jobs in the scan window.</strong><p>AgentMarket will not translate missing history into a fake zero or a fake high score. Completed and disputed outcomes become useful evidence when the marketplace has verified records for them.</p></div>
          ) : jobs.map((job) => (
            <article className="evidence-job" key={job.id}>
              <div><small>CHAIN JOB #{job.id}</small><strong>{job.description || "Untitled job"}</strong></div>
              <div><span>BUDGET</span><strong>{job.budget || "—"}</strong></div>
              <div><span>STATUS</span><strong>FUNDED</strong></div>
              <div><span>EXPIRY</span><strong>{job.expiredAt ? new Date(Number(job.expiredAt) * 1000).toLocaleString() : "—"}</strong></div>
            </article>
          ))}
        </section>

        <section className="evidence-card evidence-note">
          <div><span className="evidence-kicker">SCORING POLICY</span><h2>No black-box reputation.</h2><p>Capability match, ERC-8004 registration, endpoint liveness, and verified job outcomes can be shown separately. AgentMarket does not claim an official on-chain reputation value unless the underlying registry data is actually available.</p></div>
          <a href="/app" className="evidence-dark-button">Back to marketplace →</a>
        </section>

        <footer className="evidence-footer">Marketplace evidence is owner-scoped in this workspace. ERC-8004 identity and ERC-8183 chain state remain the protocol sources of truth.</footer>
      </div>
    </main>
  );
}
