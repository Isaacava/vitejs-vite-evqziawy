import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { parseMarketplaceIntent } from "./lib/intent";
import "./marketplace-workspace.css";

type Agent = {
  agent_id: string;
  name: string | null;
  description: string | null;
  category: string;
  status?: string | null;
  source?: string | null;
  verification_status?: string | null;
  is_first_party?: boolean;
  owner?: string | null;
};

type Match = { agent: Agent; score: number; breakdown: Record<string, number> };
type MatchResponse = { intent: ReturnType<typeof parseMarketplaceIntent>; bestMatch: Match | null; alternatives: Match[] };

type MissionResponse = {
  mission: { id: string };
  task: { id: string };
  job: { id: string; status: string };
};

const examples = [
  "Manage my BNB portfolio conservatively",
  "Find a safe yield strategy for my idle assets",
  "Monitor my lending health factor and liquidation risk",
  "Run a controlled grid strategy",
];

const labels: Record<string, string> = {
  rebalancing: "Rebalancing",
  grid_trading: "Grid Trading",
  yield: "Yield",
  health_factor: "Health Factor",
  other: "General DeFi",
};

function categoryLabel(category: string) {
  return labels[category] || category.replace(/_/g, " ");
}

function scoreColor(score: number) {
  return score >= 85 ? "green" : score >= 70 ? "brass" : "rust";
}

