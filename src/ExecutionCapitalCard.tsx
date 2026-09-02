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
    token_in?: string | null;
    token_out?: string | null;
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
    unrealized_pnl?: string | null;
    unrealized_pnl_token?: string | null;
    total_pnl?: string | null;
    total_pnl_token?: string | null;
    pnl_percentage?: string | null;
    pnl_status?: string | null;
    pnl_basis?: string | null;
  };
};

type ExecutionCapitalCardProps = {
  request: ExecutionCapitalRequest | null;
  jobBudget: string | number | null;
  jobCurrency?: string | null;
  onchainExecution?: OnchainExecutionSummary | null;
};

function bscscanTxUrl(hash?: string | null) {
  return hash ? `https://testnet.bscscan.com/tx/${hash}` : "";
}

function observed(value?: string | null) {
  return value === null || value === undefined || value === "" ? "Not yet observed" : displayObservedNumber(value);
}

function pnlLabel(value?: string | null, token = "CAKE2") {
  if (value === null || value === undefined || value === "") return "Not yet calculated";
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return `${numeric >= 0 ? "+" : ""}${value} ${token}`.trim();
  return `${value} ${token}`.trim();
}

export default function ExecutionCapitalCard({ request, onchainExecution }: ExecutionCapitalCardProps) {
  const authorizationVerified = request ? isVerifiedAuthorization(request) : false;
  const rawStatus = request?.status || "not_requested";
  const status = request
    ? rawStatus === "authorized" && !authorizationVerified
      ? "PENDING VERIFICATION"
      : rawStatus.toUpperCase()
    : "NOT REQUESTED";
  const executionObserved = Boolean(onchainExecution?.observed && onchainExecution.market?.verified_onchain);
  const deployed = executionObserved
    ? `${onchainExecution?.accounting?.capital_deployed || onchainExecution?.market?.token_in_amount || "—"} ${onchainExecution?.accounting?.capital_deployed_token || onchainExecution?.market?.token_in_symbol || ""}`.trim()
    : observed(request?.capital_deployed);

  const accounting = onchainExecution?.accounting;
  const pnlStatus = accounting?.pnl_status || "";
  const pnlMode = pnlStatus === "realized_from_verified_round_trip"
    ? "realized"
    : pnlStatus === "live_mark_to_market"
      ? "unrealized"
      : "pending";
  const pnlToken = accounting?.unrealized_pnl_token || accounting?.realized_pnl_token || "CAKE2";
  const pnlValue = pnlMode === "realized" ? accounting?.realized_pnl : accounting?.unrealized_pnl;
  const pnlTitle = pnlMode === "realized" ? "Realized P&L" : pnlMode === "unrealized" ? "Unrealized P&L" : "P&L";
  const pnlDisplay = executionObserved && pnlValue
    ? pnlLabel(pnlValue, pnlToken)
    : executionObserved && pnlStatus === "unpriced"
      ? "Awaiting live mark"
      : "Calculating…";
  const executionProofUrl = bscscanTxUrl(onchainExecution?.transaction_hash);
  const sessionGrantProofUrl = bscscanTxUrl(request?.session_grant_tx_hash);

  return (
    <section className="mb-6 rounded-[18px_9px_20px_10px] border border-brass/40 bg-brasssoft/30 p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <small className="mb-1 block font-mono text-[8.5px] uppercase text-brass">Execution Capital</small>
          <strong className="font-display text-[17px] font-bold">{request?.purpose || "Agent execution"}</strong>
          <span className="mt-0.5 block text-[11px] text-inksoft">This capital is separate from the ERC-8183 job payment.</span>
        </div>
        <span className={`rounded-lg px-2.5 py-1 font-mono text-[9.5px] ${authorizationVerified || status === "ACTIVE" ? "status-green" : "status-brass"}`}>{status.toLowerCase()}</span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Requested</small><strong className="font-mono text-[13px]">{observed(request?.capital_requested)}</strong></div>
        <div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Authorized</small><strong className="font-mono text-[13px]">{observed(request?.capital_authorized)}</strong></div>
        <div><small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">Deployed</small><strong className="font-mono text-[13px]">{deployed}</strong></div>
        <div>
          <small className="mb-1 block font-mono text-[8px] uppercase text-[#8a8477]">{pnlTitle}</small>
          <strong className="font-mono text-[13px]">{pnlDisplay}</strong>
          <span className="mt-0.5 block text-[8px] text-inksoft">
            {accounting?.pnl_percentage ? `${accounting.pnl_percentage}%` : pnlMode === "unrealized" ? "live mark" : pnlMode === "realized" ? "verified round trip" : "syncing"}
          </span>
        </div>
      </div>

      {executionObserved && (
        <div className="mb-4 rounded-[12px_7px_13px_8px] border border-line bg-paperhi p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <small className="mb-1 block font-mono text-[8px] uppercase tracking-widest text-brass">Execution evidence</small>
              <strong className="block text-[12.5px] font-bold">Verified on BSC Testnet</strong>
              <span className="mt-0.5 block text-[10px] text-inksoft">The execution receipt and market details were independently observed on-chain.</span>
            </div>
            {executionProofUrl && <a className="shrink-0 text-[10px] font-bold text-brass no-underline" href={executionProofUrl} target="_blank" rel="noreferrer">View proof ↗</a>}
          </div>
          <div className="grid gap-2 text-[10px] sm:grid-cols-2">
            <div><strong>Actual execution:</strong> {onchainExecution?.market?.token_in_amount} {onchainExecution?.market?.token_in_symbol} → {onchainExecution?.market?.token_out_amount} {onchainExecution?.market?.token_out_symbol}</div>
            <div><strong>Pool fee:</strong> {onchainExecution?.market?.fee ?? "Not independently identified"}</div>
            <div><strong>Block:</strong> {onchainExecution?.execution?.block_number || "—"}</div>
            <div><strong>Receipt:</strong> {onchainExecution?.execution?.status || "—"}</div>
          </div>
        </div>
      )}

      {executionObserved && accounting && (
        <div className="mb-4 rounded-[12px_7px_13px_8px] border border-line bg-paperhi p-4">
          <small className="mb-2 block font-mono text-[8px] uppercase tracking-widest text-brass">P&amp;L basis</small>
          <div className="grid gap-2 text-[10px] sm:grid-cols-2">
            <div><strong>Mode:</strong> {pnlMode === "realized" ? "Realized" : pnlMode === "unrealized" ? "Unrealized mark-to-market" : "Pending"}</div>
            <div><strong>Total P&amp;L:</strong> {accounting.total_pnl ? pnlLabel(accounting.total_pnl, accounting.total_pnl_token || "CAKE2") : "—"}</div>
            <div className="sm:col-span-2"><strong>Basis:</strong> {accounting.pnl_basis || "Independent onchain accounting"}</div>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <span className="rounded-full border border-line bg-paperhi px-2 py-1 font-mono text-[9px] text-inksoft">wallet: {request?.wallet_provider || "altana"}</span>
        <span className="rounded-full border border-line bg-paperhi px-2 py-1 font-mono text-[9px] text-inksoft">authorization: scoped_session</span>
        {request?.duration_seconds !== null && request?.duration_seconds !== undefined && <span className="rounded-full border border-line bg-paperhi px-2 py-1 font-mono text-[9px] text-inksoft">Duration {Math.round(request.duration_seconds / 3600)}h</span>}
      </div>

      {sessionGrantProofUrl && <div className="border-t border-dashed border-line pt-3 text-[10px] text-inksoft"><strong className="text-green">Authorization verified</strong><span> · Your execution permission was recorded on BSC Testnet.</span> <a className="font-bold text-brass no-underline" href={sessionGrantProofUrl} target="_blank" rel="noreferrer">View proof ↗</a></div>}
      {!request && <p className="mb-0 text-[10px] text-inksoft">No execution capital request has been observed yet. ERC-8183 job budget remains separate.</p>}
      {request && <p className="mb-0 mt-3 text-[10px] text-inksoft">P&amp;L is calculated from independently observed onchain execution evidence. Open positions use a live PancakeSwap V3 mark; realized P&amp;L requires a verified closing execution.</p>}
    </section>
  );
}