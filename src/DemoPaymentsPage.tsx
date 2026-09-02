import { useEffect, useMemo, useState } from "react";

type Payment = { id: string; amount: number; token_symbol: string | null; status: string; tx_hash: string | null; updated_at: string };
type ChainJob = { chain_job_id: number; chain_status: string; budget_raw: string; mission_title: string | null; task_title: string; agent_name?: string | null };
type ExecutionEvidence = { execution_amount?: string | null; currency?: string | null; transaction_hash?: string | null; observed?: boolean };

const compact = (value?: string | null) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "No chain TX recorded";
const statusClass = (value: string) => ["released", "completed", "terminal", "authorized"].includes(value.toLowerCase()) ? "green" : ["disputed", "rejected", "cancelled", "expired"].includes(value.toLowerCase()) ? "rust" : "brass";
const formatTbnb = (raw: string) => { try { return (Number(BigInt(raw)) / 1e18).toString(); } catch { return raw; } };
const isLive = (status: string) => ["funded", "accepted", "in_progress", "submitted"].includes(status.toLowerCase());

export default function DemoPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [jobs, setJobs] = useState<ChainJob[]>([]);
  const [execution, setExecution] = useState<ExecutionEvidence | null>(null);
  const [escrow, setEscrow] = useState("0");
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const [dashboardResponse, jobsResponse] = await Promise.all([
          fetch("/api/dashboard", { credentials: "include" }),
          fetch("/api/testnet/jobs-history", { credentials: "include" }),
        ]);
        const dashboard = await dashboardResponse.json();
        const history = await jobsResponse.json();
        if (!dashboardResponse.ok) throw new Error(dashboard?.error || "Unable to load payments");
        if (!jobsResponse.ok) throw new Error(history?.error || "Unable to load Testnet payment state");
        const chainJobs = Array.isArray(history.jobs) ? history.jobs as ChainJob[] : [];
        const live = chainJobs.filter(job => isLive(job.chain_status));
        const dbEscrow = Array.isArray(dashboard.payments) ? dashboard.payments.filter((payment: Payment) => ["pending", "funded", "escrowed", "locked"].includes(payment.status.toLowerCase())).reduce((sum: number, payment: Payment) => sum + Number(payment.amount || 0), 0) : 0;
        const chainEscrow = live.reduce((sum, job) => sum + Number(formatTbnb(job.budget_raw) || 0), 0);
        setPayments(Array.isArray(dashboard.payments) ? dashboard.payments : []);
        setJobs(chainJobs);
        setEscrow((chainEscrow || dbEscrow).toLocaleString());

        const primary = live[0] || chainJobs[0];
        if (primary) {
          const evidenceResponse = await fetch(`/api/testnet?route=execution-evidence&job=${encodeURIComponent(primary.chain_job_id)}`, { credentials: "include", cache: "no-store" });
          if (evidenceResponse.ok) setExecution(await evidenceResponse.json() as ExecutionEvidence);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to load payments");
      }
    })();
  }, []);

  const primary = useMemo(() => jobs.find(job => isLive(job.chain_status)) || jobs[0], [jobs]);
  const primaryAgent = primary?.agent_name || "Provider";
  const primaryMission = primary?.mission_title || "Mission escrow";

  const rows = [
    ...jobs.filter(job => isLive(job.chain_status)).map(job => ({
      key: `job-${job.chain_job_id}`,
      label: `${formatTbnb(job.budget_raw)} tBNB`,
      detail: `${job.mission_title || job.task_title} · #${job.chain_job_id}`,
      status: job.chain_status,
    })),
    ...payments.map(payment => ({
      key: `payment-${payment.id}`,
      label: `${payment.amount} ${payment.token_symbol || "units"}`,
      detail: compact(payment.tx_hash),
      status: payment.status,
    })),
  ];

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 font-body text-ink">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Payments / Escrow</span>
          <h1 className="mt-2 font-display text-[28px] font-bold tracking-tight">Funds, authorization, settlement.</h1>
        </div>
        <b className="shrink-0 font-mono text-[10px] text-inksoft">ON-CHAIN STATUS TRACKED SEPARATELY</b>
      </div>
      {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust">{error}</div>}

      <div className="relative mb-8 grid min-h-[220px] place-items-center">
        <div className="absolute left-[2%] top-7 hidden w-[210px] rotate-[-3deg] rounded-[26px_10px_28px_13px] border border-line bg-paperhi p-4 shadow-[0_20px_44px_-32px_rgba(23,23,20,.5)] md:block">
          <small className="block font-mono text-[8.5px] uppercase text-brass">Provider</small>
          <strong className="mt-1 block font-display text-[18px] font-bold">{primaryAgent}</strong>
          <span className="mt-0.5 block text-[10.5px] text-inksoft">Executes the mission</span>
        </div>
        <div className="relative z-10 flex h-[172px] w-[172px] flex-col items-center justify-center rounded-full border border-[#c1b69d] bg-paperhi/90 text-center before:absolute before:h-[222px] before:w-[222px] before:rounded-full before:border before:border-brass/20 after:absolute after:h-[272px] after:w-[272px] after:rounded-full after:border after:border-brass/10">
          <span className="font-mono text-[9px] uppercase text-brass">Escrow</span>
          <strong className="mt-1 font-display text-[25px] font-bold">{escrow} tBNB</strong>
          <em className="mt-1 text-[10px] text-inksoft">Locked on EvaluatorRouter</em>
        </div>
        <div className="absolute bottom-5 right-[2%] hidden w-[210px] rotate-[3deg] rounded-[26px_10px_28px_13px] border border-line bg-paperhi p-4 shadow-[0_20px_44px_-32px_rgba(23,23,20,.5)] md:block">
          <small className="block font-mono text-[8.5px] uppercase text-brass">Mission</small>
          <strong className="mt-1 block font-display text-[18px] font-bold">{primaryMission}</strong>
          <span className="mt-0.5 block text-[10.5px] text-inksoft">Releases on evaluation</span>
        </div>
      </div>

      <section className="card-asym border border-line bg-paperhi p-[18px]">
        <div className="mb-1 flex items-center justify-between border-b border-dashed border-line pb-3">
          <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Escrow ledger</span>
          {execution?.transaction_hash ? <a className="font-mono text-[9px] text-brass underline" href={`https://testnet.bscscan.com/tx/${execution.transaction_hash}`} target="_blank" rel="noreferrer">Execution receipt ↗</a> : null}
        </div>
        {rows.map((row, index) => (
          <div key={row.key} className={`flex items-center justify-between gap-4 py-4 ${index < rows.length - 1 ? "dash-b" : ""}`}>
            <div className="min-w-0"><strong className="block font-display text-[16px] font-bold">{row.label}</strong><span className="mt-1 block font-mono text-[10.5px] text-[#9aa3b1]">{row.detail}</span></div>
            <span className={`shrink-0 font-mono text-[9.5px] px-2.5 py-1 rounded-lg status-${statusClass(row.status)}`}>{row.status}</span>
          </div>
        ))}
        {!rows.length && <div className="py-8 text-[12px] text-inksoft">No payment records yet.</div>}
      </section>
    </main>
  );
}
