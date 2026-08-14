import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

import { parseMarketplaceIntent } from "./lib/intent";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const fallbackUrl = "https://sfbxpscbevnmoppgkjcr.supabase.co";
const fallbackKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmYnhwc2NiZXZub3Bna3JjciIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzg2MTE0Nzk0LCJleHAiOjIxMDE2OTA3OTR9.ttfR2pNVqlOYrorGdAs7aaGgufxwXIsG-GXvLDd-jZw";

const supabase = createClient(SUPABASE_URL || fallbackUrl, SUPABASE_ANON_KEY || fallbackKey);

type Agent = {
  id?: string;
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
  breakdown: {
    capability: number;
    verification: number;
    endpointLiveness: number;
    completion: number;
    jobVolume: number;
    reputation: number;
  };
};

type MatchResponse = {
  intent: ReturnType<typeof parseMarketplaceIntent>;
  bestMatch: Match | null;
  alternatives: Match[];
};

const demoGoals = [
  "Manage my BNB portfolio conservatively",
  "Find a safe yield strategy for my idle assets",
  "Monitor my lending health factor and liquidation risk",
  "Run a range-based grid strategy with controlled risk",
];

function label(category: string) {
  const values: Record<string, string> = {
    rebalancing: "Rebalancing",
    grid_trading: "Grid Trading",
    yield: "Yield",
    health_factor: "Health Factor",
    other: "General DeFi",
  };
  return values[category] || category.replace(/_/g, " ");
}

function statusLabel(status?: Agent["status"]) {
  if (status === "online") return "Online";
  if (status === "busy") return "Busy";
  if (status === "pending") return "Pending";
  return "Offline";
}

function scoreColor(score: number) {
  if (score >= 85) return "#35d07f";
  if (score >= 70) return "#f0b90b";
  return "#ff8a65";
}

function formatScore(score: number) {
  return `${Math.round(score)}%`;
}

function agentFallbackScore(agent: Agent, intent: ReturnType<typeof parseMarketplaceIntent>): Match {
  const capability = agent.category === intent.category ? 100 : intent.category === "other" ? 60 : 25;
  const verification = agent.is_first_party ? 100 : 50;
  const endpointLiveness = agent.endpoint_status === "online" ? 100 : 40;
  const completion = Math.max(0, Math.min(100, Number(agent.completion_rate ?? 0)));
  const jobVolume = Math.max(0, Math.min(100, (Number(agent.jobs_completed ?? 0) / 100) * 100));
  const reputation = Math.max(0, Math.min(100, Number(agent.reputation_score ?? 0)));
  const score = capability * 0.35 + verification * 0.2 + endpointLiveness * 0.15 + completion * 0.1 + jobVolume * 0.05 + reputation * 0.15;

  return {
    agent,
    score,
    breakdown: { capability, verification, endpointLiveness, completion, jobVolume, reputation },
  };
}

async function loadFallbackMatches(goal: string): Promise<MatchResponse> {
  const intent = parseMarketplaceIntent(goal);
  let query = supabase.from("marketplace_agents").select("*").limit(50);
  if (intent.category !== "other") query = query.contains("capabilities", [intent.category]);

  const { data, error } = await query;
  if (error) throw error;

  const agents = (data || []).map((row) => ({
    id: row.id,
    agent_id: row.agent_id,
    owner: row.owner,
    name: row.name,
    description: row.description,
    category: intent.category === "other" ? "other" : intent.category,
    status: row.status,
    is_first_party: row.is_first_party,
    reputation_score: 80,
    completion_rate: 90,
    jobs_completed: 0,
    endpoint_status: row.status === "online" ? "online" : "offline",
  })) as Agent[];

  const matches = agents.map((agent) => agentFallbackScore(agent, intent)).sort((a, b) => b.score - a.score).slice(0, 8);
  return { intent, bestMatch: matches[0] || null, alternatives: matches.slice(1) };
}

