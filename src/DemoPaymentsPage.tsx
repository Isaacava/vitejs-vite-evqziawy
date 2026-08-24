import { useEffect, useState } from "react";

type Payment = { id: string; amount: number; token_symbol: string | null; status: string; tx_hash: string | null; updated_at: string };
type ChainJob = { chain_job_id: number; chain_status: string; budget_raw: string; mission_title: string | null; task_title: string; agent_name?: string | null };

const compact = (value?: string | null) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "No chain TX recorded";
const statusClass = (value: string) => ["released", "completed", "terminal"].includes(value.toLowerCase()) ? "green" : ["disputed", "rejected", "cancelled", "expired"].includes(value.toLowerCase()) ? "rust" : "brass";
const formatTbnb = (raw: string) => { try { return (Number(BigInt(raw)) / 1e18).toString(); } catch { return raw; } };

export default function DemoPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [jobs, setJobs] = useState<ChainJob[]>([]);
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
        const live = chainJobs.filter((job) => ["funded", "accepted", "in_progress", "submitted"].includes(String(job.chain_status).toLowerCase()));
        const total = live.reduce((sum, job) => sum + Number(formatTbnb(job.budget_raw) || 0), 0) + (Array.isArray(dashboard.payments) ? dashboard.payments.filter((payment: Payment) => ["pending", "funded", "escrowed", "locked"].includes(payment.status.toLowerCase())).reduce((sum: number, payment: Payment) => sum + Number(payment.amount || 0), 0) : 0);
        setPayments(Array.isArray(dashboard.payments) ? dashboard.payments : []);
        setJobs(chainJobs);
        setEscrow(total.toLocaleString());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to load payments");
      }
    })();
  }, []);

  const primary = jobs.find((job) => ["funded", "accepted", "in_progress", "submitted"].includes(String(job.chain_status).toLowerCase())) || jobs[0];

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 font-body text-ink">
      <div className="mb-6 flex items-center justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Payments / Escrow</span>
        <b className="font-mono text-[10.5px] text-inksoft">ON-CHAIN STATUS SEPARATE</b>
      </div>
      {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust">{error}</div>}

      <div className="relative min-h-[320px] grid place-items-center mb-8">
        <div className="absolute left-[4%] top-9 -rotate-3 w-[196px] bg-paperhi/90 border border-line card-asym-lg shadow-[0_20px_44px_-32px_rgba(23,23,20,.5)] p-4">
          <small className="block font-mono text-[8.5px] uppercase text-brass">Provider</small>
          <strong className="block font-display text-[18px] font-bold mt-1">{primary?.agent_name || "Pricing-X"}</strong>
          <span className="block text-[10.5px] text-inksoft mt-0.5">Executes the mission</span>
        </div>
        <div className="relative w-[172px] h-[172px] rounded-full border border-[#c1b69d] bg-paperhi/90 flex flex-col items-center justify-center text-center z-10 before:content-[''] before:absolute before:w-[222px] before:h-[222px] before:rounded-full before:border before:border-brass/20 after:content-[''] after:absolute after:w-[272px] after:h-[272px] after:rounded-full after:border after:border-brass/10">
          <span className="font-mono text-[9px] uppercase text-brass">Escrow</span>
          <strong className="font-display text-[25px] font-bold mt-1">{escrow} tBNB</strong>
          <em className="not-italic text-[10px] text-inksoft mt-1">Locked on EvaluatorRouter</em>
        </div>
        <div className="absolute right-[4%] bottom-7 rotate-3 w-[196px] bg-paperhi/90 border border-line card-asym-lg shadow-[0_20px_44px_-32px_rgba(23,23,20,.5)] p-4">
          <small className="block font-mono text-[8.5px] uppercase text-brass">Mission</small>
          <strong className="block font-display text-[18px] font-bold mt-1">{primary?.mission_title || "Scrape pricing"}</strong>
          <span className="block text-[10.5px] text-inksoft mt-0.5">Releases on evaluation</span>
        </div>
      </div>

      <section className="bg-paperhi border border-line card-asym p-[18px]">
        {jobs.filter((job) => ["funded", "accepted", "in_progress", "submitted"].includes(String(job.chain_status).toLowerCase())).map((job, index, rows) => (
          <div key={`job-${job.chain_job_id}`} className={`flex justify-between items-center py-4 ${index < rows.length - 1 ? "dash-b" : ""}`}>
            <div><strong className="font-display text-[16px] font-bold">{formatTbnb(job.budget_raw)} tBNB</strong><span className="block font-mono text-[10.5px] text-[#9aa3b1] mt-1">#{job.chain_job_id}</span></div>
            <span className={`font-mono text-[9.5px] px-2.5 py-1 rounded-lg status-${statusClass(job.chain_status)}`}>{job.chain_status}</span>
          </div>
        ))}
        {payments.map((payment) => (
          <div key={payment.id} className="flex justify-between items-center py-4 dash-b last:border-0">
            <div><strong className="font-display text-[16px] font-bold">{payment.amount} {payment.token_symbol || "units"}</strong><span className="block font-mono text-[10.5px] text-[#9aa3b1] mt-1">{compact(payment.tx_hash)}</span></div>
            <span className={`font-mono text-[9.5px] px-2.5 py-1 rounded-lg status-${statusClass(payment.status)}`}>{payment.status}</span>
          </div>
        ))}
        {!jobs.length && !payments.length && <div className="py-8 text-[12px] text-inksoft">No payment records yet.</div>}
      </section>
    </main>
  );
}
