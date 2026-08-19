import { useState } from "react";
import "./mission-console.css";

type Match = {
  agent?: {
    id?: string;
    agent_id: string;
    name: string | null;
    category: string;
    description?: string | null;
  };
  score?: number;
  hireability?: { canCreateJob?: boolean; reason?: string };
};

type MissionResponse = {
  mission: { id: string };
  task: { id: string };
  job: { id: string; status: string };
};

type QuoteResponse = {
  ok: boolean;
  quote: {
    quote_id: string;
    price: string;
    currency: string;
    quote_hash: string | null;
    status: string;
    expires_at: string;
  };
  provider?: { agent_id: string; name: string | null; endpoint: string; status: string | null };
  signature_present?: boolean;
};

const GOAL = "Run a controlled grid strategy";
const PARAMETERS = {
  category: "grid_trading",
  lower_price: 600,
  upper_price: 700,
  grid_levels: 12,
  notional: 100,
  max_slippage_bps: 50,
};

export default function TestnetGridRun() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mission, setMission] = useState<MissionResponse | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [accepted, setAccepted] = useState(false);

  async function start() {
    setLoading(true);
    setError("");
    setMission(null);
    setQuote(null);
    setAccepted(false);
    try {
      const auth = await fetch("/api/auth/me", { credentials: "include" });
      if (!auth.ok) {
        window.location.href = `/dashboard?return=${encodeURIComponent("/testnet/run")}`;
        return;
      }

      const matchResponse = await fetch("/api/testnet/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ goal: GOAL }),
      });
      const matchBody = await matchResponse.json();
      if (!matchResponse.ok) throw new Error(matchBody?.error || "Testnet matching failed");
      const match = (matchBody.bestHireableMatch || matchBody.bestMatch) as Match | null;
      if (!match?.agent?.agent_id) throw new Error("No Testnet Grid Agent is currently discoverable.");
      if (match.hireability && !match.hireability.canCreateJob) {
        throw new Error(match.hireability.reason || "The Grid Agent is not ready to accept Testnet jobs.");
      }
      if (!match.agent.id) throw new Error("The selected Grid Agent is missing its marketplace ID.");

      const missionResponse = await fetch("/api/missions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: GOAL, agent_id: match.agent.id, budget: 0 }),
      });
      const missionBody = await missionResponse.json();
      if (!missionResponse.ok) throw new Error(missionBody?.error || "Unable to create the Testnet mission");
      const created = missionBody as MissionResponse;
      setMission(created);

      const quoteResponse = await fetch("/api/testnet/quotes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: GOAL,
          agent_id: match.agent.id,
          parameters: PARAMETERS,
          mission_id: created.mission.id,
        }),
      });
      const quoteBody = await quoteResponse.json();
      if (!quoteResponse.ok) throw new Error(quoteBody?.error || "Provider quote negotiation failed");
      setQuote(quoteBody as QuoteResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start the Testnet Grid run");
    } finally {
      setLoading(false);
    }
  }

  async function accept() {
    if (!quote?.quote.quote_id) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/testnet/quotes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", quote_id: quote.quote.quote_id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Unable to accept the Testnet quote");
      setQuote(body as QuoteResponse);
      setAccepted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to accept quote");
    } finally {
      setLoading(false);
    }
  }

  const nextPath = mission && quote
    ? `/testnet/preflight?mission=${encodeURIComponent(mission.mission.id)}&quote=${encodeURIComponent(quote.quote.quote_id)}&job=${encodeURIComponent(mission.job.id)}`
    : "";

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a href="/" className="console-brand">AgentMarket</a>
          <span>TESTNET / GUIDED GRID RUN</span>
          <a href="/testnet">Sandbox →</a>
        </header>

        {error && <div className="console-alert console-alert-error">{error}</div>}

        <section className="console-hero">
          <div>
            <span className="console-kicker">BSC TESTNET / GRID AGENT</span>
            <h1>Start the first live Testnet run.</h1>
            <p>This creates a small, controlled Grid mission, negotiates the provider quote, and stops before any wallet transaction. Funding remains your explicit next step.</p>
          </div>
          <div className="console-state"><small>NETWORK</small><strong>BSC Testnet / 97</strong><span>No Mainnet contracts or balances are used by this flow.</span></div>
        </section>

        <section className="console-grid">
          <div className="console-card">
            <div className="console-section-head"><span>FIXED TEST PARAMETERS</span><b>SAFE TEST</b></div>
            {Object.entries(PARAMETERS).map(([key, value]) => (
              <div className="console-stat" key={key}><span>{key.replace(/_/g, " ")}</span><strong>{String(value)}</strong></div>
            ))}
          </div>
          <div className="console-card">
            <div className="console-section-head"><span>RUN STATUS</span><b>{accepted ? "QUOTE ACCEPTED" : quote ? "QUOTE READY" : mission ? "NEGOTIATING" : "NOT STARTED"}</b></div>
            <div className="console-stat"><span>Goal</span><strong>{GOAL}</strong></div>
            {mission && <div className="console-stat"><span>Mission</span><strong>{mission.mission.id.slice(0, 12)}…</strong></div>}
            {mission && <div className="console-stat"><span>Marketplace job</span><strong>{mission.job.id.slice(0, 12)}…</strong></div>}
            {quote && <div className="console-stat"><span>Provider quote</span><strong>{quote.quote.price} {quote.quote.currency}</strong></div>}
            {quote && <div className="console-stat"><span>Expires</span><strong>{new Date(quote.quote.expires_at).toLocaleString()}</strong></div>}
          </div>
        </section>

        <section className="console-card console-plan-card">
          <div className="console-section-head"><span>CONTROLLED START</span><b>{accepted ? "NEXT: PREFLIGHT" : "NO TRANSACTION YET"}</b></div>
          <p className="console-evidence">Step 1 finds the verified Testnet Grid Agent. Step 2 creates the marketplace mission. Step 3 negotiates the provider quote. Step 4 lets you explicitly accept the quote. Only then can you continue to Testnet transaction preflight.</p>
          {!mission && <button className="console-brass-button" type="button" onClick={() => void start()} disabled={loading}>{loading ? "Finding agent & negotiating…" : "Create Testnet Grid mission →"}</button>}
          {quote && !accepted && <button className="console-brass-button" type="button" onClick={() => void accept()} disabled={loading}>{loading ? "Accepting…" : `Accept ${quote.quote.price} ${quote.quote.currency} quote →`}</button>}
          {accepted && nextPath && <a className="console-brass-button" href={nextPath} style={{ textDecoration: "none", display: "inline-flex" }}>Run Testnet transaction preflight →</a>}
        </section>
      </div>
    </main>
  );
}
