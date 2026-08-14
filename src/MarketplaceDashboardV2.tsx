import { useEffect, useMemo, useState } from "react";

import { parseMarketplaceIntent } from "./lib/intent";
import { supabase } from "./lib/supabase";

type Agent = {
  agent_id: string;
  owner: string | null;
  name: string | null;
  description: string | null;
  category: string;
  status?: "online" | "busy" | "offline" | "pending";
  is_first_party?: boolean;
  reputation_score?: number | null;
  completion_rate?: number | null;
  jobs_completed?: number | null;
  endpoint_status?: string | null;
};

type Match = {
  agent: Agent;
  score: number;
  breakdown: Record<string, number>;
};

type MatchResponse = {
  intent: ReturnType<typeof parseMarketplaceIntent>;
  bestMatch: Match | null;
  alternatives: Match[];
};

type MissionResult = {
  mission: { id: string; status: string };
  task: { id: string; status: string };
  job: { id: string; status: string };
};

const examples = [
  "Manage my BNB portfolio conservatively",
  "Find a safe yield strategy for my idle assets",
  "Monitor my lending health factor and liquidation risk",
  "Run a range-based grid strategy with controlled risk",
];

function categoryLabel(category: string) {
  return ({
    rebalancing: "Rebalancing",
    grid_trading: "Grid Trading",
    yield: "Yield",
    health_factor: "Health Factor",
    other: "General DeFi",
  } as Record<string, string>)[category] || category.replace(/_/g, " ");
}

function scoreColor(score: number) {
  return score >= 85 ? "#35d07f" : score >= 70 ? "#f0b90b" : "#ff8a65";
}

async function browserFallback(goal: string): Promise<MatchResponse> {
  const intent = parseMarketplaceIntent(goal);
  const { data, error } = await supabase.from("marketplace_agents").select("*").limit(20);
  if (error) throw error;

  const matches = ((data || []) as Array<Record<string, unknown>>).map((row) => {
    const agent: Agent = {
      agent_id: String(row.agent_id || ""),
      owner: (row.owner as string | null) || null,
      name: (row.name as string | null) || null,
      description: (row.description as string | null) || null,
      category: intent.category,
      status: row.status as Agent["status"],
      is_first_party: Boolean(row.is_first_party),
      reputation_score: 80,
      completion_rate: 90,
      jobs_completed: 0,
      endpoint_status: row.status === "online" ? "online" : "offline",
    };

    const capability = agent.category === intent.category ? 100 : 25;
    const verification = agent.is_first_party ? 100 : 50;
    const liveness = agent.endpoint_status === "online" ? 100 : 40;
    const score = capability * 0.35 + verification * 0.2 + liveness * 0.15 + 90 * 0.1 + 80 * 0.15 + 0 * 0.05;
    return {
      agent,
      score,
      breakdown: {
        capability,
        verification,
        endpointLiveness: liveness,
        completion: 90,
        jobVolume: 0,
        reputation: 80,
      },
    };
  }).sort((a, b) => b.score - a.score);

  return { intent, bestMatch: matches[0] || null, alternatives: matches.slice(1, 4) };
}

