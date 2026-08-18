import { useEffect, useMemo, useState } from "react";
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

type Match = {
  agent: Agent;
  score: number;
  scoreMax?: number;
  scoreConfidence?: "high" | "medium" | "low";
  breakdown: Record<string, number>;
  evidence?: {
    reputationAvailable?: boolean;
    completionAvailable?: boolean;
    livenessAvailable?: boolean;
  };
  hireability?: {
    status: "ready" | "degraded" | "discoverable_only";
    canCreateJob: boolean;
    reason: string;
  };
  reasons?: string[];
};
type MatchResponse = {
  environment?: "production" | "testnet";
  network?: string;
  chain_id?: number;
  intent: ReturnType<typeof parseMarketplaceIntent>;
  bestMatch: Match | null;
  bestHireableMatch?: Match | null;
  alternatives: Match[];
};
type MissionResponse = { mission: { id: string }; task: { id: string }; job: { id: string; status: string } };

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

function confidenceLabel(value?: Match["scoreConfidence"]) {
  if (value === "high") return "HIGH CONFIDENCE";
  if (value === "medium") return "MEDIUM CONFIDENCE";
  return "LIMITED HISTORY";
}

function hireabilityLabel(match?: Match | null) {
  if (!match?.hireability) return "READINESS UNKNOWN";
  if (match.hireability.status === "ready") return "READY TO HIRE";
  if (match.hireability.status === "degraded") return "PROVIDER DEGRADED";
  return "DISCOVERABLE ONLY";
}

