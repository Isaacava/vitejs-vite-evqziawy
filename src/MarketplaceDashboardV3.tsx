import { useEffect, useMemo, useState } from "react";
import { parseMarketplaceIntent } from "./lib/intent";
import { supabase } from "./lib/supabase";

type Agent = { agent_id: string; name: string | null; description: string | null; category: string; status?: string; is_first_party?: boolean; reputation_score?: number; completion_rate?: number; jobs_completed?: number; endpoint_status?: string };
type Match = { agent: Agent; score: number; breakdown: Record<string, number> };
type MatchResponse = { intent: ReturnType<typeof parseMarketplaceIntent>; bestMatch: Match | null; alternatives: Match[] };

const examples = ["Manage my BNB portfolio conservatively", "Find a safe yield strategy for my idle assets", "Monitor my lending health factor and liquidation risk", "Run a controlled grid strategy"];
const labels: Record<string,string> = { rebalancing:"Rebalancing", grid_trading:"Grid Trading", yield:"Yield", health_factor:"Health Factor", other:"General DeFi" };

function scoreColor(score:number){ return score >= 85 ? "#35d07f" : score >= 70 ? "#f0b90b" : "#ff8a65"; }
function categoryLabel(category:string){ return labels[category] || category.replace(/_/g," "); }

async function fallback(goal:string):Promise<MatchResponse>{
  const intent = parseMarketplaceIntent(goal);
  const { data, error } = await supabase.from("marketplace_agents").select("*").limit(20);
  if(error) throw error;
  const matches = ((data || []) as Array<Record<string,unknown>>).map((row)=>{
    const agent:Agent = { agent_id:String(row.agent_id||""), name:(row.name as string|null)||null, description:(row.description as string|null)||null, category:intent.category, status:String(row.status||"offline"), is_first_party:Boolean(row.is_first_party), reputation_score:80, completion_rate:90, jobs_completed:0, endpoint_status:row.status === "online" ? "online" : "offline" };
    const capability = agent.category === intent.category ? 100 : 25;
    const verification = agent.is_first_party ? 100 : 50;
    const liveness = agent.endpoint_status === "online" ? 100 : 40;
    const score = capability*.35 + verification*.2 + liveness*.15 + 90*.1 + 80*.15;
    return { agent, score, breakdown:{ capability, verification, endpointLiveness:liveness, completion:90, jobVolume:0, reputation:80 } };
  }).sort((a,b)=>b.score-a.score);
  return { intent, bestMatch:matches[0]||null, alternatives:matches.slice(1,4) };
}

