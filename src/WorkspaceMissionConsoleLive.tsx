import { useCallback, useEffect, useMemo, useState } from "react";
import type { EIP1193Provider, Hex } from "viem";
import {
  bscExplorerUrl,
  claimRefundJob,
  disputeJob,
  readPolicyConfig,
  readPolicyVerdict,
  settleJob,
} from "./lib/erc8183Adapter";

type JobView = {
  job: { id: string; status: string; description: string; budget: number | string; chain_job_id: number | null; deliverable: string | null; chain_live?: boolean };
  task: { id: string; status: string; title: string; role: string; description?: string | null } | null;
  mission: { id: string; title: string; goal: string; status: string; category: string } | null;
  evaluation: { verdict: string; notes: string | null; evidence?: { source?: string; decision?: string; reasons?: string[] } | null } | null;
  payment: { amount: number | string; status?: string; tx_hash?: string | null; token_symbol: string | null } | null;
  chain: { chain_job_id: number; chain_status: string; chain_provider: string; chain_evaluator: string; chain_description: string; chain_budget_raw: string; chain_budget: string; token_address: string; token_symbol: string; token_decimals: number; chain_expired_at: number; chain_submitted_at: string | null; chain_deliverable: string | null } | null;
  network: string;
  chain_id: number;
  source_of_truth: string;
};

type JobResult = {
  ok?: boolean; content?: unknown; submitted_at?: number | string | null; onchain_deliverable_hash?: string | null; computed_deliverable_hash?: string | null; verified?: boolean; evidence_source?: string | null; captured_at?: string | null; agent_name?: string | null; endpoint?: string | null; error?: string;
};

type PolicyState = { disputeWindow: bigint; voteQuorum: bigint; verdict: bigint | null };

