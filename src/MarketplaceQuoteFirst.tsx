import { useMemo, useState } from "react";
import type { Address } from "viem";
import { buildErc8183Plan, type Erc8183PlanStep, type Erc8183PreparedResponse } from "./lib/erc8183TransactionPlan";
import { sendAndConfirm as sendPreparedAndConfirm, type ConfirmedTransaction } from "./lib/onchainExecutor";
import { connectTestnetWallet, getTestnetCurrentUser } from "./lib/testnetWalletAuth";
import { parseMarketplaceIntent } from "./lib/intent";
import "./mission-console.css";

type Match = {
  agent: { id?: string; agent_id: string; name: string | null; description: string | null; category: string; status?: string | null; verification_status?: string | null };
  score: number;
  scoreConfidence?: "high" | "medium" | "low";
  hireability?: { status: "ready" | "degraded" | "discoverable_only"; canCreateJob: boolean; reason: string };
  reasons?: string[];
};
type MatchResponse = { bestMatch: Match | null; bestHireableMatch?: Match | null; alternatives: Match[]; intent: ReturnType<typeof parseMarketplaceIntent> };
type QuoteResponse = { ok: boolean; quote: { quote_id: string; price: string; currency: string; quote_hash: string | null; status: string; expires_at: string }; provider?: { agent_id: string; name: string | null; endpoint: string; status: string | null }; signature_present?: boolean };
type MissionResponse = { mission: { id: string; goal: string; status: string }; task: { id: string }; job: { id: string; status: string } };
type PreparedResponse = Erc8183PreparedResponse & { ok: boolean; quote: { quote_id: string; price: string; currency: string; quote_hash: string; expires_at: string; status: string }; agent: { agent_id: string; name: string | null; provider: string }; job_description: string };

type StoredReceipt = ConfirmedTransaction & { label: string };
const examples = [
  "Manage my BNB portfolio conservatively",
  "Find a safe yield strategy for my idle assets",
  "Monitor my lending health factor and liquidation risk",
  "Run a controlled grid strategy",
];
const gridParams = (category: string) => category === "grid_trading"
  ? { category, lower_price: 600, upper_price: 700, grid_levels: 12, notional: 100, max_slippage_bps: 50 }
  : { category };
const readJson = async (response: Response) => {
  const raw = await response.text();
  let body: any = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { throw new Error(`HTTP ${response.status}: ${raw.slice(0, 240)}`); }
  if (!response.ok) throw new Error(body?.error || "Request failed");
  return body;
};
const compact = (value?: string | null) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";