export default function MarketplaceDashboard() {
  const [goal, setGoal] = useState(demoGoals[0]);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missionState, setMissionState] = useState<Record<string, "idle" | "saving" | "saved">>({});

  const intentPreview = useMemo(() => parseMarketplaceIntent(goal), [goal]);

  async function findAgent() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });

      if (!response.ok) throw new Error("Matching API unavailable");
      const data = (await response.json()) as MatchResponse;
      setResult(data);
    } catch {
      try {
        setResult(await loadFallbackMatches(goal));
      } catch (fallbackError) {
        setError(fallbackError instanceof Error ? fallbackError.message : "Unable to find agents");
        setResult(null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function createMission(match: Match) {
    const key = match.agent.agent_id;
    setMissionState((current) => ({ ...current, [key]: "saving" }));

    try {
      const { data: marketplaceAgent, error: agentError } = await supabase
        .from("marketplace_agents")
        .select("id, name, role")
        .eq("agent_id", match.agent.agent_id)
        .maybeSingle();
      if (agentError) throw agentError;
      if (!marketplaceAgent) throw new Error("This agent is not yet available for missions.");

      const { data: mission, error: missionError } = await supabase
        .from("missions")
        .insert({
          title: `${match.agent.name || "Agent"} mission`,
          goal,
          category: result?.intent.category || intentPreview.category,
          budget: 0,
          status: "planning",
        })
        .select("id")
        .single();
      if (missionError) throw missionError;

      const { error: taskError } = await supabase.from("mission_tasks").insert({
        mission_id: mission.id,
        agent_id: marketplaceAgent.id,
        title: match.agent.name || marketplaceAgent.name,
        role: marketplaceAgent.role || "DeFi specialist",
        description: goal,
        budget: 0,
        status: "assigned",
      });
      if (taskError) throw taskError;

      setMissionState((current) => ({ ...current, [key]: "saved" }));
    } catch (missionError) {
      setMissionState((current) => ({ ...current, [key]: "idle" }));
      setError(missionError instanceof Error ? missionError.message : "Unable to create mission");
    }
  }

  useEffect(() => {
    void findAgent();
    // Intentionally run once for the initial demo mission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <nav style={styles.nav}>
          <div>
            <div style={styles.brand}>AgentMarket</div>
            <div style={styles.brandSub}>BNB Agent Studio Marketplace</div>
          </div>
          <div style={styles.navStatus}>BNB Smart Chain · ERC-8004 · ERC-8183</div>
        </nav>

        <section style={styles.hero}>
          <div style={styles.eyebrow}>MISSION-FIRST DISCOVERY</div>
          <h1 style={styles.heroTitle}>Tell us what you want done.<br />We find the agent.</h1>
          <p style={styles.heroCopy}>
            Describe a DeFi goal in one sentence. The marketplace interprets the intent, ranks compatible agents by transparent reliability signals, and gives you a clear reason for the recommendation.
          </p>

          <div style={styles.promptCard}>
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void findAgent();
              }}
              rows={3}
              placeholder="e.g. Help manage my BNB portfolio conservatively"
              style={styles.textarea}
            />
            <div style={styles.promptFooter}>
              <div style={styles.intentPreview}>
                <span style={styles.intentLabel}>Detected</span>
                <span style={styles.pill}>{label(intentPreview.category)}</span>
                <span style={styles.pill}>{intentPreview.risk} risk</span>
              </div>
              <button onClick={() => void findAgent()} style={styles.primaryButton} disabled={loading || !goal.trim()}>
                {loading ? "Finding…" : "Find my agent"}
              </button>
            </div>
          </div>

          <div style={styles.examples}>
            {demoGoals.map((example) => (
              <button key={example} onClick={() => setGoal(example)} style={styles.exampleButton}>
                {example}
              </button>
            ))}
          </div>
        </section>

        {error && <div style={styles.error}>{error}</div>}

        <section style={styles.resultsSection}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.eyebrow}>MATCH RESULTS</div>
              <h2 style={styles.sectionTitle}>Best agent for this mission</h2>
            </div>
            {result && <span style={styles.resultMeta}>{result.alternatives.length + (result.bestMatch ? 1 : 0)} candidates</span>}
          </div>

          {loading && <div style={styles.loading}>Comparing capability, verification, liveness, reputation, and track record…</div>}

          {!loading && result?.bestMatch && (
            <div style={styles.bestGrid}>
              <article style={styles.bestCard}>
                <div style={styles.bestTop}>
                  <div>
                    <span style={styles.topBadge}>BEST MATCH</span>
                    <h3 style={styles.agentName}>{result.bestMatch.agent.name || `Agent #${result.bestMatch.agent.agent_id}`}</h3>
                    <p style={styles.agentDescription}>{result.bestMatch.agent.description || "On-chain DeFi specialist"}</p>
                  </div>
                  <div style={{ ...styles.score, color: scoreColor(result.bestMatch.score) }}>{formatScore(result.bestMatch.score)}</div>
                </div>

                <div style={styles.agentTags}>
                  <span style={styles.pill}>{label(result.bestMatch.agent.category)}</span>
                  <span style={styles.pill}>{statusLabel(result.bestMatch.agent.status)}</span>
                  {result.bestMatch.agent.is_first_party && <span style={styles.pill}>Verified</span>}
                </div>

                <div style={styles.reasons}>
                  <div style={styles.subheading}>Why this one</div>
                  <div style={styles.reasonGrid}>
                    {Object.entries(result.bestMatch.breakdown).map(([key, value]) => (
                      <div key={key} style={styles.metric}>
                        <div style={styles.metricLabel}>{key.replace(/([A-Z])/g, " $1")}</div>
                        <div style={styles.metricBar}><div style={{ ...styles.metricFill, width: `${value}%` }} /></div>
                        <div style={styles.metricValue}>{Math.round(value)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  style={styles.hireButton}
                  onClick={() => void createMission(result.bestMatch!)}
                  disabled={missionState[result.bestMatch.agent.agent_id] === "saving" || missionState[result.bestMatch.agent.agent_id] === "saved"}
                >
                  {missionState[result.bestMatch.agent.agent_id] === "saving" ? "Creating mission…" : missionState[result.bestMatch.agent.agent_id] === "saved" ? "Mission created" : "Hire this agent"}
                </button>
              </article>

              <aside style={styles.alternativesCard}>
                <div style={styles.subheading}>Strong alternatives</div>
                <div style={styles.alternativeList}>
                  {result.alternatives.slice(0, 3).map((match) => (
                    <div key={match.agent.agent_id} style={styles.alternativeRow}>
                      <div style={styles.altInfo}>
                        <strong>{match.agent.name || `Agent #${match.agent.agent_id}`}</strong>
                        <span>{label(match.agent.category)}</span>
                      </div>
                      <span style={{ ...styles.altScore, color: scoreColor(match.score) }}>{formatScore(match.score)}</span>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          )}

          {!loading && !result?.bestMatch && !error && (
            <div style={styles.empty}>No compatible agents were found yet. Try a broader goal.</div>
          )}
        </section>

        <footer style={styles.footer}>
          <span>Identity: ERC-8004</span>
          <span>Jobs & escrow: ERC-8183</span>
          <span>Payment rail: x402</span>
          <span>Data: Supabase</span>
          <span>Runtime: Vercel</span>
        </footer>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0b0d0f", color: "#f4f4f0", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" },
  shell: { width: "min(1180px, calc(100% - 32px))", margin: "0 auto", paddingBottom: 48 },
  nav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 0", borderBottom: "1px solid #202428" },
  brand: { fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em" },
  brandSub: { color: "#8d9298", fontSize: 12, marginTop: 3 },
  navStatus: { color: "#858b91", fontSize: 12 },
  hero: { padding: "72px 0 54px", textAlign: "center" },
  eyebrow: { color: "#f0b90b", fontSize: 11, fontWeight: 800, letterSpacing: "0.16em" },
  heroTitle: { fontSize: "clamp(42px, 7vw, 78px)", lineHeight: 0.98, letterSpacing: "-0.06em", margin: "16px 0 20px" },
  heroCopy: { color: "#9ea4aa", maxWidth: 760, margin: "0 auto 32px", lineHeight: 1.7, fontSize: 16 },
  promptCard: { background: "#121518", border: "1px solid #292e33", borderRadius: 20, padding: 18, textAlign: "left", boxShadow: "0 24px 70px rgba(0,0,0,.28)" },
  textarea: { width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 112, background: "transparent", border: 0, outline: 0, color: "#f4f4f0", font: "inherit", fontSize: 18, lineHeight: 1.5 },
  promptFooter: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderTop: "1px solid #24292d", paddingTop: 16, flexWrap: "wrap" },
  intentPreview: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  intentLabel: { fontSize: 12, color: "#757b81" },
  pill: { display: "inline-flex", alignItems: "center", padding: "6px 9px", borderRadius: 999, background: "#1b2024", border: "1px solid #2a3035", color: "#c7ccd1", fontSize: 12 },
  primaryButton: { border: 0, borderRadius: 12, padding: "12px 18px", background: "#f0b90b", color: "#111", fontWeight: 800, cursor: "pointer" },
  examples: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 18 },
  exampleButton: { background: "transparent", border: "1px solid #252a2f", color: "#7f858b", borderRadius: 999, padding: "7px 10px", cursor: "pointer", fontSize: 11 },
  error: { background: "#251615", border: "1px solid #5b302b", color: "#ffb0a6", borderRadius: 12, padding: 14, marginBottom: 28 },
  resultsSection: { padding: "18px 0 60px" },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, marginBottom: 20 },
  sectionTitle: { margin: "7px 0 0", fontSize: 28, letterSpacing: "-0.03em" },
  resultMeta: { color: "#737a81", fontSize: 12 },
  loading: { padding: 28, border: "1px solid #24292d", borderRadius: 16, color: "#8f959a" },
  bestGrid: { display: "grid", gridTemplateColumns: "minmax(0, 1.7fr) minmax(260px, .9fr)", gap: 16 },
  bestCard: { background: "#121518", border: "1px solid #2c3338", borderRadius: 18, padding: 22 },
  bestTop: { display: "flex", justifyContent: "space-between", gap: 20 },
  topBadge: { display: "inline-block", color: "#111", background: "#35d07f", borderRadius: 999, padding: "5px 8px", fontSize: 10, fontWeight: 900 },
  agentName: { fontSize: 30, margin: "12px 0 8px", letterSpacing: "-0.04em" },
  agentDescription: { color: "#989fa5", lineHeight: 1.55, margin: 0, maxWidth: 620 },
  score: { fontSize: 38, fontWeight: 900, letterSpacing: "-0.05em", whiteSpace: "nowrap" },
  agentTags: { display: "flex", gap: 8, flexWrap: "wrap", margin: "20px 0" },
  reasons: { borderTop: "1px solid #262c30", paddingTop: 20 },
  subheading: { fontSize: 12, color: "#727980", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em" },
  reasonGrid: { display: "grid", gap: 12, marginTop: 14 },
  metric: { display: "grid", gridTemplateColumns: "130px 1fr 42px", gap: 10, alignItems: "center" },
  metricLabel: { color: "#a8adb2", fontSize: 12, textTransform: "capitalize" },
  metricBar: { height: 6, borderRadius: 999, background: "#22272b", overflow: "hidden" },
  metricFill: { height: "100%", background: "#f0b90b", borderRadius: 999 },
  metricValue: { color: "#d4d8dc", fontSize: 12, textAlign: "right" },
  hireButton: { width: "100%", marginTop: 22, border: 0, borderRadius: 12, padding: "13px 16px", background: "#f0b90b", color: "#111", fontWeight: 900, cursor: "pointer" },
  alternativesCard: { background: "#0f1214", border: "1px solid #242a2e", borderRadius: 18, padding: 20 },
  alternativeList: { marginTop: 14 },
  alternativeRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 0", borderBottom: "1px solid #20262a" },
  altInfo: { display: "grid", gap: 4 },
  altInfoStrong: { color: "#fff" },
  altInfoSpan: { color: "#727980", fontSize: 12 },
  altScore: { fontWeight: 800 },
  empty: { padding: 28, border: "1px dashed #343a3f", borderRadius: 16, color: "#858b91" },
  footer: { borderTop: "1px solid #202428", paddingTop: 18, display: "flex", gap: 16, flexWrap: "wrap", color: "#656b71", fontSize: 11 },
};
