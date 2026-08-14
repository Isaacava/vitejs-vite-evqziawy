import { useCallback, useEffect, useState } from "react";

type JobView = {
  job: { id: string; status: string; description: string; budget: number; chain_job_id: number | null; deliverable: string | null };
  task: { id: string; status: string; title: string; role: string } | null;
  mission: { id: string; title: string; goal: string; status: string; category: string } | null;
  evaluation: { verdict: string; notes: string | null } | null;
  payment: { amount: number; status: string; tx_hash: string | null; token_symbol: string | null } | null;
};

const STEPS = ["open", "accepted", "in_progress", "submitted", "terminal"];
const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function MissionConsole() {
  const [jobId] = useState(() => new URLSearchParams(window.location.search).get("job") || "");
  const [data, setData] = useState<JobView | null>(null);
  const [deliverable, setDeliverable] = useState("Completed the requested task and prepared the result for review.");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!jobId) return;
    const response = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || "Unable to load job");
    setData(body as JobView);
  }, [jobId]);

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "Unable to load job")); }, [load]);

  async function action(name: string) {
    if (!jobId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, action: name, deliverable, note }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Job action failed");
      setMessage(`${human(name)} recorded. Current state: ${human(body.state)}.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Job action failed"); }
    finally { setBusy(false); }
  }

  if (!jobId) return <main style={s.page}><div style={s.shell}><div style={s.card}><h1>Mission Console</h1><p style={s.muted}>Open this page with ?job=&lt;job-id&gt;.</p></div></div></main>;

  return <main style={s.page}><div style={s.shell}>
    <header style={s.header}><div><div style={s.brand}>AgentMarket</div><div style={s.muted}>Mission Console</div></div><a href="/" style={s.link}>Back to marketplace</a></header>
    {error && <div style={s.error}>{error}</div>}
    {message && <div style={s.success}>{message}</div>}
    {!data ? <div style={s.card}>Loading mission…</div> : <>
      <section style={s.hero}><div style={s.kicker}>MISSION</div><h1 style={s.title}>{data.mission?.title || "Agent mission"}</h1><p style={s.description}>{data.mission?.goal || data.job.description}</p><div style={s.tags}><span>{human(data.job.status)}</span><span>{data.task ? human(data.task.status) : "No task"}</span><span>{data.mission?.category || "general"}</span></div></section>
      <section style={s.timeline}>{STEPS.map((step, i) => { const current = STEPS.indexOf(data.job.status); const done = current >= i; return <div key={step} style={s.step}><b style={{ ...s.dot, background: done ? "#35d07f" : "#333a40" }} />{i < STEPS.length - 1 && <span style={s.line} />}</div>; })}</section>
      <div style={s.grid}>
        <section style={s.card}><div style={s.kicker}>AGENT WORKFLOW</div><h2>Execute the job</h2>
          {data.job.status === "open" || data.job.status === "funded" ? <button style={s.button} disabled={busy} onClick={() => void action("accept")}>Accept job</button> : null}
          {data.job.status === "accepted" ? <button style={s.button} disabled={busy} onClick={() => void action("start")}>Start execution</button> : null}
          {data.job.status === "in_progress" ? <><textarea value={deliverable} onChange={(e) => setDeliverable(e.target.value)} rows={6} style={s.textarea} /><button style={s.button} disabled={busy || !deliverable.trim()} onClick={() => void action("submit")}>Submit deliverable</button></> : null}
          {data.job.status === "submitted" ? <><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="Evaluation note" style={s.textarea} /><div style={s.actions}><button style={s.button} disabled={busy} onClick={() => void action("approve")}>Approve & settle</button><button style={s.secondary} disabled={busy} onClick={() => void action("reject")}>Reject / dispute</button></div></> : null}
          {data.job.status === "terminal" ? <div style={s.done}>The mission is terminal.</div> : null}
        </section>
        <aside style={s.card}><div style={s.kicker}>ESCROW & EVIDENCE</div><div style={s.stat}><span>Budget</span><b>{data.job.budget}</b></div><div style={s.stat}><span>Chain job</span><b>{data.job.chain_job_id ?? "Pending"}</b></div><div style={s.stat}><span>Evaluation</span><b>{data.evaluation?.verdict || "pending"}</b></div><div style={s.stat}><span>Payment</span><b>{data.payment?.status || "not recorded"}</b></div><p style={s.note}>This console records marketplace workflow state in Supabase. On-chain completion is only represented when a real chain job ID and transaction records exist.</p></aside>
      </div>
    </>}
  </div></main>;
}

const s: Record<string, React.CSSProperties> = {
  page:{minHeight:"100vh",background:"#0a0d0f",color:"#f5f5f0",fontFamily:"Inter,system-ui,sans-serif"},shell:{width:"min(1100px,calc(100% - 32px))",margin:"0 auto",paddingBottom:60},header:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"24px 0",borderBottom:"1px solid #202428"},brand:{fontSize:22,fontWeight:900},muted:{color:"#7f878f",fontSize:12},link:{color:"#f0b90b",textDecoration:"none",fontSize:12},hero:{marginTop:40,padding:26,background:"#121619",border:"1px solid #2b3136",borderRadius:18},kicker:{color:"#f0b90b",fontSize:10,fontWeight:900,letterSpacing:".16em"},title:{fontSize:34,letterSpacing:"-.04em",margin:"8px 0 12px"},description:{color:"#9aa1a7",lineHeight:1.6},tags:{display:"flex",gap:8,flexWrap:"wrap",color:"#9aa1a7",fontSize:12},timeline:{display:"flex",alignItems:"center",padding:"22px 4px"},step:{display:"flex",alignItems:"center"},dot:{width:10,height:10,borderRadius:999,display:"block"},line:{width:80,height:1,background:"#30373d",margin:"0 10px"},grid:{display:"grid",gridTemplateColumns:"minmax(0,1.5fr) minmax(260px,.8fr)",gap:16},card:{background:"#121619",border:"1px solid #2b3136",borderRadius:18,padding:22},button:{border:0,borderRadius:12,padding:"12px 16px",background:"#f0b90b",color:"#111",fontWeight:900,cursor:"pointer",marginTop:10},secondary:{border:"1px solid #5a3230",borderRadius:12,padding:"12px 16px",background:"#211615",color:"#ffb4aa",fontWeight:800,cursor:"pointer",marginTop:10},actions:{display:"flex",gap:10,flexWrap:"wrap"},textarea:{width:"100%",boxSizing:"border-box",marginTop:10,background:"#0d1012",border:"1px solid #2c3338",borderRadius:12,padding:12,color:"#f5f5f0",font:"inherit",resize:"vertical"},stat:{display:"flex",justifyContent:"space-between",padding:"13px 0",borderBottom:"1px solid #22282d",color:"#858d94",fontSize:13},note:{color:"#6f777e",lineHeight:1.6,fontSize:11,marginTop:18},done:{marginTop:12,padding:14,background:"#101914",border:"1px solid #214f35",borderRadius:12,color:"#8cf0b5"},error:{marginTop:24,padding:14,borderRadius:12,background:"#241514",border:"1px solid #63322d",color:"#ffb4aa"},success:{marginTop:24,padding:14,borderRadius:12,background:"#101914",border:"1px solid #214f35",color:"#8cf0b5"}
};
