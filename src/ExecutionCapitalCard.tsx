import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import { displayObservedNumber, isVerifiedAuthorization } from "./lib/executionCapital";

export type ExecutionCapitalCardProps = {
  request: ExecutionCapitalRequest | null;
  jobBudget: string | number | null;
  jobCurrency?: string | null;
};

function compact(value?: string | null) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}

export default function ExecutionCapitalCard({ request, jobBudget, jobCurrency }: ExecutionCapitalCardProps) {
  if (!request) {
    return (
      <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">ERC-8183 Job</small>
            <strong className="font-display text-[18px]">{jobBudget ?? "Not yet observed"} {jobCurrency || ""}</strong>
            <p className="text-[10.5px] text-inksoft mt-1">Payment for the agent's job. Separate from execution capital.</p>
          </div>
          <div>
            <small className="block font-mono text-[8.5px] uppercase text-[#8a8477] mb-1">Execution Capital</small>
            <strong className="font-display text-[18px]">Not requested</strong>
            <p className="text-[10.5px] text-inksoft mt-1">No trading capital has been requested for this job.</p>
          </div>
        </div>
      </section>
    );
  }

  const verified = isVerifiedAuthorization(request);

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1">Execution Capital</small>
          <h3 className="font-display text-[18px] font-bold m-0">{request.purpose || "Agent execution"}</h3>
          <p className="text-[10.5px] text-inksoft mt-1">This capital is separate from the ERC-8183 job payment.</p>
        </div>
        <span className={`font-mono text-[9px] px-2.5 py-1 rounded-lg ${verified ? "status-green" : "status-brass"}`}>{request.status.toUpperCase()}</span>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mt-5">
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Requested</small><strong className="font-mono text-[11px]">{displayObservedNumber(request.capital_requested)}</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Authorized</small><strong className="font-mono text-[11px]">{displayObservedNumber(request.capital_authorized)}</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Deployed</small><strong className="font-mono text-[11px]">{displayObservedNumber(request.capital_deployed)}</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Returned</small><strong className="font-mono text-[11px]">{displayObservedNumber(request.capital_returned)}</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Realized P&amp;L</small><strong className="font-mono text-[11px]">{displayObservedNumber(request.realized_pnl)}</strong></div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5"><small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Session key</small><strong className="font-mono text-[11px]">{compact(request.agent_session_key)}</strong></div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className={`font-mono text-[9px] px-2.5 py-1 rounded-lg ${request.wallet_provider === "altana" ? "status-green" : "status-brass"}`}>Altana</span>
        <span className={`font-mono text-[9px] px-2.5 py-1 rounded-lg ${verified ? "status-green" : "status-brass"}`}>{verified ? "KeyStore verified" : "Not independently verified"}</span>
        <span className="font-mono text-[9px] px-2.5 py-1 rounded-lg border border-line">Scoped session</span>
        {request.duration_seconds !== null && request.duration_seconds !== undefined && (
          <span className="font-mono text-[9px] px-2.5 py-1 rounded-lg border border-line">
            Duration {Math.round(request.duration_seconds / 3600)}h
          </span>
        )}
      </div>

      <p className="mt-4 text-[10px] text-inksoft">Any value shown as “Not yet observed” has not been independently verified. The marketplace never renders an unknown capital or P&amp;L value as zero.</p>
    </section>
  );
}