export default function MarketplaceWorkspace() {
  const [goal, setGoal] = useState(examples[3]);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [selected, setSelected] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mission, setMission] = useState<MissionResponse | null>(null);
  const intent = useMemo(() => parseMarketplaceIntent(goal), [goal]);
  const testnetMode = new URLSearchParams(window.location.search).get("network") === "testnet";

  async function findAgent() {
    setLoading(true);
    setError("");
    setMission(null);
    try {
      const response = await fetch(testnetMode ? "/api/testnet/match" : "/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Matching API unavailable");
      const next = data as MatchResponse;
      setResult(next);
      setSelected(next.bestHireableMatch ?? next.bestMatch);
    } catch (cause) {
      setResult(null);
      setSelected(null);
      setError(cause instanceof Error ? cause.message : "Unable to find an agent");
    } finally {
      setLoading(false);
    }
  }

  async function hire(match: Match | null = selected) {
    if (!match) return;
    if (!match.hireability?.canCreateJob) {
      setError(match.hireability?.reason || "This agent is discoverable but is not ready to accept jobs.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const authResponse = await fetch("/api/auth/me", { credentials: "include" });
      if (!authResponse.ok) {
        window.location.href = `/dashboard?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }

      const response = await fetch("/api/missions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, agent_id: match.agent.agent_id, budget: 0 }),
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
  }, [testnetMode]);

  const candidates = result?.alternatives ?? [];
  const discoveryBest = result?.bestMatch ?? null;
  const best = result?.bestHireableMatch ?? discoveryBest;
  const bestReady = Boolean(best?.hireability?.canCreateJob);
  const showingHireableFallback = Boolean(result?.bestHireableMatch && discoveryBest && result.bestHireableMatch.agent.agent_id !== discoveryBest.agent.agent_id);

  return (
    <main className="workspace">
      <div className="workspace-orbit workspace-orbit-a" aria-hidden="true" />
      <div className="workspace-orbit workspace-orbit-b" aria-hidden="true" />

      <header className="workspace-nav">
        <a href="/" className="workspace-brand">
          <span className="workspace-glyph" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none"><rect x="1.5" y="1.5" width="25" height="25" rx="7" stroke="currentColor" strokeWidth="1.5" /><path d="M7 18L11.4 10.2L15.2 15L20.8 7.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <span>AgentMarket</span>
        </a>
        <div className="workspace-breadcrumb">{testnetMode ? "TESTNET / GRID AGENT" : "DISCOVER / MATCH"}</div>
        <div className="workspace-nav-links"><a href="/dashboard">Dashboard</a><a href="/">Exit →</a></div>
      </header>

      <section className="workspace-hero">
        <div>
          <div className="workspace-kicker"><span /> {testnetMode ? "ISOLATED BSC TESTNET" : "LIVE MARKETPLACE"}</div>
          <h1>{testnetMode ? <>Test the Grid agent.<br /><em>Nothing from Mainnet.</em></> : <>Find the agent.<br /><em>Not the profile.</em></>}</h1>
          <p>{testnetMode ? "This workspace only discovers the first-party Testnet Grid Agent. Mainnet ERC-8004 agents are excluded from matching, hiring and execution." : "Describe the outcome. We compare compatible ERC-8004 agents using visible reliability signals and keep the hiring path inside one mission workspace."}</p>
        </div>
        <div className="workspace-stat-block"><div><span>Registry</span><strong>ERC-8004</strong></div><div><span>Jobs</span><strong>ERC-8183</strong></div><div><span>Network</span><strong>{testnetMode ? "BSC TESTNET" : "BSC MAINNET"}</strong></div></div>
      </section>

      <section className="mission-composer">
        <div className="composer-copy"><span className="small-label">YOUR MISSION</span><div className="composer-intent"><span>{categoryLabel(intent.category)}</span><span>{intent.risk} risk</span></div></div>
        <textarea value={goal} onChange={(event) => setGoal(event.target.value)} aria-label="Mission goal" />
        <div className="composer-footer"><div className="composer-examples">{examples.map((example) => <button key={example} type="button" onClick={() => setGoal(example)}>{example}</button>)}</div><button type="button" className="brass-button" onClick={() => void findAgent()} disabled={loading}>{loading ? "Matching…" : "Find best agent →"}</button></div>
      </section>

      {testnetMode && <div className="workspace-alert workspace-alert-success">TESTNET ISOLATION: only agents tagged <strong>environment=testnet</strong> and <strong>network=bsc-testnet</strong> are eligible in this workspace.</div>}
      {error && <div className="workspace-alert workspace-alert-error">{error}</div>}
      {mission && <div className="workspace-alert workspace-alert-success"><div><strong>Mission created.</strong> Job {mission.job.id.slice(0, 8)}… is open.</div><a href={`/?job=${encodeURIComponent(mission.job.id)}`}>Open mission console →</a></div>}

      <section className="results-layout">
        <div className="results-main">
          <div className="section-marker"><span>01</span> MATCH RESULT</div>
          {loading && <div className="workspace-loading">{testnetMode ? "Checking the isolated Testnet Grid provider…" : "Comparing capability, verification, liveness, history and reputation…"}</div>}
          {!loading && best && (
            <article className="best-agent-card">
              <div className="best-agent-top">
                <div>
                  <div className="verified-line"><span className="status-dot" /> {hireabilityLabel(best)}</div>
                  <h2>{best.agent.name || `Agent #${best.agent.agent_id}`}</h2>
                  <p>{best.agent.description || "On-chain DeFi specialist discovered through the marketplace registry."}</p>
                </div>
                <div className={`score-chip ${scoreColor(best.score)}`}><b>{Math.round(best.score)}</b><span>/100</span></div>
              </div>
              <div className="agent-meta-row"><span>{categoryLabel(best.agent.category)}</span><span>{best.agent.status || "unknown endpoint"}</span><span>{testnetMode ? "bsc-testnet" : best.agent.source || "indexed"}</span>{best.agent.is_first_party && <span>first-party</span>}</div>
              {showingHireableFallback && <div className="workspace-alert workspace-alert-success" style={{ marginTop: 16, marginBottom: 0 }}>The highest-ranked discovery agent is not currently hireable, so we selected the strongest ready provider instead.</div>}
              {!bestReady && best.hireability && <div className="workspace-alert workspace-alert-error" style={{ marginTop: 16, marginBottom: 0 }}>{best.hireability.reason}</div>}
              <div className="why-block">
                <div className="why-head"><span>WHY THIS AGENT</span><strong>{confidenceLabel(best.scoreConfidence)}</strong></div>
                <div className="why-summary"><span>Normalized match</span><b>{Math.round(best.score)}/100</b><span>Available evidence ceiling</span><b>{Math.round(best.scoreMax ?? 100)}/100</b></div>
                <div className="metric-list">{Object.entries(best.breakdown).map(([key, value]) => <div className="metric-row" key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><div className="metric-track"><i style={{ width: `${Math.max(0, Math.min(100, (value / ({ capability: 35, verification: 20, endpointLiveness: 15, completion: 10, jobVolume: 5, reputation: 15 } as Record<string, number>)[key]) * 100))}%` }} /></div><b>{Math.round(value)}</b></div>)}</div>
                {best.reasons && <div className="evidence-reasons">{best.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>}
              </div>
              <div className="best-agent-actions"><button type="button" className="dark-button" onClick={() => void hire(best)} disabled={loading || !!mission || !bestReady}>{mission ? "Mission created" : bestReady ? "Hire this agent" : "Provider not ready"}</button><button type="button" className="outline-button" onClick={() => setSelected(best)}>Inspect agent</button></div>
            </article>
          )}
        </div>

        <aside className="alternatives-panel">
          <div className="section-marker"><span>02</span> ALTERNATIVES</div>
          <div className="alternatives-list">
            {discoveryBest && discoveryBest.agent.agent_id !== best?.agent.agent_id && (
              <button type="button" className="alternative-row" onClick={() => setSelected(discoveryBest)}>
                <span className="alternative-index">TOP</span>
                <span className="alternative-info"><strong>{discoveryBest.agent.name || `Agent #${discoveryBest.agent.agent_id}`}</strong><small>{categoryLabel(discoveryBest.agent.category)} · discovery leader · {hireabilityLabel(discoveryBest)}</small></span>
                <strong className={`alternative-score ${scoreColor(discoveryBest.score)}`}>{Math.round(discoveryBest.score)}</strong>
              </button>
            )}
            {candidates.length === 0 && !loading && !discoveryBest && <p className="empty-state">{testnetMode ? "No Testnet Grid provider is currently indexed." : "No additional compatible agents returned yet."}</p>}
            {candidates.map((match) => <button type="button" className="alternative-row" key={match.agent.agent_id} onClick={() => setSelected(match)}><span className="alternative-index">{match.agent.agent_id.slice(-3)}</span><span className="alternative-info"><strong>{match.agent.name || `Agent #${match.agent.agent_id}`}</strong><small>{categoryLabel(match.agent.category)} · {hireabilityLabel(match)}</small></span><strong className={`alternative-score ${scoreColor(match.score)}`}>{Math.round(match.score)}</strong></button>)}
          </div>
        </aside>
      </section>

      <section className="registry-note"><div><span className="small-label">NETWORK BOUNDARY</span><h3>{testnetMode ? "Testnet is a separate marketplace environment." : "Mainnet and Testnet are separate."}</h3><p>{testnetMode ? "This mode excludes indexed Mainnet agents and only accepts first-party providers explicitly tagged for BSC Testnet." : "Production discovery uses the Mainnet marketplace registry. Testnet providers are only exposed through the explicit Testnet workspace."}</p></div><div className="registry-path"><span>CHAIN</span><b>{testnetMode ? "BSC TESTNET" : "BSC MAINNET"}</b><i>→</i><span>REGISTRY</span><b>AgentMarket</b><i>→</i><span>MATCH</span></div></section>

      {selected && <div className="agent-drawer-backdrop" onClick={() => setSelected(null)}><aside className="agent-drawer" onClick={(event) => event.stopPropagation()}><button className="drawer-close" type="button" onClick={() => setSelected(null)} aria-label="Close agent details">×</button><span className="small-label">AGENT PROFILE</span><div className="drawer-score"><b>{Math.round(selected.score)}</b><span>/100 match · {confidenceLabel(selected.scoreConfidence)}</span></div><h2>{selected.agent.name || `Agent #${selected.agent.agent_id}`}</h2><p>{selected.agent.description || "No description was published in the registration file yet."}</p><div className="drawer-facts"><div><span>Readiness</span><b>{hireabilityLabel(selected)}</b></div><div><span>agentId</span><b>{selected.agent.agent_id}</b></div><div><span>Owner</span><b>{compactAddress(selected.agent.owner)}</b></div><div><span>Category</span><b>{categoryLabel(selected.agent.category)}</b></div><div><span>Identity</span><b>{selected.agent.verification_status || "indexed"}</b></div><div><span>Endpoint</span><b>{selected.agent.status || "unknown"}</b></div><div><span>History</span><b>{selected.evidence?.completionAvailable ? "Available" : "Insufficient"}</b></div></div><div className="drawer-breakdown">{Object.entries(selected.breakdown).map(([key, value]) => <div className="metric-row" key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><b>{Math.round(value)}</b></div>)}</div><button className="dark-button" type="button" onClick={() => void hire(selected)} disabled={loading || !!mission || !selected.hireability?.canCreateJob}>{mission ? "Mission created" : selected.hireability?.canCreateJob ? "Hire this agent" : "Provider not ready"}</button></aside></div>}
    </main>
  );
}
