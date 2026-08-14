import { useEffect, useMemo, useState } from "react";
import { parseMarketplaceIntent } from "./lib/intent";

type Agent = { agent_id: string; name: string | null; description: string | null; category: string; status?: string; is_first_party?: boolean };
type Match = { agent: Agent; score: number; breakdown: Record<string, number> };
type MatchResponse = { intent: ReturnType<typeof parseMarketplaceIntent>; bestMatch: Match | null; alternatives: Match[] };

type MissionResponse = { mission: { id: string }; task: { id: string }; job: { id: string; status: string } };

const examples = [
  "Manage my BNB portfolio conservatively",
  "Find a safe yield strategy for my idle assets",
  "Monitor my lending health factor and liquidation risk",
  "Run a controlled grid strategy",
];
const labels: Record<string, string> = { rebalancing: "Rebalancing", grid_trading: "Grid Trading", yield: "Yield", health_factor: "Health Factor", other: "General DeFi" };

function categoryLabel(c: string) { return labels[c] || c.replace(/_/g, " "); }
function scoreColor(n: number) { return n >= 85 ? "#35d07f" : n >= 70 ? "#f0b90b" : "#ff8a65"; }

export default function MarketplaceDashboardV4() {
  const [goal, setGoal] = useState(examples[0]);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missionId, setMissionId] = useState("");
  const [jobId, setJobId] = useState("");
  const intent = useMemo(() => parseMarketplaceIntent(goal), [goal]);

  async function findAgent() {
    setLoading(true); setError(""); setMissionId(""); setJobId("");
    try {
      const r = await fetch("/api/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Matching API unavailable");
      setResult(data as MatchResponse);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Unable to find an agent");
    } finally { setLoading(false); }
  }

  async function hire() {
    if (!result?.bestMatch) return;
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal, agent_id: result.bestMatch.agent.agent_id, budget: 0 }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Mission creation failed");
      const mission = data as MissionResponse;
      setMissionId(mission.mission.id);
      setJobId(mission.job.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Mission creation failed"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void findAgent(); }, []);

  return (
    <main style={ui.page}>
      <div style={ui.shell}>
        <header style={ui.header}>
          <div><div style={ui.brand}>AgentMarket</div><div style={ui.muted}>BNB Agent Studio Marketplace</div></div>
          <div style={ui.muted}>ERC-8004 · ERC-8183 · x402</div>
        </header>

        <section style={ui.hero}>
          <div style={ui.kicker}>MISSION-FIRST DISCOVERY</div>
          <h1 style={ui.h1}>Tell us what you want done.<br />We find the agent.</h1>
          <p style={ui.copy}>Describe a DeFi goal in plain language. The marketplace interprets it, ranks agents using transparent reliability signals, and creates a mission for the best match.</p>
          <div style={ui.prompt}>
            <textarea value={goal} onChange={e => setGoal(e.target.value)} rows={4} style={ui.textarea} />
            <div style={ui.promptFooter}>
              <div style={ui.intent}><span>Detected:</span><b>{categoryLabel(intent.category)}</b><b>{intent.risk} risk</b></div>
              <button style={ui.primary} onClick={() => void findAgent()} disabled={loading}>{loading ? "Working…" : "Find my agent"}</button>
            </div>
          </div>
          <div style={ui.examples}>{examples.map(x => <button key={x} style={ui.example} onClick={() => setGoal(x)}>{x}</button>)}</div>
        </section>

        {error && <div style={ui.error}>{error}</div>}
        {missionId && <div style={ui.success}><b>Mission created:</b> {missionId.slice(0, 8)}… · job is open. <a style={ui.consoleLink} href={`/?job=${encodeURIComponent(jobId)}`}>Open mission console →</a></div>}

        <section>
          <div style={ui.resultHeader}><div><div style={ui.kicker}>MATCH RESULTS</div><h2 style={ui.h2}>Best agent for this mission</h2></div></div>
          {loading && <div style={ui.loading}>Finding the most reliable compatible agent…</div>}
          {!loading && result?.bestMatch && <div style={ui.grid}>
            <article style={ui.card}>
              <div style={ui.cardTop}><div><span style={ui.badge}>BEST MATCH</span><h3 style={ui.h3}>{result.bestMatch.agent.name || `Agent #${result.bestMatch.agent.agent_id}`}</h3><p style={ui.desc}>{result.bestMatch.agent.description || "On-chain DeFi specialist"}</p></div><strong style={{ ...ui.score, color: scoreColor(result.bestMatch.score) }}>{Math.round(result.bestMatch.score)}%</strong></div>
              <div style={ui.tags}><span style={ui.tag}>{categoryLabel(result.bestMatch.agent.category)}</span><span style={ui.tag}>{result.bestMatch.agent.status || "offline"}</span>{result.bestMatch.agent.is_first_party && <span style={ui.tag}>verified</span>}</div>
              <div style={ui.breakdown}>{Object.entries(result.bestMatch.breakdown).map(([k,v]) => <div key={k} style={ui.metric}><span style={ui.metricName}>{k.replace(/([A-Z])/g, " $1")}</span><div style={ui.bar}><div style={{ ...ui.fill, width: `${Math.max(0, Math.min(100, v))}%` }} /></div><span>{Math.round(v)}</span></div>)}</div>
              <button style={ui.hire} onClick={() => void hire()} disabled={loading || !!missionId}>{missionId ? "Mission created" : "Hire this agent"}</button>
            </article>
            <aside style={ui.card}><div style={ui.kicker}>ALTERNATIVES</div>{result.alternatives.map(m => <div key={m.agent.agent_id} style={ui.altRow}><div><strong>{m.agent.name || `Agent #${m.agent.agent_id}`}</strong><div style={ui.muted}>{categoryLabel(m.agent.category)}</div></div><b style={{ color: scoreColor(m.score) }}>{Math.round(m.score)}%</b></div>)}</aside>
          </div>}
        </section>
      </div>
    </main>
  );
}

