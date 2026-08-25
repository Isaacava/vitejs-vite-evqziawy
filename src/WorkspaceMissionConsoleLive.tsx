import { useCallback, useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import {
  bscExplorerUrl,
  claimRefundJob,
  disputeJob,
  readPolicyConfig,
  readPolicyVerdict,
  settleJob,
} from "./lib/erc8183Adapter";
import { ensureWalletConnectedProvider } from "./lib/walletAuth";
import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import ExecutionCapitalPanel from "./ExecutionCapitalPanel";

type JobView = {
  job: { id: string; status: string; description: string; budget: number | string; chain_job_id: number | null; deliverable: string | null; chain_live?: boolean };
  task: { id: string; status: string; title: string; role: string; description?: string | null } | null;
  mission: { id: string; title: string; goal: string; status: string; category: string } | null;
  evaluation: { verdict: string; notes: string | null; evidence?: { source?: string; decision?: string; reasons?: string[] } | null } | null;
  payment: { amount: number | string; status?: string; tx_hash?: string | null; token_symbol: string | null } | null;
  execution_capital: ExecutionCapitalRequest | null;
  chain: { chain_job_id: number; chain_status: string; chain_provider: string; chain_evaluator: string; chain_description: string; chain_budget_raw: string; chain_budget: string; token_address: string; token_symbol: string; token_decimals: number; chain_expired_at: number; chain_submitted_at: string | null; chain_deliverable: string | null } | null;
  network: string;
  chain_id: number;
  source_of_truth: string;
};

type JobResult = {
  ok?: boolean;
  content?: unknown;
  submitted_at?: number | string | null;
  onchain_deliverable_hash?: string | null;
  computed_deliverable_hash?: string | null;
  verified?: boolean;
  evidence_source?: string | null;
  captured_at?: string | null;
  agent_name?: string | null;
  endpoint?: string | null;
  error?: string;
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
  const settlementReady = submitted;
  const refundReady = submitted && disputeExpired && policy?.verdict === 0n;
  const lifecycleCopy = useMemo(() => { if (!data) return "Reading the live job record…"; if (data.source_of_truth === "erc8183_commerce") return "State is read from the ERC-8183 commerce contract on BSC Testnet. The console never simulates lifecycle transitions."; return "Live chain state is unavailable, so the marketplace workflow record is shown as a fallback."; }, [data]);

  async function walletAccount() {
    const { provider, address } = await ensureWalletConnectedProvider();
    return { provider, account: address as `0x${string}` };
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
      <ExecutionCapitalPanel request={data.execution_capital} jobBudget={budget} jobCurrency={tokenSymbol} />
      <div className="grid sm:grid-cols-2 gap-4 mb-6"><div className="rounded-[16px_8px_18px_9px] border border-line bg-paper p-4"><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Provider</small><strong className="font-mono text-[12px] break-all">{shortenHash(data.chain?.chain_provider || "")}</strong></div><div className="rounded-[16px_8px_18px_9px] border border-line bg-paper p-4"><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Submitted at</small><strong className="text-[13px]">{submittedAt ? new Date(submittedAt * 1000).toLocaleString() : "—"}</strong></div></div>
      <div className="border border-line rounded-[16px_8px_18px_9px] p-4 mb-6 bg-paper"><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1.5">Deliverable hash</small><strong className="font-mono text-[12px] break-all">{deliverable || "Pending"}</strong><div className="mt-3 border-t border-linesoft pt-3"><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1.5">Agent submission</small>{content ? <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paperhi p-3 font-mono text-[10.5px] leading-relaxed">{content}</pre> : <span className="text-[11.5px] text-inksoft">The provider response is not available yet. The on-chain deliverable hash is preserved above.</span>}</div></div>
      <div className="mb-6"><div className="flex items-center justify-between gap-3 mb-3"><div><span className="inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-green"><span className="w-1.5 h-1.5 rounded-full bg-green"/>Evaluator & settlement</span><h2 className="mt-2 text-[20px] font-bold tracking-tight">Verified, then settled.</h2></div><Status value={policyVerdictLabel(policy?.verdict ?? null)} /></div><p className="text-[13px] text-inksoft mb-5 max-w-[650px]">The submitted state is live from the job. Evaluation and settlement remain protocol-controlled rather than simulated by this page.</p><div className="grid sm:grid-cols-2 gap-4"><div className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-4"><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Dispute window</small><strong className="font-mono text-[18px]">{remaining !== null ? formatTime(remaining) : "—"}</strong><span className="block text-[10.5px] text-inksoft mt-1">{disputeExpired ? "Window elapsed" : disputeOpen ? "Time until decision" : "Waiting for submitted timestamp"}</span></div><div className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-4"><small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Settlement</small><strong className="block text-[13px]">{terminal ? "Terminal" : settlementReady ? "Available according to live job/policy" : "Pending"}</strong><span className="block text-[10.5px] text-inksoft mt-1">Settlement is permissionless at the router layer; the button simply submits the live transaction from the connected AgentMarket WalletConnect session.</span></div></div></div>
      <div className="flex flex-wrap gap-3 mb-3"><button type="button" disabled={!settlementReady || Boolean(workingAction)} onClick={() => void runPolicyAction("settle")} className="btn-asym bg-ink px-5 py-3 font-display text-[12px] font-bold text-paperhi disabled:cursor-not-allowed disabled:opacity-40">{workingAction === "settle" ? "Settling…" : "Settle job →"}</button>{disputeOpen && <button type="button" disabled={Boolean(workingAction)} onClick={() => void runPolicyAction("dispute")} className="btn-asym border border-line bg-paper px-5 py-3 font-display text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-40">{workingAction === "dispute" ? "Disputing…" : "Dispute"}</button>}{refundReady && <button type="button" disabled={Boolean(workingAction)} onClick={() => void runPolicyAction("refund")} className="btn-asym border border-line bg-paper px-5 py-3 font-display text-[12px] font-bold disabled:cursor-not-allowed disabled:opacity-40">{workingAction === "refund" ? "Refunding…" : "Claim refund"}</button>}</div>
      {txHash && <div className="mt-3 rounded-[14px_8px_15px_9px] border border-line bg-greensoft px-4 py-3 text-[11px] text-green">Transaction submitted: <span className="font-mono break-all">{txHash}</span></div>}
      {terminal && <div className="mt-8 border border-line rounded-[16px_8px_18px_9px] p-4 bg-paper flex justify-between items-center"><div><strong className="block text-[13px] font-bold">Terminal state</strong><span className="text-[11px] text-inksoft">Payment state and evidence continue to come from the live job record.</span></div><Status value={liveStatus}/></div>}
    </section>}
  </main>);
}
