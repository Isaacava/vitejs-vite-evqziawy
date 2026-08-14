import { useCallback, useEffect, useState } from "react";

type JobView = {
  job: {
    id: string;
    status: string;
    description: string;
    budget: number;
    chain_job_id: number | null;
    deliverable: string | null;
    created_at: string;
    accepted_at: string | null;
    submitted_at: string | null;
    terminal_at: string | null;
  };
  task: { id: string; status: string; title: string; role: string } | null;
  mission: { id: string; title: string; goal: string; status: string; category: string } | null;
  evaluation: { verdict: string; notes: string | null } | null;
  payment: { amount: number; status: string; tx_hash: string | null; token_symbol: string | null } | null;
};

const steps = [
  ["open", "Job open"],
  ["accepted", "Agent accepted"],
  ["in_progress", "Execution"],
  ["submitted", "Deliverable"],
  ["terminal", "Settled"],
] as const;

function label(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function MissionConsole() {
  const [jobId, setJobId] = useState(() => new URLSearchParams(window.location.search).get("job") || "");
  const [data, setData] = useState<JobView | null>(null);
  const [deliverable, setDeliverable] = useState("Completed the requested DeFi task and prepared the result for evaluation.");
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

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Unable to load job"));
  }, [load]);

  async function act(action: string) {
    if (!jobId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, action, deliverable, note }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Job action failed");
      setMessage(`${label(action)} recorded. Current state: ${label(body.state)}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Job action failed");
    } finally {
      setBusy(false);
    }
  }

  if (!jobId) {
    return <main style={s.page}><div style={s.shell}><div style={s.card}><h1 style={s.title}>Mission Console</h1><p style={s.muted}>Open a mission with a <code>?job=...</code> query parameter.</p></div></div></main>;
  }

  return (
    <main style={s.page}>
      <div style={s.shell}>
        <header style={s.header}>
          <div><div style={s.brand}>AgentMarket</div><div style={s.muted}>Mission Console</div></div>
          <a href="/" style={s.link}>Back to marketplace</a>
        </header>

        {error && <div style={s.error}>{error}</div>}
        {message && <div style={s.success}>{message}</div>}

        {!data ? <div style={s.card}>Loading mission…</div> : (
          <>
            <section style={s.heroCard}>
              <div style={s.kicker}>MISSION</div>
              <h1 style={s.title}>{data.mission?.title || "Agent mission"}</h1>
              <p style={s.description}>{data.mission?.goal || data.job.description}</p>
              <div style={s.metaRow}><span>{label(data.job.status)}</span><span>{data.task ? label(data.task.status) : "No task"}</span><span>{data.mission?.category || "general"}</span></div>
            </section>

            <section style={s.timeline}>
              {steps.map(([status, text], index) => {
                const currentIndex = steps.findIndex(([candidate]) => candidate === data.job.status);
                const done = currentIndex >= index && currentIndex >= 0;
                return <div key={status} style={{ ...s.step, opacity: done ? 1 : .45 }}><div style={{ ...s.dot, background: done ? "#35d07f" : "#333a40" }} />{index < steps.length - 1 && <div style={s.line} />}<span>{text}</span></div>;
              })}
            </section>

            <div style={s.grid}>
              <section style={s.card}>
                <div style={s.kicker}>AGENT WORKFLOW</div>
                <h2 style={s.sectionTitle}>Execute the job</h2>
                <div style={s.actions}>
                  {(data.job.status === "open" || data.job.status === "funded") && <button style={s.button} disabled={busy} onClick={() => void act("accept")}>Accept job</button>}
                  {data.job.status === "accepted" && <button style={s.button} disabled={busy} onClick={() => void act("start")}>Start execution</button>}
                  {data.job.status === "in_progress" && <><textarea value={deliverable} onChange={(e) => setDeliverable(e.target.value)} rows={6} style={s.textarea} /><button style={s.button} disabled={busy || !deliverable.trim()} onClick={() => void act("submit")}>Submit deliverable</button></>}
                  {data.job.status === "submitted" && <><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="Evaluation note" style={s.textarea} /><div style={s.actionRow}><button style={s.button} disabled={busy} onClick={() => void act("approve")}>Approve & settle</button><button style={s.secondary} disabled={busy} onClick={() => void act("reject")}>Reject / dispute</button></div></>}
                  {data.job.status === "terminal" && <div style={s.done}>Mission is terminal and payment can be represented as released in the settlement record.</div>}
                </div>
              </section>

              <aside style={s.card}>
                <div style={s.kicker}>ESCROW & EVIDENCE</div>
                <div style={s.stat}><span>Budget</span><strong>{data.job.budget}</strong></div>
                <div style={s.stat}><span>Chain job</span><strong>{data.job.chain_job_id ?? "Pending"}</strong></div>
                <div style={s.stat}><span>Evaluation</span><strong>{data.evaluation?.verdict || "pending"}</strong></div>
                <div style={s.stat}><span>Payment</span><strong>{data.payment?.status || "not recorded"}</strong></div>
                <div style={s.note}>The console records marketplace workflow state in Supabase. On-chain ERC-8183 writes are only marked complete when a real chain transaction and job ID are stored.</div>
              </aside>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0a0d0f", color: "#f5f5f0", fontFamily: "Inter, system-ui, sans-serif" },
  shell: { width: "min(1100px, calc(100% - 32px))", margin: "0 auto", paddingBottom: 60 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 0", borderBottom: "1px solid #202428" },
  brand: { fontSize: 22, fontWeight: 900 },
  muted: { color: "#7f878f", fontSize: 12 },
  link: { color: "#f0b90b", fontSize: 12, textDecoration: "none" },
  heroCard: { marginTop: 40, padding: 26, background: "#121619", border: "1px solid #2b3136", borderRadius: 18 },
  card: { background: "#121619", border: "1px solid #2b3136", borderRadius: 18, padding: 22 },
  title: { fontSize: 34, letterSpacing: "-.04em", margin: "8px 0 12px" },
  description: { color: "#9aa1a7", lineHeight: 1.6, margin: 0 },
  kicker: { color: "#f0b90b", fontSize: 10, fontWeight: 900, letterSpacing: ".16em" },
  metaRow: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 },
  timeline: { display: "flex", alignItems: "center", padding: "22px 4px", overflowX: "auto" },
  step: { position: "relative", display: "flex", alignItems: "center", gap: 8, minWidth: 150, color: "#aab0b5", fontSize: 12 },
  dot: { width: 10, height: 10, borderRadius: 999, flex: "0 0 auto" },
  line: { width: 40, height: 1, background: "#30373d", margin: "0 10px" },
  grid: { display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(260px,.8fr)", gap: 16 },
  sectionTitle: { margin: "7px 0 18px", fontSize: 22 },
  actions: { display: "grid", gap: 12 },
  actionRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  button: { border: 0, borderRadius: 12, padding: "12px 16px", background: "#f0b90b", color: "#111", fontWeight: 900, cursor: "pointer" },
  secondary: { border: "1px solid #5a3230", borderRadius: 12, padding: "12px 16px", background: "#211615", color: "#ffb4aa", fontWeight: 800, cursor: "pointer" },
  textarea: { width: "100%", boxSizing: "border-box", background: "#0d1012", border: "1px solid #2c3338", borderRadius: 12, padding: 12, color: "#f5f5f0", resize: "vertical", font: "inherit" },
  stat: { display: "flex", justifyContent: "space-between", padding: "13px 0", borderBottom: "1px solid #22282d", color: "#858d94", fontSize: 13 },
  stat: { display: "flex", justifyContent: "space-between", padding: "13px 0", borderBottom: "1px solid #22282d", color: "#858d94", fontSize: 13 },
  note: { marginTop: 18, color: "#6f777e", lineHeight: 1.6, fontSize: 11 },
  done: { padding: 14, background: "#101914", border: "1px solid #214f35", borderRadius: 12, color: "#8cf0b5" },
  error: { marginTop: 24, padding: 14, borderRadius: 12, background: "#241514", border: "1px solid #63322d", color: "#ffb4aa" },
  success: { marginTop: 24, padding: 14, borderRadius: 12, background: "#101914", border: "1px solid #214f35", color: "#8cf0b5" },
};
