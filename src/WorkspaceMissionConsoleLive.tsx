import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
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
  job: { id: string; status: string; description: string; budget: number | string; chain_job_id: number | null; deliverable: string | null; chain_tx_hash?: string | null };
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
  content?: unknown;
  submitted_at?: number | string | null;
  onchain_deliverable_hash?: string | null;
  computed_deliverable_hash?: string | null;
  verified?: boolean;
  evidence_source?: string | null;
  agent_name?: string | null;
  endpoint?: string | null;
};

type PolicyState = { disputeWindow: bigint; verdict: bigint | null };

const STEPS = ["open", "funded", "accepted", "in_progress", "submitted"] as const;
const human = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

function Lifecycle({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const current = STEPS.indexOf(normalized as typeof STEPS[number]);
  const terminal = ["completed", "rejected", "expired", "cancelled", "terminal", "settled"].includes(normalized);
  const activeIndex = terminal ? STEPS.length - 1 : current;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-0 rounded-[14px] overflow-hidden bg-deep">
      {STEPS.map((step, index) => {
        const active = activeIndex >= 0 && index <= activeIndex;
        const currentStep = !terminal && normalized === step;
        return <div key={step} className="p-3.5 border-r border-white/10 last:border-r-0"><span className={`block font-mono text-[8px] uppercase ${active ? "text-brasslt" : "text-[#726f60]"}`}>{human(step)}</span><i className={`block w-2 h-2 rounded-full mt-2 ${active ? "bg-brasslt" : "bg-[#3a3a30]"} ${currentStep ? "shadow-[0_0_0_3px_rgba(210,176,94,.22)]" : ""}`} /></div>;
      })}
    </div>
  );
}

function statusClass(value: string) {
  const lower = value.toLowerCase();
  if (["completed", "terminal", "settled"].includes(lower)) return "status-green";
  if (["rejected", "cancelled", "expired", "disputed"].includes(lower)) return "status-rust";
  return "status-brass";
}

