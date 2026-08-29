import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import { displayObservedNumber, isVerifiedAuthorization } from "./lib/executionCapital";

export type OnchainExecutionSummary = {
  observed?: boolean;
  transaction_hash?: string | null;
  execution?: {
    status?: string | null;
    block_number?: string | null;
    gas_used?: string | null;
    effective_gas_price?: string | null;
    execution_wallet?: string | null;
  };
  market?: {
    verified_onchain?: boolean;
    token_in_symbol?: string | null;
    token_in_amount?: string | null;
    token_out_symbol?: string | null;
    token_out_amount?: string | null;
    fee?: number | null;
    pool?: string | null;
  };
  accounting?: {
    capital_deployed?: string | null;
    capital_deployed_token?: string | null;
    realized_pnl?: string | null;
    realized_pnl_token?: string | null;
    realized_pnl_status?: string | null;
    realized_pnl_basis?: string | null;
  };
};

export type ExecutionCapitalCardProps = {
  request: ExecutionCapitalRequest | null;
  jobBudget: string | number | null;
  jobCurrency?: string | null;
  onchainExecution?: OnchainExecutionSummary | null;
};

function compact(value?: string | null) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
}

function observed(value?: string | null) {
  return value === null || value === undefined || value === "" ? "Not yet observed" : displayObservedNumber(value);
}

export default function ExecutionCapitalCard({ request, onchainExecution }: ExecutionCapitalCardProps) {
  const verified = request ? isVerifiedAuthorization(request) : false;
  const status = request?.status ? request.status.toUpperCase() : "NOT REQUESTED";
  const executionObserved = Boolean(onchainExecution?.observed && onchainExecution.market?.verified_onchain);
  const deployed = executionObserved
    ? `${onchainExecution?.accounting?.capital_deployed || onchainExecution?.market?.token_in_amount || "—"} ${onchainExecution?.accounting?.capital_deployed_token || onchainExecution?.market?.token_in_symbol || ""}`.trim()
    : observed(request?.capital_deployed);
  const pnl = onchainExecution?.accounting?.realized_pnl
    ? `${onchainExecution.accounting.realized_pnl} ${onchainExecution.accounting.realized_pnl_token || ""}`.trim()
    : executionObserved
      ? "Not determinable from one swap"
      : observed(request?.realized_pnl);

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
        <div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Deployed</small><strong className="font-mono text-[13px]">{deployed}</strong></div>
        <div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Realized P&amp;L</small><strong className="font-mono text-[13px]">{pnl}</strong></div>
      </div>

      {executionObserved && (
        <div className="mb-4 rounded-[12px_7px_13px_8px] border border-line bg-paperhi p-4">
          <small className="mb-2 block font-mono text-[8px] uppercase tracking-widest text-brass">Onchain execution evidence</small>
          <div className="grid gap-2 text-[10px] sm:grid-cols-2">
            <div><strong>Actual execution:</strong> {onchainExecution?.market?.token_in_amount} {onchainExecution?.market?.token_in_symbol} → {onchainExecution?.market?.token_out_amount} {onchainExecution?.market?.token_out_symbol}</div>
            <div><strong>Pool fee:</strong> {onchainExecution?.market?.fee ?? "Not independently identified"}</div>
            <div><strong>Block:</strong> {onchainExecution?.execution?.block_number || "—"}</div>
            <div><strong>Receipt:</strong> {onchainExecution?.execution?.status || "—"}</div>
            {onchainExecution?.transaction_hash && <div className="sm:col-span-2"><strong>Transaction:</strong> <a className="font-mono text-brass underline" href={`https://testnet.bscscan.com/tx/${onchainExecution.transaction_hash}`} target="_blank" rel="noreferrer">{compact(onchainExecution.transaction_hash)} ↗</a></div>}
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <span className="rounded-full border border-line bg-paperhi px-2 py-1 font-mono text-[9px] text-inksoft">wallet: {request?.wallet_provider || "altana"}</span>
        <span className="rounded-full border border-line bg-paperhi px-2 py-1 font-mono text-[9px] text-inksoft">authorization: scoped_session</span>
        <span className="rounded-full border border-line bg-paperhi px-2 py-1 font-mono text-[9px] text-inksoft">session key: {compact(request?.agent_session_key)}</span>
        {request?.duration_seconds !== null && request?.duration_seconds !== undefined && <span className="rounded-full border border-line bg-paperhi px-2 py-1 font-mono text-[9px] text-inksoft">Duration {Math.round(request.duration_seconds / 3600)}h</span>}
      </div>

      {request?.session_grant_tx_hash && <p className="mb-0 border-t border-dashed border-line pt-3 text-[10px] text-inksoft">Session grant tx: <span className="font-mono text-brass">{compact(request.session_grant_tx_hash)}</span> · user-owned authorization, independently verified where observable.</p>}
      {!request && <p className="mb-0 text-[10px] text-inksoft">No execution capital request has been observed yet. ERC-8183 job budget remains separate.</p>}
      {request && <p className="mb-0 mt-3 text-[10px] text-inksoft">Execution amounts shown above come from AgentMarket's independent BSC Testnet verification. A single swap does not by itself establish realized P&amp;L, so that figure is not invented.</p>}
    </section>
  );
}