export default function MarketplaceQuoteFirst() {
  const [goal, setGoal] = useState(examples[0]);
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [selected, setSelected] = useState<Match | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [mission, setMission] = useState<MissionResponse | null>(null);
  const [prepared, setPrepared] = useState<PreparedResponse | null>(null);
  const [receipts, setReceipts] = useState<Record<string, StoredReceipt>>({});
  const [chainJobId, setChainJobId] = useState("");
  const [step, setStep] = useState(1);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [ttl, setTtl] = useState<number | null>(null);

  const intent = useMemo(() => parseMarketplaceIntent(goal), [goal]);
  const plan = useMemo(() => prepared ? buildErc8183Plan(prepared, chainJobId || undefined) : [], [prepared, chainJobId]);
  const pending = plan.find((item) => !receipts[item.id] && item.transaction);

  async function discover() {
    setWorking(true); setError(""); setMatch(null); setSelected(null); setQuote(null); setMission(null); setPrepared(null); setReceipts({}); setChainJobId("");
    try {
      const body = await readJson(await fetch("/api/testnet/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal }) })) as MatchResponse;
      setMatch(body);
      setSelected(body.bestHireableMatch || body.bestMatch);
      setStep(2);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to discover a Testnet provider");
    } finally { setWorking(false); }
  }

  async function requestQuote() {
    if (!selected?.agent.id) { setError("The selected provider is missing its marketplace id."); return; }
    if (!selected.hireability?.canCreateJob) { setError(selected.hireability?.reason || "This provider is not currently hireable."); return; }
    setWorking(true); setError("");
    try {
      const auth = await getTestnetCurrentUser();
      if (!auth) throw new Error("Connect and sign in with your Testnet wallet before requesting a quote.");
      const body = await readJson(await fetch("/api/testnet/quotes", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal, agent_id: selected.agent.id, parameters: gridParams(selected.agent.category) }) })) as QuoteResponse;
      setQuote(body);
      setStep(3);
      setTtl(Math.max(0, Math.floor((new Date(body.quote.expires_at).getTime() - Date.now()) / 1000)));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to request the provider quote"); }
    finally { setWorking(false); }
  }

  async function acceptQuote() {
    if (!quote?.quote.quote_id) return;
    setWorking(true); setError("");
    try {
      const body = await readJson(await fetch("/api/testnet/quotes", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", quote_id: quote.quote.quote_id }) })) as QuoteResponse;
      setQuote(body);
      setStep(4);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to accept the quote"); }
    finally { setWorking(false); }
  }

  async function createMissionFromAcceptedQuote() {
    if (!quote?.quote.quote_id || !selected) return;
    setWorking(true); setError("");
    try {
      const created = await readJson(await fetch("/api/missions", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal, agent_id: selected.agent.agent_id, budget: 0 }) })) as MissionResponse;
      setMission(created);
      setStep(5);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create the mission"); }
    finally { setWorking(false); }
  }

  async function prepare() {
    if (!quote?.quote.quote_id || !mission?.mission.id) return;
    setWorking(true); setError("");
    try {
      const auth = await getTestnetCurrentUser();
      if (!auth?.wallet_address) throw new Error("Connect and sign in with your Testnet wallet before preparing transactions.");
      const body = await readJson(await fetch("/api/testnet/prepare-quote", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission_id: mission.mission.id, quote_id: quote.quote.quote_id, client_address: auth.wallet_address }) })) as PreparedResponse;
      setPrepared(body); setReceipts({}); setChainJobId(""); setStep(6);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to prepare the accepted quote"); }
    finally { setWorking(false); }
  }

  async function syncReceipt(item: Erc8183PlanStep, receipt: ConfirmedTransaction) {
    if (!mission) throw new Error("Mission context is missing.");
    const body = await readJson(await fetch("/api/testnet/erc8183", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync_receipt", mission_id: mission.mission.id, job_id: mission.job.id, phase: item.id, tx_hash: receipt.hash, chain_job_id: chainJobId || undefined }) })) as { job?: { chain_job_id?: number | null }; onchain_job?: { id?: string | null } | null };
    setReceipts((current) => ({ ...current, [item.id]: { ...receipt, label: item.label } }));
    if (item.id === "create") {
      const id = body.job?.chain_job_id ?? body.onchain_job?.id;
      if (id != null) setChainJobId(String(id));
    }
  }

  async function signNext() {
    if (!prepared || !pending || working) return;
    setWorking(true); setError("");
    try {
      await connectTestnetWallet();
      const receipt = await sendPreparedAndConfirm(pending.transaction!);
      await syncReceipt(pending, receipt);
      if (pending.id === "fund") setStep(7);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Testnet transaction failed");
    } finally { setWorking(false); }
  }

  function reset() {
    setMatch(null); setSelected(null); setQuote(null); setMission(null); setPrepared(null); setReceipts({}); setChainJobId(""); setError(""); setStep(1); setTtl(null);
  }

  const quoteExpired = quote && new Date(quote.quote.expires_at).getTime() <= Date.now();
  const completedSteps = Object.keys(receipts).length;

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a className="console-brand" href="/dashboard">AgentMarket</a>
          <span>MARKETPLACE / QUOTE-FIRST</span>
          <a href="/testnet">TESTNET →</a>
        </header>

        <section className="console-hero">
          <div>
            <span className="console-kicker">BSC TESTNET / CHAIN 97</span>
            <h1>Hire an agent from its published interface.</h1>
            <p>AgentMarket discovers a provider, requests its live quote, records acceptance, then prepares the exact ERC-8183 settlement amount. No agent-specific marketplace dependency is required.</p>
          </div>
          <div className="console-state"><small>FLOW</small><strong>{step}/7</strong><span>{quote?.quote.status || "Discovery"}</span></div>
        </section>

        {error && <div className="console-alert console-alert-error">{error}</div>}

        <section className="console-card" style={{ marginBottom: 16 }}>
          <div className="console-section-head"><span>1 / REQUEST</span><b>{intent.category}</b></div>
          <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} style={{ width: "100%", resize: "vertical", padding: 12, border: "1px solid var(--line, #d8d3c7)", background: "#fffdf8", font: "inherit", borderRadius: 8 }} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {examples.map((example) => <button key={example} className="console-brass-button" type="button" onClick={() => setGoal(example)}>{example}</button>)}
          </div>
          <button className="console-brass-button" type="button" disabled={working || !goal.trim()} onClick={discover} style={{ marginTop: 12 }}>{working && step === 1 ? "Discovering…" : "Discover provider →"}</button>
        </section>

        {match && selected && (
          <section className="console-grid">
            <div className="console-card">
              <div className="console-section-head"><span>2 / PROVIDER</span><b>{selected.hireability?.status || "discoverable"}</b></div>
              <h2 style={{ marginTop: 0 }}>{selected.agent.name || `Agent #${selected.agent.agent_id}`}</h2>
              <p className="console-evidence">{selected.agent.description || "Published provider discovered from marketplace identity and capability evidence."}</p>
              <div className="console-stat"><span>Category</span><strong>{selected.agent.category}</strong></div>
              <div className="console-stat"><span>Match</span><strong>{selected.score.toFixed(2)} / {selected.scoreConfidence || "unrated"}</strong></div>
              {selected.reasons?.length ? <div className="console-evidence">{selected.reasons.slice(0, 3).join(" · ")}</div> : null}
              <button className="console-brass-button" type="button" disabled={working || !selected.hireability?.canCreateJob} onClick={requestQuote} style={{ marginTop: 12 }}>Request live quote →</button>
            </div>

            {quote && (
              <div className="console-card">
                <div className="console-section-head"><span>3 / QUOTE</span><b>{quoteExpired ? "EXPIRED" : quote.quote.status}</b></div>
                <div className="console-stat"><span>Provider</span><strong>{quote.provider?.name || quote.provider?.agent_id || selected.agent.agent_id}</strong></div>
                <div className="console-stat"><span>Price</span><strong>{quote.quote.price} {quote.quote.currency}</strong></div>
                <div className="console-stat"><span>Expires</span><strong>{new Date(quote.quote.expires_at).toLocaleString()}</strong></div>
                <div className="console-stat"><span>Hash</span><strong>{compact(quote.quote.quote_hash)}</strong></div>
                <button className="console-brass-button" type="button" disabled={working || quoteExpired || quote.quote.status !== "offered"} onClick={acceptQuote} style={{ marginTop: 12 }}>Accept exact quote →</button>
                {quote.quote.status === "accepted" && <span className="console-evidence">Accepted. The quoted amount is now the settlement source for preparation.</span>}
              </div>
            )}
          </section>
        )}

        {quote?.quote.status === "accepted" && (
          <section className="console-grid" style={{ marginTop: 16 }}>
            <div className="console-card">
              <div className="console-section-head"><span>4 / MISSION</span><b>{mission ? mission.mission.status : "READY"}</b></div>
              <p className="console-evidence">The mission record is created only after the provider quote has been accepted.</p>
              {!mission ? <button className="console-brass-button" type="button" disabled={working} onClick={createMissionFromAcceptedQuote}>Create mission from accepted quote →</button> : <div className="console-stat"><span>Mission</span><strong>{compact(mission.mission.id)}</strong></div>}
            </div>
            {mission && (
              <div className="console-card">
                <div className="console-section-head"><span>5 / PREPARE</span><b>{prepared ? "READY" : "WAITING"}</b></div>
                <p className="console-evidence">Server validation re-checks the accepted quote, Testnet provider health, payment balance, and live policy before returning wallet transactions.</p>
                {!prepared ? <button className="console-brass-button" type="button" disabled={working} onClick={prepare}>Prepare exact settlement →</button> : <div className="console-stat"><span>Quoted budget</span><strong>{prepared.payment.balance_formatted} {prepared.payment.symbol}</strong></div>}
              </div>
            )}
          </section>
        )}

        {prepared && (
          <section className="console-card" style={{ marginTop: 16 }}>
            <div className="console-section-head"><span>6 / SIGN EXACT PLAN</span><b>{completedSteps}/5 CONFIRMED</b></div>
            <div className="console-evidence">Each transaction is generated from the accepted quote. The real on-chain job ID is learned only from the confirmed createJob receipt.</div>
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              {plan.map((item) => <div key={item.id} className="console-stat"><span>{item.label}</span><strong>{receipts[item.id] ? `confirmed · ${compact(receipts[item.id].hash)}` : item.transaction ? "ready" : "waiting for jobId"}</strong></div>)}
            </div>
            {pending && <button className="console-brass-button" type="button" disabled={working} onClick={signNext} style={{ marginTop: 12 }}>{working ? `Confirming ${pending.label}…` : `Sign ${pending.label} →`}</button>}
            {!pending && completedSteps >= 4 && <p className="console-evidence">No additional transaction is currently ready. Refresh after the receipt synchronization step if the final state has not advanced.</p>}
          </section>
        )}

        {step === 7 && (
          <section className="console-card" style={{ marginTop: 16 }}>
            <div className="console-section-head"><span>7 / FUNDED</span><b>COMPLETE</b></div>
            <p className="console-evidence">The accepted quote was funded into the ERC-8183 escrow flow. Continue from the mission console to monitor provider progress and settlement.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {chainJobId && <a className="console-brass-button" href={`/mission?job=${encodeURIComponent(chainJobId)}`} style={{ textDecoration: "none" }}>Open mission console →</a>}
              <button className="console-brass-button" type="button" onClick={reset}>Start another request</button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
