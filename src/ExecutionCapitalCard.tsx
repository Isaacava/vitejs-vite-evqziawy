import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import { displayObservedNumber, isVerifiedAuthorization } from "./lib/executionCapital";

export type ExecutionCapitalCardProps = {
  request: ExecutionCapitalRequest | null;
  jobBudget: string | number | null;
  jobCurrency?: string | null;
};

function compact(value?: string | null) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
}

function observed(value?: string | null) {
  return value === null || value === undefined || value === "" ? "Not yet observed" : displayObservedNumber(value);
}

export default function ExecutionCapitalCard({ request }: ExecutionCapitalCardProps) {
  const verified = request ? isVerifiedAuthorization(request) : false;
  const status = request?.status ? request.status.toUpperCase() : "NOT REQUESTED";

  return (
    <section className="mb-6 rounded-[18px_9px_20px_10px] border border-brass/40 bg-brasssoft/30 p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <small className="mb-1 block font-mono text-[8.5px] uppercase text-brass">Execution Capital</small>
          <strong className="font-display text-[17px] font-bold">{request?.purpose || "Agent execution"}</strong>
          <span className="mt-0.5 block text-[11px] text-inksoft">This capital is separate from the ERC-8183 job payment.</span>
        </div>
        <span className={`rounded-lg px-2.5 py-1 font-mono text-[9.5px] ${verified || status === "ACTIVE" || status === "AUTHORIZED" ? "status-green" : "status-brass"}`}>{status.toLowerCase()}</span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Requested</small><strong className="font-mono text-[13px]">{observed(request?.capital_requested)}</strong></div>
        <div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Authorized</small><strong className="font-mono text-[13px]">{observed(request?.capital_authorized)}</strong></div>
        <div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Deployed</small><strong className="font-mono text-[13px]">{observed(request?.capital_deployed)}</strong></div>
        <div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Realized P&amp;L</small><strong className="font-mono text-[13px]">{observed(request?.realized_pnl)}</strong></div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <span className="rounded-full border border-line bg-paperhi px-2 py-1 font-mono text-[9px] text-inksoft">wallet: {request?.wallet_provider || "altana"}</span>
        <span className="rounded-full border border-line bg-paperhi px-2 py-1 font-mono text-[9px] text-inksoft">authorization: scoped_session</span>
        <span className="rounded-full border border-line bg-paperhi px-2 py-1 font-mono text-[9px] text-inksoft">session key: {compact(request?.agent_session_key)}</span>
        {request?.duration_seconds !== null && request?.duration_seconds !== undefined && <span className="rounded-full border border-line bg-paperhi px-2 py-1 font-mono text-[9px] text-inksoft">Duration {Math.round(request.duration_seconds / 3600)}h</span>}
      </div>

      {request?.session_grant_tx_hash && <p className="mb-0 border-t border-dashed border-line pt-3 text-[10px] text-inksoft">Session grant tx: <span className="font-mono text-brass">{compact(request.session_grant_tx_hash)}</span> · user-owned authorization, independently verified where observable.</p>}
      {!request && <p className="mb-0 text-[10px] text-inksoft">No execution capital request has been observed yet. ERC-8183 job budget remains separate.</p>}
      {request && <p className="mb-0 mt-3 text-[10px] text-inksoft">Any value shown as “Not yet observed” has not been independently verified. The marketplace never renders an unknown capital or P&amp;L value as zero.</p>}
    </section>
  );
}