function asTimestampSeconds(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function resultContent(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function observed(value?: string | number | null) {
  if (value === null || value === undefined || value === "") return "Not yet observed";
  return String(value);
}

export default function WorkspaceMissionConsole() {
  const [jobId] = useState(() => new URLSearchParams(window.location.search).get("job") || "");
  const [data, setData] = useState<JobView | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [policy, setPolicy] = useState<PolicyState | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [error, setError] = useState("");
  const [workingAction, setWorkingAction] = useState<"dispute" | "settle" | "refund" | "">("");
  const [txHash, setTxHash] = useState("");

  const load = useCallback(async () => {
    if (!jobId) return;
    try {
      const response = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Unable to load mission");
      const nextData = body as JobView;
      setData(nextData);
      setError("");
      const chainJobId = nextData.chain?.chain_job_id ?? nextData.job.chain_job_id;
      const submitted = nextData.chain?.chain_status?.toLowerCase() === "submitted" || nextData.job.status?.toLowerCase() === "submitted";
      if (chainJobId && submitted) {
        try {
          const resultResponse = await fetch(`/api/testnet/job-result?job=${encodeURIComponent(String(chainJobId))}`, { credentials: "include", cache: "no-store" });
          const resultBody = await resultResponse.json();
          setResult(resultResponse.ok ? resultBody as JobResult : null);
        } catch { setResult(null); }
        try {
          const config = await readPolicyConfig();
          let verdict: bigint | null = null;
          try { verdict = BigInt(await readPolicyVerdict(BigInt(chainJobId))); } catch { verdict = null; }
          setPolicy({ disputeWindow: BigInt(config.disputeWindow), verdict });
        } catch { setPolicy(null); }
      } else {
        setResult(null);
        setPolicy(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load mission");
    }
  }, [jobId]);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 10_000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => window.clearInterval(timer); }, []);

  if (!jobId) return <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8"><section className="card-asym-lg bg-paperhi p-7 md:p-8"><span className="font-mono text-[9.5px] uppercase tracking-widest text-brass">MISSIONS / MISSION CONSOLE</span><h1 className="mt-3 font-display text-[30px] font-bold tracking-tight">No mission selected.</h1><p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-inksoft">Open the console from the Missions page so the live ERC-8183 job can be loaded.</p><a href="/missions" className="btn-asym mt-5 inline-flex bg-ink px-5 py-3 font-display text-[12px] font-bold text-paperhi no-underline">Back to missions →</a></section></main>;

  if (!data) return <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8"><section className="card-asym-lg bg-paperhi p-8 text-[13px] text-inksoft">Loading mission state…</section></main>;

  const liveStatus = data.chain?.chain_status?.toLowerCase() || data.job.status?.toLowerCase() || "open";
  const chainJobId = data.chain?.chain_job_id ?? data.job.chain_job_id;
  const budget = data.chain?.chain_budget ?? data.job.budget ?? data.payment?.amount ?? null;
  const tokenSymbol = data.chain?.token_symbol || data.payment?.token_symbol || "tBNB";
  const submittedAt = asTimestampSeconds(result?.submitted_at ?? data.chain?.chain_submitted_at);
  const disputeWindowSeconds = policy ? Number(policy.disputeWindow) : null;
  const disputeDeadline = submittedAt !== null && disputeWindowSeconds !== null ? submittedAt + disputeWindowSeconds : null;
  const remaining = disputeDeadline === null ? null : Math.max(disputeDeadline - now, 0);
  const submitted = liveStatus === "submitted";
  const disputeOpen = submitted && remaining !== null && remaining > 0;
  const settlementReady = submitted;
  const refundReady = submitted && remaining !== null && remaining <= 0 && policy?.verdict === 0n;
  const provider = data.chain?.chain_provider || "Not yet observed";
  const evaluator = data.chain?.chain_evaluator || "Not yet observed";
  const deliverable = data.chain?.chain_deliverable || data.job.deliverable;
  const content = resultContent(result?.content);
  const capital = data.execution_capital;
  const executionAsset = capital?.capital_token || data.chain?.token_address || "Not yet observed";
  const sessionKey = capital?.agent_session_key || "Not yet observed";

  async function runPolicyAction(action: "dispute" | "settle" | "refund") {
    if (!chainJobId) return;
    setWorkingAction(action); setError(""); setTxHash("");
    try {
      const { provider: walletProvider, address } = await ensureWalletConnectedProvider();
      const args = { jobId: BigInt(chainJobId), providerWallet: walletProvider, account: address as Address };
      const response = action === "dispute" ? await disputeJob(args) : action === "settle" ? await settleJob(args) : await claimRefundJob(args);
      setTxHash(response.hash as Hex);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to ${action} job`);
    } finally { setWorkingAction(""); }
  }

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 font-body text-ink">
      <div className="mb-5 flex items-center justify-between gap-4"><span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Missions / Mission console</span><a href="/missions" className="text-[11px] font-bold text-inksoft no-underline hover:text-ink">← Back to missions</a></div>
      {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust break-words">{error}</div>}
      {txHash && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#b9d2c3] bg-greensoft px-4 py-3 text-[12px] text-green">Transaction submitted: <a className="font-mono underline" href={bscExplorerUrl(txHash)} target="_blank" rel="noreferrer">{compact(txHash)} ↗</a></div>}

      <section className="card-asym-lg bg-paperhi p-6 md:p-8">
        <div className="mb-6 grid gap-4 border-b border-dashed border-[#c8c0af] pb-6 sm:grid-cols-2">
          <div><small className="mb-1 block font-mono text-[8.5px] uppercase text-[#8a8477]">Mission</small><strong className="block text-[15px] font-bold">{data.mission?.title || data.job.description || "Agent mission"}</strong></div>
          <div><small className="mb-1 block font-mono text-[8.5px] uppercase text-[#8a8477]">Agent</small><strong className="block text-[15px] font-bold">{data.task?.role || "Provider"}</strong></div>
          <div><small className="mb-1 block font-mono text-[8.5px] uppercase text-[#8a8477]">Chain job ID</small><strong className="font-mono text-[14px]">{chainJobId ? `#${chainJobId}` : "—"}</strong></div>
          <div><small className="mb-1 block font-mono text-[8.5px] uppercase text-[#8a8477]">Budget</small><strong className="font-mono text-[14px]">{observed(budget)} {tokenSymbol}</strong></div>
        </div>

        <span className="mb-3 inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-brass"><span className="h-1.5 w-1.5 rounded-full bg-brass" />Chain-verified state</span>
        <div className="mb-6 grid gap-3 rounded-[16px_8px_18px_9px] border border-line bg-paper p-4 sm:grid-cols-2">
          <div><small className="mb-1 block font-mono text-[8.5px] uppercase text-[#8a8477]">Marketplace status</small><span className={`inline-block rounded-lg px-2.5 py-1 font-mono text-[9.5px] ${statusClass(data.job.status)}`}>{human(data.job.status)}</span></div>
          <div><small className="mb-1 block font-mono text-[8.5px] uppercase text-[#8a8477]">Chain status (authoritative)</small><span className="inline-block rounded-lg px-2.5 py-1 font-mono text-[9.5px] status-green">{human(liveStatus)}</span></div>
          <div><small className="mb-1 block font-mono text-[8.5px] uppercase text-[#8a8477]">Live source</small><strong className="text-[12.5px]">ERC-8183 Commerce · BSC Testnet</strong></div>
          <div><small className="mb-1 block font-mono text-[8.5px] uppercase text-[#8a8477]">Synced</small><strong className="text-[12.5px]">Live chain state</strong></div>
        </div>

        <span className="mb-3 inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-brass"><span className="h-1.5 w-1.5 rounded-full bg-brass" />Job lifecycle</span>
        <p className="mb-5 max-w-[650px] text-[13px] text-inksoft">State is read from the ERC-8183 commerce contract on BSC Testnet. The console never simulates lifecycle transitions.</p>
        <div className="mb-6"><Lifecycle status={liveStatus} /></div>

        <span className="mb-3 inline-flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-widest text-brass"><span className="h-1.5 w-1.5 rounded-full bg-brass" />Execution Capital</span>
        <div className="mb-6 rounded-[18px_9px_20px_10px] border border-brass/40 bg-brasssoft/30 p-5">
          <div className="mb-4 flex items-start justify-between gap-4"><div><small className="mb-1 block font-mono text-[8.5px] uppercase text-brass">Agent execution</small><strong className="font-display text-[17px] font-bold">{capital?.purpose || "Agent execution"}</strong><span className="mt-0.5 block text-[11px] text-inksoft">This capital is separate from the ERC-8183 job payment.</span></div><span className={`rounded-lg px-2.5 py-1 font-mono text-[9.5px] ${capital ? "status-green" : "status-brass"}`}>{capital ? capital.status.toUpperCase() : "NOT REQUESTED"}</span></div>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Requested</small><strong className="font-mono text-[13px]">{observed(capital?.capital_requested)}</strong></div><div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Authorized</small><strong className="font-mono text-[13px]">{observed(capital?.capital_authorized)}</strong></div><div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Deployed</small><strong className="font-mono text-[13px]">{observed(capital?.capital_deployed)}</strong></div><div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Realized P&amp;L</small><strong className="font-mono text-[13px]">{observed(capital?.realized_pnl)}</strong></div></div>
          <div className="mb-4 flex flex-wrap gap-2"><span className="rounded-full border border-line bg-paperhi px-2 py-1 font-mono text-[9px] text-inksoft">wallet: altana</span><span className="rounded-full border border-line bg-paperhi px-2 py-1 font-mono text-[9px] text-inksoft">session: {compact(sessionKey)}</span><span className="rounded-full border border-line bg-paperhi px-2 py-1 font-mono text-[9px] text-inksoft">token: {compact(executionAsset)}</span></div>
          <p className="m-0 text-[10.5px] text-inksoft">Any value shown as “Not yet observed” has not been independently verified. The marketplace never renders an unknown capital or P&amp;L value as zero.</p>
        </div>

        <ExecutionCapitalPanel request={capital} jobBudget={budget} jobCurrency={tokenSymbol} />

        <div className="mb-6 rounded-[16px_8px_18px_9px] border border-line bg-paper p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><strong className="text-[13px] font-bold">Live execution · Testnet</strong><span className="rounded-lg px-2.5 py-1 font-mono text-[9.5px] status-green">{capital ? "AUTHORIZED" : "PENDING"}</span></div>
          <strong className="block text-[14px] font-bold">Run the authorized execution scope</strong>
          <p className="mt-1 text-[10.5px] text-inksoft">Preflight validates the provider-declared execution scope, asset state, and transaction before any broadcast.</p>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[16px_8px_18px_9px] border border-line bg-paper p-4"><small className="mb-1 block font-mono text-[8.5px] uppercase text-[#8a8477]">Provider</small><strong className="block break-all font-mono text-[12px]">{provider}</strong></div>
          <div className="rounded-[16px_8px_18px_9px] border border-line bg-paper p-4"><small className="mb-1 block font-mono text-[8.5px] uppercase text-[#8a8477]">Deliverable hash</small><strong className="font-mono text-[12px]">{compact(result?.onchain_deliverable_hash)}</strong></div>
        </div>

        <div className="mb-6 rounded-[16px_8px_18px_9px] border border-line bg-paper p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><strong className="text-[13px] font-bold">Agent submission</strong><span className={`rounded-lg px-2.5 py-1 font-mono text-[9.5px] ${result?.verified ? "status-green" : "status-brass"}`}>{result?.verified ? "Verified" : "Pending"}</span></div>
          <p className="m-0 text-[11px] text-inksoft">The provider response is {result ? "available" : "not available yet"}. The on-chain deliverable hash is preserved when present.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Deliverable</small><p className="m-0 text-[11px] text-inksoft">{deliverable || "Pending"}</p></div><div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Submitted at</small><strong className="font-mono text-[11px]">{submittedAt ? new Date(submittedAt * 1000).toLocaleString() : "—"}</strong></div></div>
          {content && <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-linesoft bg-paperhi p-3 font-mono text-[9.5px] text-inksoft">{content}</pre>}
        </div>

        <div className="rounded-[16px_8px_18px_9px] border border-line bg-paper p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><strong className="text-[13px] font-bold">Evaluator &amp; settlement</strong><span className={`rounded-lg px-2.5 py-1 font-mono text-[9.5px] ${data.evaluation?.verdict || policy?.verdict ? "status-green" : "status-brass"}`}>{data.evaluation?.verdict || (policy?.verdict === 1n ? "Approved" : policy?.verdict === 2n ? "Rejected" : "Pending")}</span></div>
          <p className="m-0 text-[11px] text-inksoft">Verified, then settled. Evaluation and settlement remain protocol-controlled rather than simulated by this page.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3"><div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Dispute window</small><strong className="font-mono text-[11px]">{remaining === null ? "Waiting for submitted timestamp" : disputeOpen ? formatTime(remaining) : "Closed"}</strong></div><div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Settlement</small><strong className="font-mono text-[11px]">{settlementReady ? "Pending" : "Pending"}</strong></div><div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Evaluator</small><strong className="font-mono text-[11px] break-all">{evaluator}</strong></div></div>
          <div className="mt-4 flex flex-wrap gap-2">
            {disputeOpen && <button className="btn-asym border border-rust px-4 py-2.5 font-display text-[11px] font-bold text-rust" disabled={!!workingAction} onClick={() => void runPolicyAction("dispute")}>Open dispute</button>}
            {settlementReady && <button className="btn-asym bg-ink px-4 py-2.5 font-display text-[11px] font-bold text-paperhi" disabled={!!workingAction} onClick={() => void runPolicyAction("settle")}>{workingAction === "settle" ? "Settling…" : "Settle job →"}</button>}
            {refundReady && <button className="btn-asym border border-brass px-4 py-2.5 font-display text-[11px] font-bold text-brass" disabled={!!workingAction} onClick={() => void runPolicyAction("refund")}>{workingAction === "refund" ? "Claiming…" : "Claim refund →"}</button>}
          </div>
        </div>
      </section>
    </main>
  );
}
