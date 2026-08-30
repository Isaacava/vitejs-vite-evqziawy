import { useEffect, useState } from "react";
import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import type { OnchainExecutionSummary } from "./ExecutionCapitalCard";

type Props = { request: ExecutionCapitalRequest };

type ReceiptStatus = {
  observed: boolean;
  transaction_hash?: string;
  error?: string;
};

function compact(value?: string | null) {
  return value ? `${value.slice(0, 10)}…${value.slice(-8)}` : "—";
}

function missingReceiptError(value?: string) {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized.includes("transaction receipt") && (
    normalized.includes("could not be found") ||
    normalized.includes("not processed on a block") ||
    normalized.includes("receipt not found")
  );
}

function transactionHashFromError(value?: string) {
  if (!value) return null;
  const match = value.match(/0x[a-fA-F0-9]{64}/);
  return match?.[0] || null;
}

export default function ExecutionCapitalLivePanel({ request }: Props) {
  const [execution, setExecution] = useState<OnchainExecutionSummary | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/testnet?route=execution-evidence&job=${encodeURIComponent(request.job_id)}`,
          { credentials: "include", cache: "no-store" },
        );
        const body = await response.json().catch(() => null) as (OnchainExecutionSummary & { error?: string }) | null;
        if (!active) return;

        if (!response.ok) {
          const message = body?.error || "Unable to verify execution directly from BSC Testnet";
          if (missingReceiptError(message)) {
            const candidateHash = transactionHashFromError(message);
            if (candidateHash) {
              try {
                const receiptResponse = await fetch(
                  `/api/testnet/execution-receipt?tx_hash=${encodeURIComponent(candidateHash)}`,
                  { credentials: "include", cache: "no-store" },
                );
                const receiptBody = await receiptResponse.json().catch(() => null) as ReceiptStatus | null;
                if (active && receiptResponse.ok && receiptBody?.observed === false) {
                  setPending(true);
                  setError("");
                  return;
                }
              } catch {}
            }
            setPending(true);
            setError("");
            return;
          }
          throw new Error(message);
        }

        setExecution(body);
        setPending(body?.observed === false);
        setError("");
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to verify execution directly from BSC Testnet");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [request.job_id]);

  const market = execution?.market;
  const wallet = execution?.execution?.execution_wallet || request.user_execution_wallet || null;
  const verified = Boolean(execution?.observed && market?.verified_onchain);
  const amountIn = market?.token_in_amount || "Not yet observed";
  const amountOut = market?.token_out_amount || "Not yet observed";
  const tokenInSymbol = market?.token_in_symbol || "CAKE2";
  const tokenOutSymbol = market?.token_out_symbol || "WBNB";

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1">Live execution · Testnet</small>
          <h3 className="font-display text-[18px] font-bold m-0">Agent execution</h3>
          <p className="text-[10.5px] text-inksoft mt-1">Execution evidence is independently read from BSC Testnet. The marketplace does not use the agent response as the source for the transaction amounts or pool details.</p>
        </div>
        <span className={`font-mono text-[9px] px-2.5 py-1 rounded-lg ${verified ? "status-green" : "status-brass"}`}>
          {verified ? "ONCHAIN VERIFIED" : pending ? "PENDING RECEIPT" : "VERIFYING"}
        </span>
      </div>

      <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-4">
        <small className="block font-mono text-[8px] uppercase tracking-widest text-brass mb-2">Execution evidence</small>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[10px]">
          <div><strong>Execution asset:</strong> {tokenInSymbol} → {tokenOutSymbol}</div>
          <div><strong>Actual amount:</strong> {amountIn} {tokenInSymbol} → {amountOut} {tokenOutSymbol}</div>
          <div><strong>Token in:</strong> {market?.token_in ? compact(market.token_in) : "Not yet observed"}</div>
          <div><strong>Token out:</strong> {market?.token_out ? compact(market.token_out) : "Not yet observed"}</div>
          <div><strong>Pool fee:</strong> {market?.fee ?? "Not yet independently identified"}</div>
          <div><strong>Pool:</strong> {market?.pool ? compact(market.pool) : "Not yet independently identified"}</div>
          <div><strong>Execution wallet:</strong> {wallet ? compact(wallet) : "Not yet observed"}</div>
          <div><strong>Receipt:</strong> {execution?.execution?.status || "Not yet observed"}</div>
          <div><strong>Block:</strong> {execution?.execution?.block_number || "Not yet observed"}</div>
          <div><strong>Gas used:</strong> {execution?.execution?.gas_used || "Not yet observed"}</div>
        </div>
        {execution?.transaction_hash && <div className="mt-3 text-[10px]"><strong>Transaction:</strong> <a className="font-mono text-brass underline break-all" href={`https://testnet.bscscan.com/tx/${execution.transaction_hash}`} target="_blank" rel="noreferrer">{compact(execution.transaction_hash)} ↗</a></div>}
      </div>

      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5">
          <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Verification source</small>
          <strong className="font-mono text-[10.5px]">AgentMarket · BSC RPC</strong>
          <p className="text-[10px] text-inksoft mt-1">Receipt and transfer logs are read and checked by AgentMarket itself.</p>
        </div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5">
          <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Accounting</small>
          <strong className="font-mono text-[10.5px]">{execution?.accounting?.pnl_basis === "single_swap" ? "P&L basis not established" : "Onchain accounting"}</strong>
          <p className="text-[10px] text-inksoft mt-1">A single swap gives actual asset deltas, but not a defensible realized P&amp;L figure without a closing/valuation basis.</p>
        </div>
      </div>

      {pending && <div className="mt-3 text-[10px] text-brass">Transaction submitted, but its BSC Testnet receipt is not independently observable yet. AgentMarket will continue checking automatically.</div>}
      {error && <div className="mt-3 text-[10px] text-rust">Unable to refresh independent execution evidence: {error}</div>}
    </section>
  );
}