const ui: Record<string, React.CSSProperties> = {
  page:{minHeight:"100vh",background:"#0a0d0f",color:"#f5f5f0",fontFamily:"Inter,system-ui,sans-serif"},shell:{width:"min(1180px,calc(100% - 32px))",margin:"0 auto",paddingBottom:64},header:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"24px 0",borderBottom:"1px solid #202428"},brand:{fontSize:23,fontWeight:900},muted:{color:"#7f878f",fontSize:12},hero:{padding:"72px 0 48px",textAlign:"center"},kicker:{fontSize:11,fontWeight:900,letterSpacing:".16em",color:"#f0b90b"},h1:{fontSize:"clamp(44px,7vw,80px)",lineHeight:.98,letterSpacing:"-.06em",margin:"16px 0 20px"},copy:{maxWidth:760,margin:"0 auto 34px",color:"#9ba3a9",lineHeight:1.7},prompt:{textAlign:"left",background:"#121619",border:"1px solid #2b3136",borderRadius:20,padding:18},textarea:{width:"100%",boxSizing:"border-box",background:"transparent",border:0,outline:0,color:"#fff",font:"inherit",fontSize:18,resize:"vertical"},promptFooter:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,flexWrap:"wrap",paddingTop:14,borderTop:"1px solid #242a2e"},intent:{display:"flex",gap:8,alignItems:"center",color:"#7d858c",fontSize:12},primary:{border:0,borderRadius:12,padding:"12px 18px",background:"#f0b90b",fontWeight:900,cursor:"pointer"},examples:{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap",marginTop:16},example:{border:"1px solid #262c31",background:"transparent",color:"#7e868d",borderRadius:999,padding:"7px 10px",fontSize:11},error:{marginBottom:24,border:"1px solid #63322d",background:"#241514",color:"#ffb4aa",borderRadius:14,padding:14},success:{marginBottom:24,border:"1px solid #24583b",background:"#101a14",color:"#8cf0b5",borderRadius:14,padding:14},consoleLink:{color:"#f0b90b",marginLeft:12,textDecoration:"none",fontWeight:800},resultHeader:{marginBottom:18},h2:{margin:"6px 0 0",fontSize:28},loading:{border:"1px solid #242a2e",borderRadius:16,padding:24,color:"#8e969d"},grid:{display:"grid",gridTemplateColumns:"minmax(0,1.6fr) minmax(260px,.9fr)",gap:16},card:{background:"#121619",border:"1px solid #2b3136",borderRadius:18,padding:22},cardTop:{display:"flex",justifyContent:"space-between",gap:20},badge:{display:"inline-flex",padding:"5px 8px",borderRadius:999,background:"#35d07f",color:"#0b120d",fontWeight:900,fontSize:10},h3:{margin:"12px 0 8px",fontSize:30},desc:{margin:0,color:"#959da4",lineHeight:1.55},score:{fontSize:38},tags:{display:"flex",gap:8,flexWrap:"wrap",margin:"18px 0"},tag:{padding:"6px 9px",borderRadius:999,background:"#1b2024",border:"1px solid #292f34",fontSize:11},breakdown:{display:"grid",gap:11,borderTop:"1px solid #252b2f",paddingTop:18},metric:{display:"grid",gridTemplateColumns:"130px 1fr 34px",gap:10,alignItems:"center"},metricName:{color:"#a3aab0",fontSize:12,textTransform:"capitalize"},bar:{height:6,background:"#22282c",borderRadius:999,overflow:"hidden"},fill:{height:"100%",background:"#f0b90b"},hire:{width:"100%",marginTop:22,border:0,borderRadius:12,padding:"13px 16px",background:"#f0b90b",fontWeight:900},altRow:{display:"flex",justifyContent:"space-between",gap:12,padding:"15px 0",borderBottom:"1px solid #20262a"}
};
