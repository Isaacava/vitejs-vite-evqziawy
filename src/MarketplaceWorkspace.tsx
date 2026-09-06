import { useEffect, useMemo, useState } from "react";
import { buildErc8183Plan, type Erc8183PlanStep, type Erc8183PreparedResponse } from "./lib/erc8183TransactionPlan";
import { getTestnetConnectedProvider, connectTestnetWallet } from "./lib/testnetWalletAuth";
import { parseMarketplaceIntent } from "./lib/intent";

type Agent = { id?: string; agent_id: string; name: string | null; description: string | null; category: string; status?: string | null; verification_status?: string | null };
type Match = { agent: Agent; score: number; breakdown: Record<string, number>; scoreConfidence?: "high" | "medium" | "low"; evidence?: { reputationAvailable?: boolean; completionAvailable?: boolean; livenessAvailable?: boolean }; hireability?: { status: "ready" | "degraded" | "discoverable_only"; canCreateJob: boolean; reason: string }; reasons?: string[] };
type MatchResponse = { intent: ReturnType<typeof parseMarketplaceIntent>; bestMatch: Match | null; bestHireableMatch?: Match | null; alternatives: Match[] };
type CapInput = { name: string; label?: string; type?: string; required?: boolean; help?: string };
type Cap = { version?: number; inputs?: CapInput[]; defaults?: Record<string, unknown> };
type CapResponse = { capability: Cap; agent: { owner?: string; category?: string; name?: string | null } };
type MissionResponse = { mission: { id: string; title?: string; category?: string; budget?: number }; task: { id: string; parameters?: Record<string, unknown> }; job: { id: string; status: string; parameters?: Record<string, unknown> } };
type QuoteResponse = { ok: boolean; quote: { quote_id: string; price: string; currency: string; quote_hash: string | null; status: string; expires_at: string }; provider?: { agent_id: string; name: string | null; endpoint: string; status: string | null; wallet_address?: string }; signature_present?: boolean };
type PreparedResponse = Erc8183PreparedResponse & { ok: boolean; quote: { quote_id: string; price: string; currency: string; quote_hash: string; expires_at: string; status: string }; agent: { agent_id: string; name: string | null; provider: string }; job_description: string };
type Receipt = { hash: string; blockNumber: string; logs: Array<{ address: string; topics: readonly `0x${string}`[]; data: `0x${string}` }> };
type TxBody = { to: string; data?: string; value?: string };

const examples = ["Manage my BNB portfolio conservatively", "Find a safe yield strategy for my idle assets", "Monitor my lending health factor and liquidation risk", "Run a controlled grid strategy"];
const human = (v: string) => v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const compact = (v?: string | null) => v ? `${v.slice(0, 6)}…${v.slice(-4)}` : "—";
const read = async (r: Response) => { const raw = await r.text(); let body: any = null; try { body = raw ? JSON.parse(raw) : null; } catch { throw new Error(`${r.status}: ${raw.replace(/\s+/g, " ").slice(0, 240)}`); } if (!r.ok) throw new Error(body?.error || "Request failed"); return body; };
const categoryLabel = (v: string) => human(v);

const walletTimeout = <T,>(promise: Promise<T>, ms: number, message: string) => new Promise<T>((resolve, reject) => {
  const timer = window.setTimeout(() => reject(new Error(message)), ms);
  promise.then((value) => { window.clearTimeout(timer); resolve(value); }, (error) => { window.clearTimeout(timer); reject(error); });
});

function normalizeChain(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw.startsWith("0x")) return Number.parseInt(raw.slice(2), 16);
  return Number(raw || 0);
}