export default function MarketplaceDashboardV2() {
  const [goal, setGoal] = useState(examples[0]);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [mission, setMission] = useState<MissionResult | null>(null);
  const intent = useMemo(() => parseMarketplaceIntent(goal), [goal]);

  async function match() {
    if (!goal.trim()) return;
    setBusy(true);
    setError("");
    setMission(null);

    try {
      const response = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      if (!response.ok) throw new Error("Matching API is unavailable");
      setResult((await response.json()) as MatchResponse);
    } catch {
      try {
        setResult(await browserFallback(goal));
      } catch (fallbackError) {
        setResult(null);
        setError(fallbackError instanceof Error ? fallbackError.message : "Unable to match an agent");
      }
    } finally {
      setBusy(false);
    }
  }

  async function hire() {
    const best = result?.bestMatch;
    if (!best) return;

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          agent_id: best.agent.agent_id,
          budget: 0,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Mission creation failed");
      setMission(data as MissionResult);
    } catch (missionError) {
      setError(missionError instanceof Error ? missionError.message : "Mission creation failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void match();
  }, []);

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.nav}>
          <div>
            <div style={styles.brand}>AgentMarket</div>
            <div style={styles.subbrand}>BNB Agent Studio Marketplace</div>
          </div>
          <div style={styles.protocols}>ERC-8004 · ERC-8183 · x402</div>
        </header>

        <section style={styles.hero}>
          <div style={styles.kicker}>MISSION-FIRST DISCOVERY</div>
          <h1 style={styles.title}>Tell us what you want done.<br />We find the agent.</h1>
          <p style={styles.copy}>One sentence is enough. We interpret your DeFi goal, compare available agents, explain the ranking, then create a mission for the best match.</p>

          <div style={styles.prompt}>
            <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={4} style={styles.textarea} />
            <div style={styles.promptFooter}>
              <div style={styles.intentRow}>
                <span>Detected</span>
                <b>{categoryLabel(intent.category)}</b>
                <b>{intent.risk} risk</b>
              </div>
              <button style={styles.primary} onClick={() => void match()} disabled={busy}>{busy ? "Working…" : "Find my agent"}</button>
            </div>
          </div>

          <div style={styles.examples}>
            {examples.map((example) => (
              <button key={example} style={styles.example} onClick={() => setGoal(example)}>{example}</button>
            ))}
          </div>
        </section>

        {error && <div style={styles.error}>{error}</div>}

        {mission && (
          <section style={styles.missionBanner}>
            <div>
              <div style={styles.kicker}>MISSION CREATED</div>
              <strong>Mission {mission.mission.id.slice(0, 8)}…</strong>
              <div style={styles.missionMeta}>Task: {mission.task.status} · Job: {mission.job.status}</div>
            </div>
            <span style={styles.success}>Ready for agent execution</span>
          </section>
        )}

        <section style={styles.results}>
          <div style={styles.resultHeader}>
            <div>
              <div style={styles.kicker}>MATCH RESULTS</div>
              <h2 style={styles.resultTitle}>Best agent for this mission</h2>
            </div>
            {result && <span style={styles.count}>{(result.alternatives?.length || 0) + (result.bestMatch ? 1 : 0)} candidates</span>}
          </div>

          {busy && !result && <div style={styles.loading}>Comparing capability, verification, liveness, reputation and track record…</div>}

          {!busy && result?.bestMatch && (
            <div style={styles.grid}>
              <article style={styles.card}>
                <div style={styles.cardTop}>
                  <div>
                    <span style={styles.bestBadge}>BEST MATCH</span>
                    <h3 style={styles.agentName}>{result.bestMatch.agent.name || `Agent #${result.bestMatch.agent.agent_id}`}</h3>
                    <p style={styles.description}>{result.bestMatch.agent.description || "On-chain DeFi specialist"}</p>
                  </div>
                  <div style={{ ...styles.score, color: scoreColor(result.bestMatch.score) }}>{Math.round(result.bestMatch.score)}%</div>
                </div>

                <div style={styles.tags}>
                  <span style={styles.tag}>{categoryLabel(result.bestMatch.agent.category)}</span>
                  <span style={styles.tag}>{result.bestMatch.agent.status || "offline"}</span>
                  {result.bestMatch.agent.is_first_party && <span style={styles.tag}>verified</span>}
                </div>

                <div style={styles.breakdown}>
                  {Object.entries(result.bestMatch.breakdown).map(([key, value]) => (
                    <div key={key} style={styles.metric}>
                      <span style={styles.metricName}>{key.replace(/([A-Z])/g, " $1")}</span>
                      <div style={styles.bar}><div style={{ ...styles.fill, width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
                      <span style={styles.metricValue}>{Math.round(value)}</span>
                    </div>
                  ))}
                </div>

                <button style={styles.hire} onClick={() => void hire()} disabled={busy || Boolean(mission)}>
                  {mission ? "Mission created" : busy ? "Creating…" : "Hire this agent"}
                </button>
              </article>

              <aside style={styles.alternatives}>
                <div style={styles.kicker}>ALTERNATIVES</div>
                {(result.alternatives || []).map((item) => (
                  <div key={item.agent.agent_id} style={styles.altRow}>
                    <div><strong>{item.agent.name || `Agent #${item.agent.agent_id}`}</strong><span>{categoryLabel(item.agent.category)}</span></div>
                    <b style={{ color: scoreColor(item.score) }}>{Math.round(item.score)}%</b>
                  </div>
                ))}
              </aside>
            </div>
          )}

          {!busy && !result?.bestMatch && !error && <div style={styles.loading}>No compatible agents found. Try a broader goal.</div>}
        </section>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0a0d0f", color: "#f5f5f0", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" },
  shell: { width: "min(1180px, calc(100% - 32px))", margin: "0 auto", paddingBottom: 64 },
  nav: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 0", borderBottom: "1px solid #202428" },
  brand: { fontSize: 23, fontWeight: 900, letterSpacing: "-0.04em" },
  subbrand: { color: "#858c93", fontSize: 12, marginTop: 3 },
  protocols: { color: "#727a82", fontSize: 12 },
  hero: { padding: "72px 0 50px", textAlign: "center" },
  kicker: { fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", color: "#f0b90b" },
  title: { fontSize: "clamp(44px, 7vw, 80px)", lineHeight: 0.98, letterSpacing: "-0.06em", margin: "16px 0 20px" },
  copy: { maxWidth: 760, margin: "0 auto 34px", color: "#9aa1a7", lineHeight: 1.7 },
  prompt: { textAlign: "left", background: "#121619", border: "1px solid #2b3136", borderRadius: 20, padding: 18 },
  textarea: { width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 120, background: "transparent", border: 0, outline: 0, color: "#fff", font: "inherit", fontSize: 18, lineHeight: 1.5 },
  promptFooter: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", paddingTop: 14, borderTop: "1px solid #242a2e" },
  intentRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", color: "#6f777e", fontSize: 12 },
  primary: { border: 0, borderRadius: 12, padding: "12px 18px", background: "#f0b90b", color: "#111", fontWeight: 900, cursor: "pointer" },
  examples: { marginTop: 16, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" },
  example: { border: "1px solid #262c31", background: "transparent", color: "#7e868d", borderRadius: 999, padding: "7px 10px", fontSize: 11, cursor: "pointer" },
  error: { margin: "0 0 24px", border: "1px solid #63322d", background: "#241514", color: "#ffb4aa", borderRadius: 14, padding: 14 },
  missionBanner: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 28, padding: 18, background: "#101914", border: "1px solid #214f35", borderRadius: 16 },
  missionMeta: { color: "#7d8a82", fontSize: 12, marginTop: 5 },
  success: { color: "#35d07f", fontWeight: 800, fontSize: 12 },
  results: { paddingTop: 10 },
  resultHeader: { display: "flex", justifyContent: "space-between", alignItems: "end", marginBottom: 18 },
  resultTitle: { margin: "6px 0 0", fontSize: 28, letterSpacing: "-0.03em" },
  count: { color: "#737b82", fontSize: 12 },
  loading: { border: "1px solid #242a2e", borderRadius: 16, padding: 24, color: "#8e969d" },
  grid: { display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(260px, .9fr)", gap: 16 },
  card: { background: "#121619", border: "1px solid #2b3136", borderRadius: 18, padding: 22 },
  cardTop: { display: "flex", justifyContent: "space-between", gap: 20 },
  bestBadge: { display: "inline-flex", padding: "5px 8px", borderRadius: 999, background: "#35d07f", color: "#0b120d", fontWeight: 900, fontSize: 10 },
  agentName: { margin: "12px 0 8px", fontSize: 30, letterSpacing: "-0.04em" },
  description: { margin: 0, color: "#959da4", lineHeight: 1.55 },
  score: { fontWeight: 900, fontSize: 38, letterSpacing: "-0.05em" },
  tags: { display: "flex", gap: 8, flexWrap: "wrap", margin: "18px 0" },
  tag: { padding: "6px 9px", borderRadius: 999, background: "#1b2024", border: "1px solid #292f34", color: "#bbc1c6", fontSize: 11 },
  breakdown: { display: "grid", gap: 11, borderTop: "1px solid #252b2f", paddingTop: 18 },
  metric: { display: "grid", gridTemplateColumns: "130px 1fr 34px", gap: 10, alignItems: "center" },
  metricName: { color: "#a3aab0", fontSize: 12, textTransform: "capitalize" },
  bar: { height: 6, background: "#22282c", borderRadius: 999, overflow: "hidden" },
  fill: { height: "100%", background: "#f0b90b", borderRadius: 999 },
  metricValue: { color: "#d9dcdf", fontSize: 12, textAlign: "right" },
  hire: { width: "100%", marginTop: 22, border: 0, borderRadius: 12, padding: "13px 16px", background: "#f0b90b", color: "#111", fontWeight: 900, cursor: "pointer" },
  alternatives: { background: "#0e1214", border: "1px solid #242a2e", borderRadius: 18, padding: 20 },
  altRow: { display: "flex", justifyContent: "space-between", gap: 12, padding: "15px 0", borderBottom: "1px solid #20262a" },
  altRow div: { display: "grid", gap: 4 },
  altRow span: { color: "#747c83", fontSize: 11 },
};
