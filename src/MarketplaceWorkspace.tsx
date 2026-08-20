import { useEffect, useMemo, useState } from "react";
import { parseMarketplaceIntent } from "./lib/intent";
import "./marketplace-workspace.css";

type Agent = { id?: string; agent_id: string; name: string | null; description: string | null; category: string; status?: string | null; source?: string | null; verification_status?: string | null; is_first_party?: boolean; owner?: string | null };
type Match = { agent: Agent; score: number; scoreMax?: number; scoreConfidence?: "high" | "medium" | "low"; breakdown: Record<string, number>; evidence?: { reputationAvailable?: boolean; completionAvailable?: boolean; livenessAvailable?: boolean }; hireability?: { status: "ready" | "degraded" | "discoverable_only"; canCreateJob: boolean; reason: string }; reasons?: string[] };
type MatchResponse = { intent: ReturnType<typeof parseMarketplaceIntent>; bestMatch: Match | null; bestHireableMatch?: Match | null; alternatives: Match[] };
type MissionResponse = { mission: { id: string }; task: { id: string }; job: { id: string; status: string } };
type Quote = {
  quote_id: string;
  price: string;
  currency: string;
  quote_hash: string | null;
  status: string;
  expires_at: string;
  requester_wallet?: string;
  provider_quote?: Record<string, unknown>;
  request_metadata?: Record<string, unknown>;
};
type QuoteResponse = {
  ok: boolean;
  quote: Quote;
  provider?: { agent_id: string; name: string | null; endpoint: string; status: string | null };
  signature_present?: boolean;
};
type PreparedResponse = {
  ok: boolean;
  payment: { symbol: string; decimals: number; budget_raw: string; balance_formatted: string; allowance_formatted: string };
  quote: { quote_id: string; price: string; currency: string; quote_hash: string; expires_at: string; status: string };
  agent: { agent_id: string; name: string | null; provider: string };
  transactions: Record<string, { to?: string; data?: string; data_builder?: string }>;
  job_description: string;
};

const examples = ["Manage my BNB portfolio conservatively", "Find a safe yield strategy for my idle assets", "Monitor my lending health factor and liquidation risk", "Run a controlled grid strategy"];
const labels: Record<string, string> = { rebalancing: "Rebalancing", grid_trading: "Grid Trading", yield: "Yield", health_factor: "Health Factor", other: "General DeFi" };
function categoryLabel(category: string) { return labels[category] || category.replace(/_/g, " "); }
function scoreColor(score: number) { return score >= 85 ? "green" : score >= 70 ? "brass" : "rust"; }
function compactAddress(value?: string | null) { return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—"; }
function confidenceLabel(value?: Match["scoreConfidence"]) { if (value === "high") return "HIGH CONFIDENCE"; if (value === "medium") return "MEDIUM CONFIDENCE"; return "LIMITED HISTORY"; }
function hireabilityLabel(match?: Match | null) { if (!match?.hireability) return "READINESS UNKNOWN"; if (match.hireability.status === "ready") return "READY TO HIRE"; if (match.hireability.status === "degraded") return "PROVIDER DEGRADED"; return "DISCOVERABLE ONLY"; }
function gridTestParameters(category: string) {
  if (category !== "grid_trading") return { category };
  return { category, lower_price: 600, upper_price: 700, grid_levels: 12, notional: 100, max_slippage_bps: 50 };
}

async function readApiResponse(response: Response) {
  const raw = await response.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    const compactRaw = raw.replace(/\s+/g, " ").trim();
    throw new Error(`${response.status} ${response.statusText}: ${compactRaw.slice(0, 240) || "Server returned a non-JSON response."}`);
  }
  return { data: data as Record<string, unknown> | null, raw };
}