export default function MarketplaceDashboardV3(){
  const [goal,setGoal]=useState(examples[0]);
  const [result,setResult]=useState<MatchResponse|null>(null);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState("");
  const [missionId,setMissionId]=useState("");
  const intent=useMemo(()=>parseMarketplaceIntent(goal),[goal]);

  async function match(){
    if(!goal.trim()) return;
    setBusy(true); setError(""); setMissionId("");
    try{
      const r=await fetch("/api/match",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({goal})});
      if(!r.ok) throw new Error("Matching API unavailable");
      setResult(await r.json());
    }catch{
      try{ setResult(await fallback(goal)); }
      catch(e){ setResult(null); setError(e instanceof Error ? e.message : "Unable to find an agent"); }
    }finally{ setBusy(false); }
  }

  async function hire(){
    const best=result?.bestMatch; if(!best) return;
    setBusy(true); setError("");
    try{
      const r=await fetch("/api/missions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({goal,agent_id:best.agent.agent_id,budget:0})});
      const data=await r.json();
      if(!r.ok) throw new Error(data?.error || "Mission creation failed");
      setMissionId(data.mission.id);
    }catch(e){ setError(e instanceof Error ? e.message : "Mission creation failed"); }
    finally{ setBusy(false); }
  }

  useEffect(()=>{ void match(); },[]);

  return <main style={s.page}><div style={s.shell}>
    <header style={s.nav}><div><b style={s.brand}>AgentMarket</b><div style={s.sub}>BNB Agent Studio Marketplace</div></div><span style={s.protocols}>ERC-8004 · ERC-8183 · x402</span></header>
    <section style={s.hero}><div style={s.kicker}>MISSION-FIRST DISCOVERY</div><h1 style={s.title}>Tell us what you want done.<br/>We find the agent.</h1><p style={s.copy}>Describe a DeFi goal in one sentence. We interpret it, rank compatible agents using transparent reliability signals, and create a mission for the best match.</p>
      <div style={s.prompt}><textarea value={goal} onChange={e=>setGoal(e.target.value)} rows={4} style={s.textarea}/><div style={s.promptFoot}><div style={s.intent}><span>Detected:</span><b>{categoryLabel(intent.category)}</b><b>{intent.risk} risk</b></div><button style={s.primary} disabled={busy} onClick={()=>void match()}>{busy?"Working…":"Find my agent"}</button></div></div>
      <div style={s.examples}>{examples.map(x=><button key={x} style={s.example} onClick={()=>setGoal(x)}>{x}</button>)}</div>
    </section>
    {error && <div style={s.error}>{error}</div>}
    {missionId && <div style={s.success}><b>Mission created:</b> {missionId.slice(0,8)}… · job is now open for agent execution.</div>}
    <section><div style={s.resultHead}><div><div style={s.kicker}>MATCH RESULTS</div><h2 style={s.resultTitle}>Best agent for this mission</h2></div>{result&&<span style={s.meta}>{(result.alternatives.length)+(result.bestMatch?1:0)} candidates</span>}</div>
      {busy&&!result && <div style={s.loading}>Comparing capability, verification, liveness, reputation and track record…</div>}
      {!busy&&result?.bestMatch&&<div style={s.grid}><article style={s.card}><div style={s.cardTop}><div><span style={s.badge}>BEST MATCH</span><h3 style={s.name}>{result.bestMatch.agent.name||`Agent #${result.bestMatch.agent.agent_id}`}</h3><p style={s.desc}>{result.bestMatch.agent.description||"On-chain DeFi specialist"}</p></div><strong style={{...s.score,color:scoreColor(result.bestMatch.score)}}>{Math.round(result.bestMatch.score)}%</strong></div>
        <div style={s.tags}><span style={s.tag}>{categoryLabel(result.bestMatch.agent.category)}</span><span style={s.tag}>{result.bestMatch.agent.status||"offline"}</span>{result.bestMatch.agent.is_first_party&&<span style={s.tag}>verified</span>}</div>
        <div style={s.breakdown}>{Object.entries(result.bestMatch.breakdown).map(([k,v])=><div key={k} style={s.metric}><span style={s.metricName}>{k.replace(/([A-Z])/g," $1")}</span><div style={s.bar}><div style={{...s.fill,width:`${Math.max(0,Math.min(100,v))}%`}}/></div><span style={s.metricValue}>{Math.round(v)}</span></div>)}</div>
        <button style={s.hire} disabled={busy||!!missionId} onClick={()=>void hire()}>{missionId?"Mission created":busy?"Creating…":"Hire this agent"}</button></article>
        <aside style={s.alt}><div style={s.kicker}>ALTERNATIVES</div>{result.alternatives.map(m=><div key={m.agent.agent_id} style={s.altRow}><div style={s.altInfo}><strong>{m.agent.name||`Agent #${m.agent.agent_id}`}</strong><span>{categoryLabel(m.agent.category)}</span></div><b style={{color:scoreColor(m.score)}}>{Math.round(m.score)}%</b></div>)}</aside>
      </div>}
      {!busy&&!result?.bestMatch&&!error&&<div style={s.loading}>No compatible agents found. Try a broader goal.</div>}
    </section>
  </div></main>;
}