async function sendAndConfirm(tx: TxBody): Promise<Receipt> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(tx.to)) throw new Error("Testnet transaction target is invalid.");
  const provider = getTestnetConnectedProvider();
  const chain = normalizeChain(await walletTimeout(provider.request({ method: "eth_chainId" }), 15000, "Wallet did not return the Testnet chain."));
  if (chain !== 97) throw new Error("Wallet must remain on BSC Testnet (chain 97).");
  const accounts = await walletTimeout(provider.request({ method: "eth_accounts" }), 15000, "Wallet did not return an account.") as string[];
  const from = accounts?.[0];
  if (!/^0x[a-fA-F0-9]{40}$/.test(from || "")) throw new Error("No valid Testnet wallet account is available.");
  const balance = BigInt(String(await walletTimeout(provider.request({ method: "eth_getBalance", params: [from, "latest"] }), 15000, "Wallet did not return its BNB balance.")));
  if (balance < 1000000000000000n) throw new Error("At least 0.001 BNB is required for BSC Testnet gas.");
  const request = { from, to: tx.to, ...(tx.data ? { data: tx.data } : {}), ...(tx.value ? { value: tx.value } : {}) };
  await walletTimeout(provider.request({ method: "eth_estimateGas", params: [request] }), 20000, "Testnet transaction preflight failed.");
  const hash = String(await walletTimeout(provider.request({ method: "eth_sendTransaction", params: [request] }), 60000, "Wallet did not return the transaction hash."));
  const started = Date.now();
  while (Date.now() - started < 180000) {
    const receipt = await walletTimeout(provider.request({ method: "eth_getTransactionReceipt", params: [hash] }), 15000, "Testnet RPC did not return the receipt.") as null | { status?: string; blockNumber?: string; logs?: Array<{ address?: string; topics?: string[]; data?: string }> };
    if (receipt) {
      if (String(receipt.status || "").toLowerCase() !== "0x1") throw new Error("The Testnet transaction reverted.");
      if (!receipt.blockNumber) throw new Error("Confirmed Testnet transaction has no block number.");
      return { hash, blockNumber: BigInt(receipt.blockNumber).toString(), logs: (receipt.logs || []).map((log) => ({ address: log.address || "", topics: (log.topics || []) as readonly `0x${string}`[], data: (log.data || "0x") as `0x${string}` })) };
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2500));
  }
  throw new Error("Testnet transaction confirmation timed out.");
}

function Info({ title, value, mono = false, green = false }: { title: string; value: string; mono?: boolean; green?: boolean }) {
  return <div className="border border-line rounded-[12px_7px_13px_8px] bg-paper p-3.5"><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1.5">{title}</small><strong className={`${mono ? "font-mono text-[11px] leading-relaxed" : "font-display text-[15px]"} ${green ? "text-green" : ""}`}>{value}</strong></div>;
}

const stepDescriptions: Record<string, string> = {
  create: "Registers the escrow job. The confirmed receipt supplies the real job ID.",
  register: "Registers the confirmed job against the Testnet policy.",
  set_budget: "Applies the accepted provider quote as the job budget.",
  approve: "Approves the payment token only when the existing allowance is insufficient.",
  fund: "Moves the same accepted quote amount into escrow and makes the job FUNDED.",
};