export default function MarketplaceWorkspace() {
  const [goal, setGoal] = useState(examples[0]);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [selected, setSelected] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mission, setMission] = useState<MissionResponse | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [prepared, setPrepared] = useState<PreparedResponse | null>(null);
  const [prepareLoading, setPrepareLoading] = useState(false);
  const intent = useMemo(() => parseMarketplaceIntent(goal), [goal]);

  async function findAgent() {
    setLoading(true); setError(""); setMission(null); setQuote(null); setPrepared(null);
    try {
      const response = await fetch("/api/testnet/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal }) });
      const { data } = await readApiResponse(response);
      if (!response.ok) throw new Error(data?.error ? String(data.error) : "Testnet matching API unavailable");
      const next = data as unknown as MatchResponse; setResult(next); setSelected(next.bestHireableMatch || next.bestMatch);
    } catch (cause) { setResult(null); setSelected(null); setError(cause instanceof Error ? cause.message : "Unable to find a Testnet agent"); }
    finally { setLoading(false); }
  }

  async function createMission(match: Match) {
    const authResponse = await fetch("/api/auth/me", { credentials: "include" });
    if (!authResponse.ok) { window.location.href = `/dashboard?return=${encodeURIComponent("/app")}`; return null; }
    const response = await fetch("/api/missions", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal, agent_id: match.agent.agent_id, budget: 0 }) });
    const { data } = await readApiResponse(response);
    if (!response.ok) throw new Error(data?.error ? String(data.error) : "Mission creation failed");
    const created = data as unknown as MissionResponse; setMission(created); return created;
  }

  async function requestQuote(match: Match, createdMission: MissionResponse) {
    if (!match.agent.id) throw new Error("Selected Testnet agent is missing its marketplace database id");
    setQuoteLoading(true); setError(""); setPrepared(null);
    try {
      const response = await fetch("/api/testnet/quotes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, agent_id: match.agent.id, parameters: gridTestParameters(match.agent.category), mission_id: createdMission.mission.id }),
      });
      const { data } = await readApiResponse(response);
      if (!response.ok) throw new Error(data?.error ? String(data.error) : "Provider quote request failed");
      setQuote(data as unknown as QuoteResponse);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Provider quote request failed"); }
    finally { setQuoteLoading(false); }
  }

  async function hire(match: Match | null = selected) {
    if (!match) return;
    if (!match.hireability?.canCreateJob) { setError(match.hireability?.reason || "This Testnet agent is discoverable but is not ready to accept jobs."); return; }
    setLoading(true); setError(""); setQuote(null); setPrepared(null);
    try {
      const created = await createMission(match);
      if (created) await requestQuote(match, created);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Mission creation failed"); }
    finally { setLoading(false); }
  }

  async function acceptQuote() {
    if (!quote?.quote.quote_id) return;
    setQuoteLoading(true); setError("");
    try {
      const response = await fetch("/api/testnet/quotes", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", quote_id: quote.quote.quote_id }) });
      const { data } = await readApiResponse(response);
      if (!response.ok) throw new Error(data?.error ? String(data.error) : "Unable to accept quote");
      setQuote(data as unknown as QuoteResponse);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to accept quote"); }
    finally { setQuoteLoading(false); }
  }

  async function prepareAcceptedQuote() {
    if (!quote?.quote.quote_id || !mission?.mission.id) return;
    setPrepareLoading(true); setError("");
    try {
      const auth = await fetch("/api/auth/me", { credentials: "include" });
      const { data: sessionData } = await readApiResponse(auth);
      const session = sessionData as { authenticated?: boolean; user?: { wallet_address?: string } } | null;
      if (!auth.ok || !session?.user?.wallet_address) throw new Error("Connect and sign in with your Testnet wallet first.");
      const response = await fetch("/api/testnet/prepare-quote", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission_id: mission.mission.id, quote_id: quote.quote.quote_id, client_address: session.user.wallet_address }) });
      const { data } = await readApiResponse(response);
      if (!response.ok) throw new Error(data?.error ? String(data.error) : "Unable to prepare the accepted Testnet quote");
      setPrepared(data as unknown as PreparedResponse);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to prepare the accepted Testnet quote"); }
    finally { setPrepareLoading(false); }
  }

  useEffect(() => { void findAgent(); }, []);
  const candidates = result?.alternatives ?? [];
  const best = selected || result?.bestHireableMatch || result?.bestMatch;
  const bestReady = Boolean(best?.hireability?.canCreateJob);

  return (
    <main className="workspace">
      <div className="workspace-orbit workspace-orbit-a" aria-hidden="true" /><div className="workspace-orbit workspace-orbit-b" aria-hidden="true" />
      <header className="workspace-nav"><a href="/" className="workspace-brand"><span className="workspace-glyph" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none"><rect x="1.5" y="1.5" width="25" height="25" rx="7" stroke="currentColor" strokeWidth="1.5" /><path d="M7 18L11.4 10.2L15.2 15L20.8 7.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span>AgentMarket</span></a><div className="workspace-breadcrumb">TESTNET / BSC 97 · DISCOVER / QUOTE</div><div className="workspace-nav-links"><a href="/dashboard">Dashboard</a><a href="/">Exit →</a></div></header>
      <section className="workspace-hero"><div><div className="workspace-kicker"><span /> BSC TESTNET · DEVELOPMENT MARKETPLACE</div><h1>Find the agent.<br /><em>Not the profile.</em></h1><p>Describe the outcome. This build only matches ERC-8004 agents registered on BSC Testnet and only hires providers with a healthy Testnet endpoint.</p></div><div className="workspace-stat-block"><div><span>Network</span><strong>BSC Testnet</strong></div><div><span>Chain</span><strong>97</strong></div><div><span>Commerce</span><strong>ERC-8183</strong></div></div></section>
      <section className="mission-composer"><div className="composer-copy"><span className="small-label">YOUR TESTNET MISSION</span><div className="composer-intent"><span>{categoryLabel(intent.category)}</span><span>{intent.risk} risk</span></div></div><textarea value={goal} onChange={(event) => setGoal(event.target.value)} aria-label="Mission goal" /><div className="composer-footer"><div className="composer-examples">{examples.map((example) => <button key={example} type="button" onClick={() => setGoal(example)}>{example}</button>)}</div><button type="button" className="brass-button" onClick={() => void findAgent()} disabled={loading}>{loading ? "Matching…" : "Find Testnet agent →"}</button></div></section>
      {error && <div className="workspace-alert workspace-alert-error">{error}</div>}
      {mission && <div className="workspace-alert workspace-alert-success"><div><strong>Testnet mission created.</strong> Marketplace job {mission.job.id.slice(0, 8)}… is open for quote negotiation.</div><span>Mission {mission.mission.id.slice(0, 8)}…</span></div>}
      <section className="results-layout"><div className="results-main"><div className="section-marker"><span>01</span> TESTNET MATCH RESULT</div>{loading && <div className="workspace-loading">Comparing Testnet capability, verification, liveness, history and reputation…</div>}{!loading && best && <article className="best-agent-card"><div className="best-agent-top"><div><div className="verified-line"><span className="status-dot" /> {hireabilityLabel(best)}</div><h2>{best.agent.name || `Agent #${best.agent.agent_id}`}</h2><p>{best.agent.description || "BSC Testnet DeFi specialist discovered through the ERC-8004 Testnet registry."}</p></div><div className={`score-chip ${scoreColor(best.score)}`}><b>{Math.round(best.score)}</b><span>/100</span></div></div><div className="agent-meta-row"><span>{categoryLabel(best.agent.category)}</span><span>{best.agent.status || "unknown endpoint"}</span><span>{best.agent.source || "testnet indexed"}</span>{best.agent.is_first_party && <span>first-party</span>}</div>{!bestReady && best.hireability && <div className="workspace-alert workspace-alert-error" style={{ marginTop: 16, marginBottom: 0 }}>{best.hireability.reason}</div>}<div className="why-block"><div className="why-head"><span>WHY THIS TESTNET AGENT</span><strong>{confidenceLabel(best.scoreConfidence)}</strong></div><div className="why-summary"><span>Normalized match</span><b>{Math.round(best.score)}/100</b><span>Available evidence ceiling</span><b>{Math.round(best.scoreMax ?? 100)}/100</b></div><div className="metric-list">{Object.entries(best.breakdown).map(([key, value]) => <div className="metric-row" key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><div className="metric-track"><i style={{ width: `${Math.max(0, Math.min(100, (value / ({ capability: 35, verification: 20, endpointLiveness: 15, completion: 10, jobVolume: 5, reputation: 15 } as Record<string, number>)[key]) * 100))}%` }} /></div><b>{Math.round(value)}</b></div>)}</div>{best.reasons && <div className="evidence-reasons">{best.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>}</div><div className="best-agent-actions"><button type="button" className="dark-button" onClick={() => void hire(best)} disabled={loading || !!mission || !bestReady}>{mission ? "Quote in progress" : bestReady ? "Request provider quote" : "Provider not ready"}</button><button type="button" className="outline-button" onClick={() => setSelected(best)}>Inspect agent</button></div></article>}</div><aside className="alternatives-panel"><div className="section-marker"><span>02</span> TESTNET ALTERNATIVES</div><div className="alternatives-list">{candidates.length === 0 && !loading && <p className="empty-state">No additional compatible Testnet agents returned yet.</p>}{candidates.map((match) => <button type="button" className="alternative-row" key={match.agent.agent_id} onClick={() => setSelected(match)}><span className="alternative-index">{match.agent.agent_id.slice(-3)}</span><span className="alternative-info"><strong>{match.agent.name || `Agent #${match.agent.agent.agent_id}`}</strong><small>{categoryLabel(match.agent.category)} · {hireabilityLabel(match)}</small></span><strong className={`alternative-score ${scoreColor(match.score)}`}>{Math.round(match.score)}</strong></button>)}</div></aside></section>

      {quote && (
        <section className="best-agent-card" style={{ marginTop: 18 }}>
          <div className="best-agent-top">
            <div>
              <div className="verified-line"><span className="status-dot" /> PROVIDER QUOTE · BSC TESTNET</div>
              <h2>Quoted terms</h2>
              <p>The provider returned a Testnet quote before any ERC-8183 funding transaction. Only the accepted quote can be used to prepare the on-chain job.</p>
            </div>
            <div className="score-chip brass"><b>{quote.quote.price}</b><span>{quote.quote.currency}</span></div>
          </div>
        </section>
      )}
    </main>
  );
}