const STEPS = ["open", "funded", "accepted", "in_progress", "submitted"] as const;
const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
function statusTone(value: string) { const lower = value.toLowerCase(); if (["completed", "terminal", "settled"].includes(lower)) return "green"; if (["rejected", "cancelled", "expired", "disputed"].includes(lower)) return "rust"; return "brass"; }
function Status({ value }: { value: string }) { return <span className={`font-mono text-[9.5px] rounded-lg px-2.5 py-1 status-${statusTone(value)}`}>{human(value)}</span>; }
function Lifecycle({ status }: { status: string }) { const normalized = status.toLowerCase(); const current = STEPS.indexOf(normalized as typeof STEPS[number]); const terminal = ["completed", "rejected", "expired", "terminal"].includes(normalized); const activeIndex = terminal ? STEPS.length - 1 : current; return (<div className="grid grid-cols-2 sm:grid-cols-5 overflow-hidden rounded-[14px] bg-deep">{STEPS.map((step, index) => { const active = activeIndex >= 0 && index <= activeIndex; const isCurrent = !terminal && normalized === step; return (<div key={step} className="border-r border-white/10 last:border-r-0 p-3.5 min-w-0"><span className={`block font-mono text-[8px] uppercase truncate ${active ? "text-brasslt" : "text-[#726f60]"}`}>{human(step)}</span><i className={`block w-2 h-2 rounded-full mt-2 ${active ? "bg-brasslt" : "bg-[#3a3a30]"} ${isCurrent ? "shadow-[0_0_0_3px_rgba(210,176,94,.22)]" : ""}`} /></div>); })}</div>); }
function shortenHash(value: string | null | undefined) { if (!value) return "—"; if (value.length <= 18) return value; return `${value.slice(0, 10)}…${value.slice(-8)}`; }
function formatBudget(value: number | string | null | undefined, symbol: string) { if (value === null || value === undefined || value === "") return `0 ${symbol}`; const numeric = Number(value); if (!Number.isFinite(numeric)) return `${value} ${symbol}`; return `${numeric.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${symbol}`; }
function formatTime(seconds: number) { const safe = Math.max(0, Math.floor(seconds)); const hours = Math.floor(safe / 3600); const minutes = Math.floor((safe % 3600) / 60); const secs = safe % 60; if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`; return `${minutes}:${String(secs).padStart(2, "0")}`; }
function asTimestampSeconds(value: number | string | null | undefined) { if (value === null || value === undefined || value === "") return null; const numeric = Number(value); if (!Number.isFinite(numeric)) { const parsed = Date.parse(String(value)); return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null; } return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric); }
function resultContent(value: unknown) { if (value === null || value === undefined || value === "") return ""; if (typeof value === "string") return value; try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
function policyVerdictLabel(verdict: bigint | null) { if (verdict === null) return "pending"; if (verdict === 1n) return "approve"; if (verdict === 2n) return "reject"; return `verdict_${verdict.toString()}`; }

export default function WorkspaceMissionConsole() {
  const [jobId] = useState(() => new URLSearchParams(window.location.search).get("job") || "");
  const [data, setData] = useState<JobView | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [policy, setPolicy] = useState<PolicyState | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [workingAction, setWorkingAction] = useState<"dispute" | "settle" | "refund" | "">("");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [txHash, setTxHash] = useState<string>("");

  const load = useCallback(async () => {
    if (!jobId) return;
    setRefreshing(true);
    try {
      const response = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`, { credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Unable to load job");
      const nextData = body as JobView;
      setData(nextData);
      setError("");
      const chainJobId = nextData.chain?.chain_job_id ?? nextData.job.chain_job_id;
      const submitted = nextData.chain?.chain_status?.toLowerCase() === "submitted" || nextData.job.status?.toLowerCase() === "submitted";
      if (chainJobId && submitted) {
        try {
          const resultResponse = await fetch(`/api/testnet/job-result?job=${encodeURIComponent(String(chainJobId))}`, { credentials: "include" });
          const resultBody = await resultResponse.json();
          if (resultResponse.ok) setResult(resultBody as JobResult); else setResult(null);
        } catch { setResult(null); }
        try {
          const config = await readPolicyConfig();
          let verdict: bigint | null = null;
          try { verdict = BigInt(await readPolicyVerdict(BigInt(chainJobId))); } catch { verdict = null; }
          setPolicy({ disputeWindow: BigInt(config.disputeWindow), voteQuorum: BigInt(config.voteQuorum), verdict });
        } catch { setPolicy(null); }
      } else { setResult(null); setPolicy(null); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load job"); }
    finally { setRefreshing(false); }
  }, [jobId]);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 10_000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => window.clearInterval(timer); }, []);

  const liveStatus = data?.chain?.chain_status?.toLowerCase() || data?.job.status?.toLowerCase() || "open";
  const submitted = liveStatus === "submitted";
  const terminal = ["completed", "rejected", "cancelled", "expired", "terminal"].includes(liveStatus);
  const tokenSymbol = data?.chain?.token_symbol || data?.payment?.token_symbol || "tBNB";
  const budget = data?.chain?.chain_budget ?? data?.job.budget ?? data?.payment?.amount ?? 0;
  const deliverable = data?.chain?.chain_deliverable || data?.job.deliverable;
  const content = resultContent(result?.content);
  const submittedAt = asTimestampSeconds(result?.submitted_at ?? data?.chain?.chain_submitted_at);
  const disputeWindowSeconds = policy ? Number(policy.disputeWindow) : null;
  const disputeDeadline = submittedAt !== null && disputeWindowSeconds !== null ? submittedAt + disputeWindowSeconds : null;
  const remaining = disputeDeadline === null ? null : Math.max(disputeDeadline - now, 0);
  const disputeOpen = submitted && remaining !== null && remaining > 0;
  const disputeExpired = submitted && remaining !== null && remaining <= 0;
  // Let the user press Settle whenever the job is SUBMITTED. The contract remains the authority: pending-policy calls are simulated first and will not open a wallet prompt unless settle is actually eligible.
  const settlementReady = submitted;
  const refundReady = submitted && disputeExpired && policy?.verdict === 0n;
  const lifecycleCopy = useMemo(() => { if (!data) return "Reading the live job record…"; if (data.source_of_truth === "erc8183_commerce") return "State is read from the ERC-8183 commerce contract on BSC Testnet. The console never simulates lifecycle transitions."; return "Live chain state is unavailable, so the marketplace workflow record is shown as a fallback."; }, [data]);

  async function walletAccount() {
    const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
    if (!provider) throw new Error("A browser wallet is required for this action.");
    const chainId = await provider.request({ method: "eth_chainId" });
    if (String(chainId).toLowerCase() !== "0x61") throw new Error("Switch your wallet to BSC Testnet (chain 97) first.");
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const account = Array.isArray(accounts) ? accounts[0] : undefined;
    if (!account || typeof account !== "string") throw new Error("Connect the client wallet to continue.");
    return { provider, account: account as `0x${string}` };
  }
  async function runPolicyAction(action: "dispute" | "settle" | "refund") {
    const chainJobId = data?.chain?.chain_job_id ?? data?.job.chain_job_id;
    if (!chainJobId) return;
    setWorkingAction(action); setError(""); setTxHash("");
    try {
      const { provider, account } = await walletAccount();
      const args = { jobId: BigInt(chainJobId), providerWallet: provider, account };
      const response = action === "dispute" ? await disputeJob(args) : action === "settle" ? await settleJob(args) : await claimRefundJob(args);
      setTxHash(response.hash as Hex); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : `Unable to ${action} job`); }
    finally { setWorkingAction(""); }
  }

  if (!jobId) return (<main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8"><section className="card-asym-lg bg-paperhi p-7 md:p-8"><span className="font-mono text-[9.5px] uppercase tracking-widest text-brass">MISSIONS / CONSOLE</span><h1 className="mt-3 font-display text-[30px] font-bold tracking-tight">No mission selected.</h1><p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-inksoft">Open the console from the Missions page so the live marketplace job record can be loaded.</p><a href="/missions" className="btn-asym mt-5 inline-flex bg-ink px-5 py-3 font-display text-[12px] font-bold text-paperhi no-underline">Back to missions →</a></section></main>);

  return (<main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8">
    <div className="flex items-center justify-between gap-4 mb-5"><span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Missions / Mission console</span><a href="/missions" className="text-[11px] font-bold text-inksoft no-underline hover:text-ink">← Back to missions</a></div>
    {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust break-words">{error}</div>}
    {!data ? <section className="card-asym-lg bg-paperhi p-7 text-[13px] text-inksoft">Loading mission state…</section> : <section className="card-asym-lg bg-paperhi p-6 md:p-8">
      <div className="grid sm:grid-cols-2 gap-4 mb-6 pb-6 dash-b"><div className="min-w-0"><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Mission</small><strong className="block text-[15px] font-bold break-words">{data.mission?.title || "Agent mission"}</strong></div><div className="min-w-0"><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Agent</small><strong className="block text-[15px] font-bold break-words">{data.task?.role || "Provider"}</strong></div><div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Chain job ID</small><strong className="font-mono text-[14px]">{data.chain?.chain_job_id ? `#${data.chain.chain_job_id}` : data.job.chain_job_id == null ? "Not created" : `#${data.job.chain_job_id}`}</strong></div><div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Budget</small><strong className="font-mono text-[14px]">{formatBudget(budget, tokenSymbol)}</strong></div></div>
      <div className="mb-6 rounded-[16px_8px_18px_9px] border border-line bg-paper p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Live source</small><strong className="font-display text-[14px] font-bold">{data.source_of_truth === "erc8183_commerce" ? "ERC-8183 Commerce · BSC Testnet" : "Marketplace workflow fallback"}</strong></div><div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green"/><span className="font-mono text-[9.5px] uppercase text-green">CHAIN 97 VERIFIED</span></div></div></div>
      <span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-brass mb-3"><span className="w-1.5 h-1.5 rounded-full bg-brass"/>Job lifecycle</span><p className="text-[13px] text-inksoft mb-5 max-w-[650px]">{lifecycleCopy}</p><div className="mb-6"><Lifecycle status={liveStatus}/></div>
      <div className="grid sm:grid-cols-2 gap-3 mb-6"><div className="border border-line rounded-[14px_8px_16px_9px] p-4 bg-paper"><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1.5">Current status</small><div className="flex items-center gap-2"><Status value={liveStatus}/>{data.chain?.chain_job_id && <span className="font-mono text-[9px] text-inksoft">live</span>}</div></div><div className="border border-line rounded-[14px_8px_16px_9px] p-4 bg-paper"><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1.5">Provider</small><strong className="block font-mono text-[11px] break-all">{shortenHash(data.chain?.chain_provider || null)}</strong></div></div>
      {(data.chain?.chain_submitted_at || deliverable) && <div className="border border-line rounded-[16px_8px_18px_9px] p-4 mb-6 bg-paper"><div className="grid sm:grid-cols-2 gap-4">{data.chain?.chain_submitted_at && <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1.5">Submitted at</small><strong className="text-[12px]">{new Date(data.chain.chain_submitted_at).toLocaleString()}</strong></div>}{deliverable && <div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1.5">Deliverable hash</small><strong className="font-mono text-[11px] break-all">{shortenHash(deliverable)}</strong></div>}</div></div>}
      {submitted && <div className="border border-line rounded-[16px_8px_18px_9px] p-4 mb-6 bg-paper"><div className="flex flex-wrap justify-between items-center gap-3 mb-2"><small className="block font-mono text-[8.5px] uppercase text-[#8a8477]">Agent submission</small>{result && <Status value={result.verified ? "verified" : "pending"}/>}</div>{content ? <pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink">{content}</pre> : <p className="m-0 text-[11.5px] text-inksoft">The provider response is not available yet. The on-chain deliverable hash is preserved above.</p>}{result && <div className="mt-3 pt-3 dash-t flex flex-wrap gap-x-4 gap-y-1 font-mono text-[8.5px] text-[#8a8477]"><span>source: {result.evidence_source || "provider"}</span>{result.agent_name && <span>agent: {result.agent_name}</span>}{result.captured_at && <span>captured: {new Date(result.captured_at).toLocaleString()}</span>}</div>}</div>}
      <div className="flex flex-wrap gap-3 mb-2"><button type="button" className="font-display font-bold text-[12px] px-5 py-3 bg-ink text-paperhi btn-asym disabled:opacity-60" disabled={refreshing} onClick={() => void load()}>{refreshing ? "Checking live state…" : "Refresh live state →"}</button><span className="self-center font-mono text-[9.5px] text-inksoft">Auto-refreshes every 10 seconds</span></div>
      {submitted && <div className="mt-8 pt-8 dash-t"><span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-green mb-3"><span className="w-1.5 h-1.5 rounded-full bg-green"/>Evaluator & settlement</span><h2 className="font-display text-[20px] font-bold tracking-tight mb-1">Verified, then settled.</h2><p className="text-[13px] text-inksoft mb-5 max-w-[650px]">The submitted state has been detected from the live job. Evaluation and settlement remain protocol-controlled rather than simulated by this page.</p>
        <div className="border border-line rounded-[18px_9px_20px_10px] p-5 mb-5 bg-paper"><div className="flex flex-wrap justify-between items-center gap-3 mb-3"><strong className="text-[14px] font-bold">Evaluation verdict</strong><Status value={policyVerdictLabel(policy?.verdict ?? null)}/></div><p className="text-[12px] text-inksoft mb-3">{data.evaluation?.notes || "Awaiting the live evaluator decision."}</p>{policy && <div className="grid sm:grid-cols-2 gap-3 mt-4 pt-4 dash-t"><div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Dispute window</small><strong className="font-mono text-[12px]">{formatTime(disputeWindowSeconds || 0)}</strong></div><div><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Time until decision</small><strong className="font-mono text-[12px]">{remaining === null ? "—" : disputeExpired ? "Window elapsed" : formatTime(remaining)}</strong></div></div>}{data.evaluation?.evidence && <div className="flex flex-wrap gap-2 mt-3">{data.evaluation.evidence.source && <span className="font-mono text-[9px] px-2 py-1 rounded-full border border-line text-inksoft">source: {data.evaluation.evidence.source}</span>}{data.evaluation.evidence.decision && <span className="font-mono text-[9px] px-2 py-1 rounded-full border border-line text-inksoft">decision: {data.evaluation.evidence.decision}</span>}</div>}</div>
        <div className="grid sm:grid-cols-2 gap-3 mb-6"><div className="border border-green/30 bg-greensoft rounded-[14px_8px_16px_9px] p-4"><strong className="block text-[12.5px] font-bold text-green mb-1">settlement</strong><span className="block text-[10.5px] text-inksoft mb-3">{settlementReady ? "The live policy is ready for settlement." : "Settlement becomes available according to the live evaluator verdict and dispute window."}</span><button type="button" className="btn-asym bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi disabled:cursor-not-allowed disabled:opacity-50" disabled={!settlementReady || !!workingAction} onClick={() => void runPolicyAction("settle")}>{workingAction === "settle" ? "Settling…" : "Settle job →"}</button></div><div className="border border-line rounded-[14px_8px_16px_9px] p-4"><strong className="block text-[12.5px] font-bold mb-1">dispute / refund</strong><span className="block text-[10.5px] text-inksoft mb-3">{disputeOpen ? "Open dispute window — client can dispute the submitted result." : refundReady ? "Dispute window elapsed without a verdict — refund is available." : "Dispute is unavailable in the current live policy state."}</span>{disputeOpen && <button type="button" className="btn-asym border border-line bg-paperhi px-4 py-2.5 font-display text-[11px] font-bold text-ink disabled:cursor-not-allowed disabled:opacity-50" disabled={!!workingAction} onClick={() => void runPolicyAction("dispute")}>{workingAction === "dispute" ? "Opening dispute…" : "Dispute submission →"}</button>}{refundReady && <button type="button" className="btn-asym bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi disabled:cursor-not-allowed disabled:opacity-50" disabled={!!workingAction} onClick={() => void runPolicyAction("refund")}>{workingAction === "refund" ? "Claiming refund…" : "Claim refund →"}</button>}</div></div>
        {txHash && <div className="mb-6 rounded-[16px_8px_18px_9px] border border-line bg-paper p-4"><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1.5">Latest policy transaction</small><a className="font-mono text-[10.5px] text-brass break-all" href={bscExplorerUrl(txHash as Hex)} target="_blank" rel="noreferrer">{txHash}</a></div>}
        <div className="border border-line rounded-[16px_8px_18px_9px] p-4 bg-paper flex flex-wrap justify-between gap-4 items-center"><div><strong className="block text-[13px] font-bold">Terminal state</strong><span className="text-[11px] text-inksoft">Payment state and evidence continue to come from the live job record.</span></div><Status value={terminal ? liveStatus : "pending"}/></div>
      </div>}
    </section>}
  </main>);
}