export default function MarketplaceWorkspace() {
  const [goal, setGoal] = useState(examples[0]);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [selected, setSelected] = useState<Match | null>(null);
  const [cap, setCap] = useState<CapResponse | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [yieldText, setYieldText] = useState("");
  const [mission, setMission] = useState<MissionResponse | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [prepared, setPrepared] = useState<PreparedResponse | null>(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [prepareLoading, setPrepareLoading] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState("");
  const [ttl, setTtl] = useState(0);
  const [chainJobId, setChainJobId] = useState("");
  const [confirmed, setConfirmed] = useState<Record<string, Receipt>>({});
  const [signError, setSignError] = useState("");

  const intent = useMemo(() => parseMarketplaceIntent(goal), [goal]);
  const best = selected || result?.bestHireableMatch || result?.bestMatch;
  const inputs = cap?.capability.inputs || [];
  const requiredInputs = inputs.filter((input) => input.required !== false);
  const plan = useMemo(() => prepared ? buildErc8183Plan(prepared, chainJobId || undefined) : [], [prepared, chainJobId]);
  const requiredPlan = useMemo(() => plan.filter((item) => item.transaction || item.id === "approve"), [plan]);
  const complete = useMemo(() => requiredPlan.every((item) => item.id === "approve" && !item.transaction ? true : Boolean(confirmed[item.id])), [requiredPlan, confirmed]);

  useEffect(() => {
    if (!quote?.quote.expires_at) return;
    const tick = () => setTtl(Math.max(0, Math.floor((new Date(quote.quote.expires_at).getTime() - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [quote?.quote.expires_at]);

  useEffect(() => {
    if (new URLSearchParams(location.search).get("funded") === "1") setStep(6);
  }, []);

  async function findAgent() {
    setLoading(true); setError("");
    try {
      const next = await read(await fetch("/api/testnet/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal }) })) as MatchResponse;
      const chosen = next.bestHireableMatch || next.bestMatch;
      if (!chosen) throw new Error("No suitable Testnet agent found.");
      const capability = await read(await fetch(`/api/testnet/capabilities?agent_id=${encodeURIComponent(chosen.agent.agent_id)}`, { credentials: "include" })) as CapResponse;
      setResult(next);
      setSelected(chosen);
      setCap(capability);
      setParams({});
      setYieldText("");
      setMission(null);
      setQuote(null);
      setStep(2);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to resolve agent capability");
      setResult(null);
      setSelected(null);
      setCap(null);
    } finally { setLoading(false); }
  }

  function structuredParameters() {
    const output: Record<string, unknown> = { ...(cap?.capability.defaults || {}) };
    for (const input of inputs) {
      if (input.type === "opportunities") {
        output[input.name] = yieldText.split(/\n+/).map((row) => row.trim()).filter(Boolean).map((row) => {
          const [protocol = "", market = "", apr = "", target = ""] = row.split("|").map((value) => value.trim());
          return { protocol, market, apr: Number(apr), target };
        }).filter((row) => row.protocol && row.market && Number.isFinite(row.apr));
        continue;
      }
      const value = params[input.name];
      if (value === undefined || value === null || value === "") continue;
      if (input.type === "number" || input.type === "integer") output[input.name] = Number(value);
      else if (input.type === "boolean") output[input.name] = value === true || value === "true";
      else output[input.name] = value;
    }
    return output;
  }

  function validateParameters(parameters: Record<string, unknown>) {
    for (const input of requiredInputs) {
      const value = parameters[input.name];
      if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) throw new Error(`${input.label || human(input.name)} is required.`);
      if ((input.type === "number" || input.type === "integer") && (!Number.isFinite(Number(value)) || (input.type === "integer" && !Number.isInteger(Number(value))))) throw new Error(`${input.label || human(input.name)} must be a valid ${input.type}.`);
      if (input.type === "boolean" && typeof value !== "boolean") throw new Error(`${input.label || human(input.name)} must be true or false.`);
    }
  }

  async function getQuote() {
    if (!best) return;
    if (!best.hireability?.canCreateJob) { setError(best.hireability?.reason || "This provider is not ready to accept jobs."); return; }
    setLoading(true); setError("");
    try {
      const authBody = await read(await fetch("/api/auth/me", { credentials: "include" }));
      if (!authBody?.user) throw new Error("Connect and sign in with your Testnet wallet first.");
      const parameters = structuredParameters();
      validateParameters(parameters);
      if (!best.agent.id) throw new Error("Selected provider is missing its marketplace database id");
      const created = await read(await fetch("/api/missions", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal, agent_id: best.agent.agent_id, budget: 0, parameters }) })) as MissionResponse;
      setMission(created);
      const quoted = await read(await fetch("/api/testnet/quotes", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal, agent_id: best.agent.id, parameters, mission_id: created.mission.id }) })) as QuoteResponse;
      setQuote(quoted);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create the provider quote"); }
    finally { setLoading(false); }
  }

  async function acceptQuote() {
    if (!quote?.quote.quote_id) return;
    setQuoteLoading(true); setError("");
    try {
      const next = await read(await fetch("/api/testnet/quotes", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", quote_id: quote.quote.quote_id }) })) as QuoteResponse;
      setQuote(next);
      setStep(4);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to accept quote"); }
    finally { setQuoteLoading(false); }
  }

  async function prepare() {
    if (!quote?.quote.quote_id || !mission?.mission.id) return;
    setPrepareLoading(true); setError("");
    try {
      const auth = await read(await fetch("/api/auth/me", { credentials: "include" }));
      if (!auth?.user?.wallet_address) throw new Error("Connect and sign in with your Testnet wallet first.");
      const next = await read(await fetch("/api/testnet/prepare-quote", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission_id: mission.mission.id, quote_id: quote.quote.quote_id, client_address: auth.user.wallet_address }) })) as PreparedResponse;
      setPrepared(next);
      setConfirmed({});
      setChainJobId("");
      setSignError("");
      setStep(5);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to prepare the accepted quote"); }
    finally { setPrepareLoading(false); }
  }

  async function syncReceipt(stepItem: Erc8183PlanStep, receipt: Receipt) {
    if (!mission) throw new Error("Mission context is missing.");
    const response = await fetch("/api/testnet/erc8183", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync_receipt", mission_id: mission.mission.id, job_id: mission.job.id, phase: stepItem.id, tx_hash: receipt.hash, chain_job_id: chainJobId || undefined }) });
    const body = await response.json() as { ok?: boolean; error?: string; job?: { chain_job_id?: number | null }; onchain_job?: { id?: string } | null };
    if (!response.ok) throw new Error(body.error || "Testnet receipt synchronization failed");
    setConfirmed((current) => ({ ...current, [stepItem.id]: receipt }));
    if (stepItem.id === "create") {
      const discovered = body.job?.chain_job_id ?? body.onchain_job?.id;
      if (discovered != null) setChainJobId(String(discovered));
    }
  }

  async function signNextStep() {
    if (!prepared || signing) return;
    setSigning(true); setSignError("");
    try {
      await connectTestnetWallet();
      let activePlan = buildErc8183Plan(prepared, chainJobId || undefined);
      let next = activePlan.find((item) => !confirmed[item.id] && item.transaction);
      if (!next) {
        const approval = activePlan.find((item) => item.id === "approve");
        if (approval && !approval.transaction && !confirmed.approve) setConfirmed((current) => ({ ...current, approve: { hash: "skipped", blockNumber: "—", logs: [] } }));
        activePlan = buildErc8183Plan(prepared, chainJobId || undefined);
        next = activePlan.find((item) => !confirmed[item.id] && item.transaction);
      }
      if (!next?.transaction) { setStep(complete ? 6 : 5); return; }
      await syncReceipt(next, await sendAndConfirm(next.transaction));
    } catch (cause) {
      setSignError(cause instanceof Error ? cause.message : "Testnet wallet signing failed");
    } finally { setSigning(false); }
  }

  useEffect(() => { if (step === 5 && complete) setStep(6); }, [step, complete]);

  const labels = ["Goal", "Match", "Quote", "Mission", "Sign", "Fund"];
  const mins = Math.floor(ttl / 60); const secs = String(ttl % 60).padStart(2, "0");
  const scoreRows = best ? Object.entries(best.breakdown) : [];

  return (
    <main className="max-w-[1240px] mx-auto px-6 md:px-8 py-8 relative font-body text-ink">
      <section className="flex items-center justify-between mb-5"><span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Create mission / Hiring flow</span><button className="text-[11px] font-bold text-inksoft hover:text-ink" type="button" onClick={() => location.assign("/dashboard")}>✕ Close</button></section>
      {error && <div className="mb-4 border border-[#cfad9f] bg-rustsoft text-rust rounded-[14px_8px_15px_9px] px-4 py-3 text-[12px]">{error}</div>}
      <div className="flex items-center gap-0 mb-8 overflow-x-auto">{labels.map((label, i) => { const n = i + 1; return <div key={label} className={`flex items-center ${n === labels.length ? "" : "flex-1"} min-w-[86px]`}><div className="flex flex-col items-center shrink-0"><div className={`w-7 h-7 rounded-full flex items-center justify-center font-mono text-[10.5px] font-bold ${n <= step ? "bg-ink text-paperhi" : "bg-linesoft text-inksoft"} ${n === step ? "ring-2 ring-brass ring-offset-2 ring-offset-paper" : ""}`}>{n}</div><span className={`font-mono text-[8.5px] uppercase tracking-wide mt-1.5 ${n <= step ? "text-ink" : "text-[#9aa3b1]"}`}>{label}</span></div>{n !== labels.length && <div className={`flex-1 h-[2px] mx-2 mb-4 ${n < step ? "bg-brass" : "bg-linesoft"}`} />}</div>; })}</div>

      <div className="bg-paperhi border border-line card-asym-lg p-6 md:p-8 min-h-[420px]">
        {step === 1 && <>
          <span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-brass mb-3"><span className="w-1.5 h-1.5 rounded-full bg-brass" />Step 1 / 6 · Intent</span>
          <h2 className="font-display text-[24px] font-bold tracking-tight mb-2">State the outcome you want.</h2>
          <p className="text-[13px] text-inksoft mb-5 max-w-[560px]">Describe the outcome first. The marketplace matches an agent, then asks only the required inputs that agent declares.</p>
          <div className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-4 mb-4"><small className="block font-mono text-[9px] uppercase text-[#8a8477] mb-2">Your goal</small><textarea value={goal} onChange={(e) => setGoal(e.target.value)} className="w-full bg-transparent font-display text-[17px] font-semibold resize-none outline-none" rows={2} /></div>
          <div className="grid sm:grid-cols-3 gap-3 mb-6"><Info title="Category" value={categoryLabel(intent.category)} /><Info title="Risk profile" value={intent.risk} /><Info title="Keywords" value={goal.toLowerCase().split(/\s+/).filter((w) => w.length >= 4).slice(0, 6).join(" · ") || "—"} mono /></div>
          <button disabled={loading} type="button" onClick={() => void findAgent()} className="font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym">{loading ? "Finding…" : "Find matching agents →"}</button>
        </>}

        {step === 2 && <>
          <span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-brass mb-3"><span className="w-1.5 h-1.5 rounded-full bg-brass" />Step 2 / 6 · Explainable match</span>
          <h2 className="font-display text-[24px] font-bold tracking-tight mb-1">Top fit, with a paper trail.</h2>
          <p className="text-[13px] text-inksoft mb-5 max-w-[560px]">Weighted, transparent scoring — capability 35 · availability 15 · verification 15 · reputation 15 · completion 10 · liveness 10.</p>
          {best ? <>
            <div className="border border-brass/40 bg-brasssoft/60 rounded-[18px_9px_20px_10px] p-5 mb-4">
              <div className="flex justify-between items-start mb-4"><div><small className="block font-mono text-[8.5px] uppercase text-brass mb-1">Best fit</small><strong className="font-display text-[19px] font-bold">{best.agent.name || `Agent #${best.agent.agent_id}`}</strong><div className="text-[11.5px] text-inksoft mt-0.5">{best.agent.description || categoryLabel(best.agent.category)}</div></div><div className="w-16 h-16 rounded-full border-2 border-brass flex flex-col items-center justify-center bg-paperhi shrink-0"><b className="font-display text-[19px] font-bold leading-none">{Math.round(best.score)}</b><span className="text-[8px] text-inksoft">/ 100</span></div></div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-2.5 mb-4">{scoreRows.map(([key, value]) => { const max = ({ capability: 35, availability: 15, verification: 15, reputation: 15, completion: 10, liveness: 10 } as Record<string, number>)[key] || 1; const pct = Math.max(0, Math.min(100, Number(value) / max * 100)); return <div key={key}><div className="flex justify-between text-[10px] mb-1"><span className="text-inksoft">{human(key)}</span><b className="font-mono">{value}/{max}</b></div><i className="block h-[3px] bg-linesoft rounded-full overflow-hidden"><u className="block h-full bg-brass" style={{ width: `${pct}%` }} /></i></div>; })}</div>
              <div className="flex flex-wrap gap-2">{(best.reasons || []).slice(0, 4).map((reason) => <span key={reason} className="font-mono text-[9.5px] px-2.5 py-1 rounded-full bg-paperhi border border-line text-inksoft">{reason}</span>)}</div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 mb-6">{(result?.alternatives || []).slice(0, 2).map((alternative) => <div key={alternative.agent.agent_id} className="border border-line rounded-[14px_8px_16px_9px] p-4"><div className="flex justify-between items-center mb-1"><strong className="text-[13px] font-bold">{alternative.agent.name || `Agent #${alternative.agent.agent_id}`}</strong><span className="font-mono text-[11px] text-inksoft">{Math.round(alternative.score)}</span></div><div className="text-[10.5px] text-inksoft">{alternative.reasons?.[0] || "Alternative match"}</div></div>)}</div>
            <div className="flex gap-3"><button type="button" onClick={() => setStep(3)} disabled={!cap || !best.hireability?.canCreateJob} className="font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym">Continue to task inputs <span className="text-brasslt">→</span></button><button type="button" onClick={() => setStep(1)} className="font-bold text-[12px] px-4 py-3 text-inksoft">← Back</button></div>
          </> : <div className="py-10 text-[13px] text-inksoft">No suitable Testnet agent found.</div>}
        </>}

        {step === 3 && best && !quote && <>
          <span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-brass mb-3"><span className="w-1.5 h-1.5 rounded-full bg-brass" />Step 3 / 6 · Agent task questions</span>
          <h2 className="font-display text-[24px] font-bold tracking-tight mb-1">Confirm the inputs this agent requires.</h2>
          <p className="text-[13px] text-inksoft mb-5 max-w-[560px]">These questions come from the selected agent's published capability schema. Only inputs declared as required by that provider are requested.</p>
          <div className="border border-brass/40 bg-brasssoft/60 rounded-[18px_9px_20px_10px] p-5 mb-5"><strong className="font-display text-[18px]">{best.agent.name || best.agent.agent_id}</strong><div className="text-[11px] text-inksoft mt-1">Provider wallet: {compact(cap?.agent.owner)}</div></div>
          {requiredInputs.length === 0 ? <div className="border border-line rounded-[14px] bg-paper p-4 mb-5 text-[12px] text-inksoft">This agent declares no required task inputs. Continue to quote using its published defaults.</div> : <div className="border border-line rounded-[14px] bg-paper p-4 mb-5"><div className="grid sm:grid-cols-2 gap-4">{requiredInputs.map((input) => input.type === "opportunities" ? <div key={input.name} className="sm:col-span-2"><label className="font-mono text-[9px] uppercase block mb-1">{input.label || human(input.name)} · required</label><textarea rows={5} value={yieldText} onChange={(e) => setYieldText(e.target.value)} placeholder="Enter the value in the format published by this agent" className="w-full border border-line rounded-[10px] bg-paperhi p-3 text-[12px]"/><small className="block text-[10px] text-inksoft mt-1">{input.help || ""}</small></div> : input.type === "boolean" ? <label key={input.name} className="flex items-center gap-3 border border-line rounded-[10px] bg-paperhi p-3 text-[12px]"><input type="checkbox" checked={params[input.name] === true || params[input.name] === "true"} onChange={(e) => setParams((current) => ({ ...current, [input.name]: e.target.checked }))} /><span><span className="font-mono text-[9px] uppercase block">{input.label || human(input.name)} · required</span>{input.help && <small className="text-[10px] text-inksoft">{input.help}</small>}</span></label> : <div key={input.name}><label className="font-mono text-[9px] uppercase block mb-1">{input.label || human(input.name)} · required</label><input type={input.type === "number" || input.type === "integer" ? "number" : "text"} step={input.type === "integer" ? 1 : "any"} value={String(params[input.name] ?? "")} onChange={(e) => setParams((current) => ({ ...current, [input.name]: e.target.value }))} className="w-full border border-line rounded-[10px] bg-paperhi p-3 text-[12px]"/>{input.help && <small className="block text-[10px] text-inksoft mt-1">{input.help}</small>}</div>)}</div></div>}
          <div className="flex gap-3"><button type="button" disabled={loading} onClick={() => void getQuote()} className="font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym">{loading ? "Getting quote…" : "Confirm inputs & get quote →"}</button><button type="button" onClick={() => setStep(2)} className="font-bold text-[12px] px-4 py-3 text-inksoft">← Back</button></div>
        </>}

        {step === 3 && quote && <>
          <span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-brass mb-3"><span className="w-1.5 h-1.5 rounded-full bg-brass" />Step 3 / 6 · Provider quote</span>
          <h2 className="font-display text-[24px] font-bold tracking-tight mb-1">The agent sets the price.</h2>
          <p className="text-[13px] text-inksoft mb-5 max-w-[560px]">The structured task inputs above are now part of the quote request for this exact goal.</p>
          <div className="border border-line rounded-[18px_9px_20px_10px] overflow-hidden mb-6 bg-paper"><div className="flex justify-between items-center px-5 py-3 dash-b"><span className="font-mono text-[9px] uppercase text-[#8a8477]">marketplace_quotes</span><span className={`inline-block font-mono text-[9.5px] px-2.5 py-1 rounded-lg ${quote.quote.status === "accepted" ? "status-green" : "status-brass"}`}>{human(quote.quote.status)}</span></div><div className="grid sm:grid-cols-2 gap-4 p-5"><Info title="Quoted price" value={`${quote.quote.price} ${quote.quote.currency}`} mono /><Info title="Provider wallet" value={compact(quote.provider?.wallet_address)} mono /><Info title="Provider signature" value={quote.signature_present ? "Present ✓" : "Not present"} green /><Info title="Expires" value={ttl > 0 ? `in ${mins}:${secs}` : "expired"} /></div><div className="px-5 py-3 dash-t text-[10.5px] text-inksoft">Endpoint negotiation: <code className="font-mono text-[10.5px] bg-paperhi px-1 rounded">provider-declared quote operation</code> · live provider quote</div></div>
          <div className="flex gap-3"><button type="button" disabled={quoteLoading || ttl <= 0 || quote.quote.status === "accepted"} onClick={() => void acceptQuote()} className="font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym">{quoteLoading ? "Accepting…" : quote.quote.status === "accepted" ? "Quote accepted" : "Accept quote →"}</button><button type="button" onClick={() => { setQuote(null); setMission(null); }} className="font-bold text-[12px] px-4 py-3 text-inksoft">Edit inputs</button></div>
        </>}

        {step === 4 && mission && quote && <>
          <span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-brass mb-3"><span className="w-1.5 h-1.5 rounded-full bg-brass" />Step 4 / 6 · Mission</span>
          <h2 className="font-display text-[24px] font-bold tracking-tight mb-1">Mission created.</h2>
          <p className="text-[13px] text-inksoft mb-5 max-w-[560px]">The accepted quote carries the same structured task inputs into the mission workflow.</p>
          <div className="border border-line rounded-[18px_9px_20px_10px] p-5 mb-6 bg-paper"><div className="grid sm:grid-cols-2 gap-4 mb-4"><Info title="Title" value={mission.mission.title || `${selected?.agent.name || "Agent"} mission`} /><Info title="Category" value={human(mission.mission.category || intent.category)} /><Info title="Assigned agent" value={selected?.agent.name || "Provider"} /><Info title="Budget (from accepted quote)" value={`${quote.quote.price} ${quote.quote.currency}`} mono /></div><div className="flex justify-between items-end pt-4 dash-t"><div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Status</small><span className="inline-block font-mono text-[9.5px] px-2.5 py-1 rounded-lg status-brass">Open — not yet funded</span></div><span className="font-mono text-[9.5px] text-[#9aa3b1]">quote_id: {compact(quote.quote.quote_id)}</span></div></div>
          <div className="flex gap-3"><button type="button" onClick={() => void prepare()} disabled={prepareLoading || quote.quote.status !== "accepted"} className="font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym">{prepareLoading ? "Preparing…" : "Prepare ERC-8183 job →"}</button><button type="button" onClick={() => setStep(3)} className="font-bold text-[12px] px-4 py-3 text-inksoft">← Back</button></div>
        </>}

        {step === 5 && prepared && <>
          <span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-brass mb-3"><span className="w-1.5 h-1.5 rounded-full bg-brass" />Step 5 / 6 · ERC-8183 preparation</span>
          <h2 className="font-display text-[24px] font-bold tracking-tight mb-1">Your wallet signs five steps.</h2>
          <p className="text-[13px] text-inksoft mb-5 max-w-[560px]">Nothing is custodied. Each line is a real wallet transaction, confirmed on BSC Testnet before the next dependent step unlocks.</p>
          <div className="border border-line rounded-[18px_9px_20px_10px] overflow-hidden mb-6">{plan.map((item, index) => { const skipped = item.id === "approve" && !item.transaction; const isDone = Boolean(confirmed[item.id]) || skipped; return <div key={item.id} className={`flex items-center gap-3 p-4 ${index < plan.length - 1 ? "dash-b" : ""} bg-paper`}><span className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${isDone ? "bg-green border-green text-white" : "border-line"}`}>{isDone ? "✓" : ""}</span><div><strong className="block font-mono text-[12px] font-medium">{item.label}</strong><span className="block text-[10.5px] text-inksoft">{stepDescriptions[item.id] || item.description}</span>{skipped && <small className="block mt-1 font-mono text-[8.5px] uppercase text-green">Already covered · no wallet prompt</small>}</div></div>; })}</div>
          {signError && <div className="mb-4 border border-[#cfad9f] bg-rustsoft text-rust rounded-[14px_8px_15px_9px] px-4 py-3 text-[11px]">{signError}</div>}
          <div className="flex gap-3"><button type="button" onClick={() => void signNextStep()} disabled={signing || complete} className="font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym">{signing ? "Signing in wallet…" : complete ? "Continue →" : "Sign in wallet →"}</button><button type="button" onClick={() => setStep(4)} className="font-bold text-[12px] px-4 py-3 text-inksoft">← Back</button></div>
        </>}

        {step === 6 && <>
          <span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-green mb-3"><span className="w-1.5 h-1.5 rounded-full bg-green" />Step 6 / 6 · Chain receipt</span>
          <h2 className="font-display text-[24px] font-bold tracking-tight mb-1">Funded, on-chain.</h2>
          <p className="text-[13px] text-inksoft mb-5 max-w-[560px]">The receipt was confirmed before the mission moved into Fund. The application now follows the real ERC-8183 job state.</p>
          <div className="border border-line rounded-[18px_9px_20px_10px] p-5 mb-6 bg-paper grid sm:grid-cols-2 gap-4"><Info title="Chain job ID" value={chainJobId ? `#${chainJobId}` : "Confirmed"} mono /><Info title="Status" value="Funded" green /><Info title="Network" value="BSC Testnet · Chain 97" /><Info title="Notified" value={selected?.agent.name || "Provider agent"} /></div>
          <p className="text-[11.5px] text-inksoft mb-4 max-w-[520px]">From here the job lives in the provider's hands. Track its progress on the mission's own page — the same one you'd open from Missions.</p>
          <div className="flex gap-3"><button type="button" onClick={() => location.assign(`/missions`)} className="font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym">Go to Missions →</button><button type="button" onClick={() => location.assign(`/mission?job=${encodeURIComponent(mission?.job.id || "")}`)} className="font-bold text-[12px] px-4 py-3 text-inksoft">Watch provider progress</button></div>
        </>}
      </div>
    </main>
  );
}