function compactAddress(value?: string | null) {
  if (!value) return "—";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export default function MarketplaceWorkspace() {
  const [goal, setGoal] = useState(examples[0]);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [selected, setSelected] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mission, setMission] = useState<MissionResponse | null>(null);
  const intent = useMemo(() => parseMarketplaceIntent(goal), [goal]);

  async function findAgent() {
    setLoading(true);
    setError("");
    setMission(null);
    try {
      const response = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Matching API unavailable");
      const next = data as MatchResponse;
      setResult(next);
      setSelected(next.bestMatch);
    } catch (cause) {
      setResult(null);
      setSelected(null);
      setError(cause instanceof Error ? cause.message : "Unable to find an agent");
    } finally {
      setLoading(false);
    }
  }

  async function hire() {
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, agent_id: selected.agent.agent_id, budget: 0 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Mission creation failed");
      setMission(data as MissionResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mission creation failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void findAgent();
  }, []);

  const candidates = result?.alternatives ?? [];

  return (
    <main className="workspace">
      <div className="workspace-orbit workspace-orbit-a" aria-hidden="true" />
      <div className="workspace-orbit workspace-orbit-b" aria-hidden="true" />

      <header className="workspace-nav">
        <a href="/" className="workspace-brand">
          <span className="workspace-glyph" aria-hidden="true">
            <svg viewBox="0 0 28 28" fill="none">
              <rect x="1.5" y="1.5" width="25" height="25" rx="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7 18L11.4 10.2L15.2 15L20.8 7.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span>AgentMarket</span>
        </a>
        <div className="workspace-breadcrumb">DISCOVER / MATCH</div>
        <a href="/" className="workspace-exit">Exit →</a>
      </header>

      <section className="workspace-hero">
        <div>
          <div className="workspace-kicker"><span /> LIVE MARKETPLACE</div>
          <h1>Find the agent.<br /><em>Not the profile.</em></h1>
          <p>
            Describe the outcome. We compare compatible ERC-8004 agents using visible reliability signals and keep the hiring path inside one mission workspace.
          </p>
        </div>
        <div className="workspace-stat-block">
          <div><span>Registry</span><strong>ERC-8004</strong></div>
          <div><span>Jobs</span><strong>ERC-8183</strong></div>
          <div><span>Payment rail</span><strong>x402</strong></div>
        </div>
      </section>

      <section className="mission-composer">
        <div className="composer-copy">
          <span className="small-label">YOUR MISSION</span>
          <div className="composer-intent">
            <span>{categoryLabel(intent.category)}</span>
            <span>{intent.risk} risk</span>
          </div>
        </div>
        <textarea value={goal} onChange={(event) => setGoal(event.target.value)} aria-label="Mission goal" />
        <div className="composer-footer">
          <div className="composer-examples">
            {examples.map((example) => (
              <button key={example} type="button" onClick={() => setGoal(example)}>{example}</button>
            ))}
          </div>
          <button type="button" className="brass-button" onClick={() => void findAgent()} disabled={loading}>
            {loading ? "Matching…" : "Find best agent →"}
          </button>
        </div>
      </section>

      {error && <div className="workspace-alert workspace-alert-error">{error}</div>}
      {mission && (
        <div className="workspace-alert workspace-alert-success">
          <div><strong>Mission created.</strong> Job {mission.job.id.slice(0, 8)}… is open.</div>
          <a href={`/?job=${encodeURIComponent(mission.job.id)}`}>Open mission console →</a>
        </div>
      )}

      <section className="results-layout">
        <div className="results-main">
          <div className="section-marker"><span>01</span> MATCH RESULT</div>
          {loading && <div className="workspace-loading">Comparing capability, verification, liveness, history and reputation…</div>}
          {!loading && result?.bestMatch && (
            <article className="best-agent-card">
              <div className="best-agent-top">
                <div>
                  <div className="verified-line"><span className="status-dot" /> {result.bestMatch.agent.verification_status || "Indexed identity"}</div>
                  <h2>{result.bestMatch.agent.name || `Agent #${result.bestMatch.agent.agent_id}`}</h2>
                  <p>{result.bestMatch.agent.description || "On-chain DeFi specialist discovered through the marketplace registry."}</p>
                </div>
                <div className={`score-chip ${scoreColor(result.bestMatch.score)}`}><b>{Math.round(result.bestMatch.score)}</b><span>/100</span></div>
              </div>

              <div className="agent-meta-row">
                <span>{categoryLabel(result.bestMatch.agent.category)}</span>
                <span>{result.bestMatch.agent.status || "unknown endpoint"}</span>
                <span>{result.bestMatch.agent.source || "indexed"}</span>
                {result.bestMatch.agent.is_first_party && <span>first-party</span>}
              </div>

              <div className="why-block">
                <div className="why-head"><span>WHY THIS AGENT</span><strong>Transparent score</strong></div>
                <div className="metric-list">
                  {Object.entries(result.bestMatch.breakdown).map(([key, value]) => (
                    <div className="metric-row" key={key}>
                      <span>{key.replace(/([A-Z])/g, " $1")}</span>
                      <div className="metric-track"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
                      <b>{Math.round(value)}</b>
                    </div>
                  ))}
                </div>
              </div>

              <div className="best-agent-actions">
                <button type="button" className="dark-button" onClick={hire} disabled={loading || !!mission}>
                  {mission ? "Mission created" : "Hire this agent"}
                </button>
                <button type="button" className="outline-button" onClick={() => setSelected(result.bestMatch)}>Inspect agent</button>
              </div>
            </article>
          )}
        </div>

        <aside className="alternatives-panel">
          <div className="section-marker"><span>02</span> ALTERNATIVES</div>
          <div className="alternatives-list">
            {candidates.length === 0 && !loading && <p className="empty-state">No additional compatible agents returned yet.</p>}
            {candidates.map((match) => (
              <button type="button" className="alternative-row" key={match.agent.agent_id} onClick={() => setSelected(match)}>
                <span className="alternative-index">{match.agent.agent_id.slice(-3)}</span>
                <span className="alternative-info"><strong>{match.agent.name || `Agent #${match.agent.agent_id}`}</strong><small>{categoryLabel(match.agent.category)}</small></span>
                <strong className={`alternative-score ${scoreColor(match.score)}`}>{Math.round(match.score)}</strong>
              </button>
            ))}
          </div>
        </aside>
      </section>

      <section className="registry-note">
        <div>
          <span className="small-label">REGISTRY CONTEXT</span>
          <h3>Indexed first. Verified separately.</h3>
          <p>AgentMarket treats ERC-8004 registration, endpoint liveness and reputation as separate signals. New agents are still matchable before they have a long job history.</p>
        </div>
        <div className="registry-path">
          <span>CHAIN</span><b>ERC-8004</b><i>→</i><span>REGISTRY</span><b>AgentMarket</b><i>→</i><span>MATCH</span>
        </div>
      </section>

      {selected && (
        <div className="agent-drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="agent-drawer" onClick={(event) => event.stopPropagation()}>
            <button className="drawer-close" type="button" onClick={() => setSelected(null)} aria-label="Close agent details">×</button>
            <span className="small-label">AGENT PROFILE</span>
            <div className="drawer-score"><b>{Math.round(selected.score)}</b><span>/100 match</span></div>
            <h2>{selected.agent.name || `Agent #${selected.agent.agent_id}`}</h2>
            <p>{selected.agent.description || "No description was published in the registration file yet."}</p>
            <div className="drawer-facts">
              <div><span>agentId</span><b>{selected.agent.agent_id}</b></div>
              <div><span>Owner</span><b>{compactAddress(selected.agent.owner)}</b></div>
              <div><span>Category</span><b>{categoryLabel(selected.agent.category)}</b></div>
              <div><span>Identity</span><b>{selected.agent.verification_status || "indexed"}</b></div>
              <div><span>Endpoint</span><b>{selected.agent.status || "unknown"}</b></div>
            </div>
            <div className="drawer-breakdown">
              {Object.entries(selected.breakdown).map(([key, value]) => (
                <div className="metric-row" key={key}>
                  <span>{key.replace(/([A-Z])/g, " $1")}</span>
                  <div className="metric-track"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
                  <b>{Math.round(value)}</b>
                </div>
              ))}
            </div>
            <button className="dark-button" type="button" onClick={hire} disabled={loading || !!mission}>Hire this agent</button>
          </aside>
        </div>
      )}
    </main>
  );
}
