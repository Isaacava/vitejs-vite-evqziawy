import { useEffect, useState } from "react";
import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import { getExecutionCapability } from "./lib/executionCapital";

type Props = { request: ExecutionCapitalRequest };
type Requirement = {
  execution_market?: {
    token_in?: string | null;
    token_out?: string | null;
    token_in_symbol?: string | null;
    token_out_symbol?: string | null;
    fee?: number | null;
  };
  execution_capital?: {
    token?: string | null;
    symbol?: string | null;
    decimals?: number | null;
    required_amount?: string | null;
    required_amount_raw?: string | null;
  };
};

function compact(value?: string | null) {
  return value ? `${value.slice(0, 10)}…${value.slice(-8)}` : "—";
}

export default function ExecutionCapitalLivePanel({ request }: Props) {
  const capability = getExecutionCapability(request);
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [requirementError, setRequirementError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/testnet?route=execution-capital-requirement&job=${encodeURIComponent(request.job_id)}`,
          { credentials: "include", cache: "no-store" },
        );
        const body = await response.json().catch(() => null) as Requirement & { error?: string };
        if (!response.ok) throw new Error(body?.error || "Unable to resolve the agent execution scope");
        if (!active) return;
        setRequirement(body);
        setRequirementError("");
      } catch (cause) {
        if (active) setRequirementError(cause instanceof Error ? cause.message : "Unable to resolve the agent execution scope");
      }
    })();
    return () => { active = false; };
  }, [request.job_id]);

  const market = requirement?.execution_market;
  const capital = requirement?.execution_capital;
  const tokenIn = market?.token_in || request.capital_token || "";
  const tokenOut = market?.token_out || "";
  const tokenInSymbol = capital?.symbol || market?.token_in_symbol || "execution token";
  const tokenOutSymbol = market?.token_out_symbol || "output token";
  const amount = capital?.required_amount || request.capital_requested || null;
  const fee = market?.fee;
  const wallet = request.user_execution_wallet || null;
  const authorized = request.status === "authorized" || request.status === "active";
  const chainReady = capability?.network === "bsc-testnet" && Number(capability.chainId) === 97;

  if (!authorized) return null;

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1">Live execution · Testnet</small>
          <h3 className="font-display text-[18px] font-bold m-0">Agent execution</h3>
          <p className="text-[10.5px] text-inksoft mt-1">The agent performs execution and its own pre-execution checks. AgentMarket observes the authorized scope and independently verifies resulting chain evidence.</p>
        </div>
        <span className="status-green font-mono text-[9px] px-2.5 py-1 rounded-lg">AUTHORIZED</span>
      </div>

      <div className="mt-4 border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-4">
        <small className="block font-mono text-[8px] uppercase tracking-widest text-brass mb-2">Execution scope</small>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[10px]">
          <div><strong>Execution asset:</strong> {tokenInSymbol} → {tokenOutSymbol}</div>
          <div><strong>Required amount:</strong> {amount ? `${amount} ${tokenInSymbol}` : "Not yet observed"}</div>
          <div><strong>Token in:</strong> {tokenIn ? compact(tokenIn) : "Not yet observed"}</div>
          <div><strong>Token out:</strong> {tokenOut ? compact(tokenOut) : "Not yet observed"}</div>
          <div><strong>Pool fee:</strong> {fee ?? "Not yet observed"}</div>
          <div><strong>Execution wallet:</strong> {wallet ? compact(wallet) : "Not yet observed"}</div>
        </div>
      </div>

      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5">
          <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Session</small>
          <strong className="font-mono text-[10.5px]">{chainReady ? "Altana · KeyStore verified" : "Authorization pending"}</strong>
          <p className="text-[10px] text-inksoft mt-1">The user has already authorized the scoped execution session.</p>
        </div>
        <div className="border border-line rounded-[12px_7px_13px_8px] bg-paperhi p-3.5">
          <small className="block font-mono text-[8px] uppercase text-[#8a8477] mb-1">Agent status</small>
          <strong className="font-mono text-[10.5px]">Execution handled by agent</strong>
          <p className="text-[10px] text-inksoft mt-1">AgentMarket does not ask the user to run a trade or preflight.</p>
        </div>
      </div>

      {requirementError && <div className="mt-3 text-[10px] text-rust">Unable to refresh the declared execution scope: {requirementError}</div>}
    </section>
  );
}