const s:Record<string,React.CSSProperties>={
  page:{minHeight:"100vh",background:"#0a0d0f",color:"#f5f5f0",fontFamily:"Inter,ui-sans-serif,system-ui,sans-serif"},
  shell:{width:"min(1180px,calc(100% - 32px))",margin:"0 auto",paddingBottom:64},
  nav:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"24px 0",borderBottom:"1px solid #202428"},
  brand:{fontSize:23,fontWeight:900,letterSpacing:"-0.04em"},sub:{color:"#858c93",fontSize:12,marginTop:3},protocols:{color:"#727a82",fontSize:12},
  hero:{padding:"72px 0 50px",textAlign:"center"},kicker:{fontSize:11,fontWeight:900,letterSpacing:".16em",color:"#f0b90b"},title:{fontSize:"clamp(44px,7vw,80px)",lineHeight:.98,letterSpacing:"-.06em",margin:"16px 0 20px"},copy:{maxWidth:760,margin:"0 auto 34px",color:"#9aa1a7",lineHeight:1.7},
  prompt:{textAlign:"left",background:"#121619",border:"1px solid #2b3136",borderRadius:20,padding:18},textarea:{width:"100%",boxSizing:"border-box",resize:"vertical",minHeight:120,background:"transparent",border:0,outline:0,color:"#fff",font:"inherit",fontSize:18,lineHeight:1.5},promptFoot:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,flexWrap:"wrap",paddingTop:14,borderTop:"1px solid #242a2e"},intent:{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",color:"#7d858c",fontSize:12},primary:{border:0,borderRadius:12,padding:"12px 18px",background:"#f0b90b",color:"#111",fontWeight:900,cursor:"pointer"},examples:{marginTop:16,display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"},example:{border:"1px solid #262c31",background:"transparent",color:"#7e868d",borderRadius:999,padding:"7px 10px",fontSize:11,cursor:"pointer"},error:{marginBottom:24,border:"1px solid #63322d",background:"#241514",color:"#ffb4aa",borderRadius:14,padding:14},success:{marginBottom:24,border:"1px solid #24583b",background:"#101a14",color:"#8cf0b5",borderRadius:14,padding:14},
  resultHead:{display:"flex",justifyContent:"space-between",alignItems:"end",marginBottom:18},resultTitle:{margin:"6px 0 0",fontSize:28,letterSpacing:"-.03em"},meta:{color:"#737b82",fontSize:12},loading:{border:"1px solid #242a2e",borderRadius:16,padding:24,color:"#8e969d"},grid:{display:"grid",gridTemplateColumns:"minmax(0,1.6fr) minmax(260px,.9fr)",gap:16},card:{background:"#121619",border:"1px solid #2b3136",borderRadius:18,padding:22},cardTop:{display:"flex",justifyContent:"space-between",gap:20},badge:{display:"inline-flex",padding:"5px 8px",borderRadius:999,background:"#35d07f",color:"#0b120d",fontWeight:900,fontSize:10},name:{margin:"12px 0 8px",fontSize:30,letterSpacing:"-.04em"},desc:{margin:0,color:"#959da4",lineHeight:1.55},score:{fontWeight:900,fontSize:38},tags:{display:"flex",gap:8,flexWrap:"wrap",margin:"18px 0"},tag:{padding:"6px 9px",borderRadius:999,background:"#1b2024",border:"1px solid #292f34",color:"#bbc1c6",fontSize:11},breakdown:{display:"grid",gap:11,borderTop:"1px solid #252b2f",paddingTop:18},metric:{display:"grid",gridTemplateColumns:"130px 1fr 34px",gap:10,alignItems:"center"},metricName:{color:"#a3aab0",fontSize:12,textTransform:"capitalize"},bar:{height:6,background:"#22282c",borderRadius:999,overflow:"hidden"},fill:{height:"100%",background:"#f0b90b",borderRadius:999},metricValue:{color:"#d9dcdf",fontSize:12,textAlign:"right"},hire:{width:"100%",marginTop:22,border:0,borderRadius:12,padding:"13px 16px",background:"#f0b90b",color:"#111",fontWeight:900,cursor:"pointer"},alt:{background:"#0e1214",border:"1px solid #242a2e",borderRadius:18,padding:20},altRow:{display:"flex",justifyContent:"space-between",gap:12,padding:"15px 0",borderBottom:"1px solid #20262a"},altInfo:{display:"grid",gap:4},altInfo span:{color:"#747c83",fontSize:11}
};
