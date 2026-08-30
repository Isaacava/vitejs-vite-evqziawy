import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import { isVerifiedAuthorization } from "./lib/executionCapital";
import type { OnchainExecutionSummary } from "./ExecutionCapitalCard";
import AltanaSessionGrantGate from "./AltanaSessionGrantGate";

type Props = { request: ExecutionCapitalRequest };

type ReceiptStatus = { observed: boolean; transaction_hash?: string; error?: string };

function compact(value?: string | null) {
  return value ? `${value.slice(0, 10)}…${value.slice(-8)}` : "—";
}

function missingReceiptError(value?: string) {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized.includes("transaction receipt") &&
    (normalized.includes("could not be found") || normalized.includes("not processed on a block") || normalized.includes("receipt not found"));
}

function transactionHashFromError(value?: string) {
  const match = value?.match(/0x[a-fA-F0-9]{64}/);
  return match?.[0] || null;
}

function transactionHashFromExecution(value?: OnchainExecutionSummary | null) {
  return typeof value?.transaction_hash === "string" && /^0x[a-fA-F0-9]{64}$/.test(value.transaction_hash)
    ? value.transaction_hash
    : null;
}

function object(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export default function ExecutionCapitalLivePanel({ request }: Props) {
  const [execution, setExecution] = useState<OnchainExecutionSummary | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const authorizationVerified = isVerifiedAuthorization(request);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const response = await fetch(`/api/testnet?route=execution-evidence&job=${encodeURIComponent(request.job_id)}`, {
          credentials: "include",
          cache: "no-store",
        });
        const body = await response.json().catch(() => null) as (OnchainExecutionSummary & { error?: string }) | null;
        if (!active) return;

        if (!response.ok) {
          const message = body?.error || "Unable to verify execution directly from BSC Testnet";
          if (missingReceiptError(message)) {
            const candidateHash = transactionHashFromError(message);
            if (candidateHash) {
              try {
                const receiptResponse = await fetch(`/api/testnet/execution-receipt?tx_hash=${encodeURIComponent(candidateHash)}`, {
                  credentials: "include",
                  cache: "no-store",
                });
                const receiptBody = await receiptResponse.json().catch(() => null) as ReceiptStatus | null;
                if (active && receiptResponse.ok && receiptBody?.observed === false) {
                  setPending(true);
                  setError("");
                  return;
                }
              } catch {
                // Keep the candidate hash as pending evidence below.
              }
            }
            setPending(Boolean(candidateHash));
            setError("");
            return;
          }
          throw new Error(message);
        }

        setExecution(body);
        const txHash = transactionHashFromExecution(body);
        setPending(Boolean(body?.observed === false && txHash));
        setError("");
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Unable to verify execution directly from BSC Testnet");
        }
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [request.job_id]);

  const market = execution?.market;
  const wallet = execution?.execution?.execution_wallet || request.user_execution_wallet || null;
  const verifiedExecution = Boolean(execution?.observed && market?.verified_onchain);
  const amountIn = market?.token_in_amount || "Not yet observed";
  const amountOut = market?.token_out_amount || "Not yet observed";
  const tokenInSymbol = market?.token_in_symbol || "CAKE2";
  const tokenOutSymbol = market?.token_out_symbol || "WBNB";

  const capability = object(request.evidence?.execution_capability);
  const capabilityMarket = object(capability.execution_market);
  const capabilitySourceUrl = typeof capability.source_url === "string" ? capability.source_url.trim() : "";
  const sessionAddress = typeof capability.session_key_address === "string" ? capability.session_key_address : request.agent_session_key;
  const sessionPublicKey = typeof capability.session_key_public_key === "string" ? capability.session_key_public_key : null;
  const allowedCalls = Array.isArray(capability.allowed_targets)
    ? capability.allowed_targets.filter((value): value is Address => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value))
    : [];
  const allowedSelectors = Array.isArray(capability.allowed_selectors)
    ? capability.allowed_selectors.filter((value): value is Hex => typeof value === "string" && /^0x[a-fA-F0-9]{8}$/.test(value))
    : [];
  const capitalToken = request.capital_token as Address;
  const capitalAmount = (() => {
    try {
      const value = BigInt(request.capital_requested || "1");
      return value > 0n ? value : 1n;
    } catch {
      return 1n;
    }
  })();
  const approvalSpenders = allowedCalls.filter((value) => value.toLowerCase() !== capitalToken.toLowerCase());
  const approvalSpender = approvalSpenders.length === 1 ? approvalSpenders[0] : undefined;
  const needsAuthorization = !authorizationVerified;
  const canRenderAuthorization = Boolean(capabilitySourceUrl && sessionAddress && sessionPublicKey && allowedCalls.length > 0 && allowedSelectors.length > 0);
  const jobScopedCapabilityUrl = (() => {
    if (!capabilitySourceUrl) return "";
    const url = new URL(capabilitySourceUrl, window.location.origin);
    if (!url.searchParams.has("job_id")) url.searchParams.set("job_id", String(request.job_id));
    return url.toString();
  })();

  return (
    <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1">Live execution · Testnet</small>
          <h3 className="font-display text-[18px] font-bold m-0">Agent execution</h3>
          <p className="text-[10.5px] text-inksoft mt-1">Execution evidence is independently read from BSC Testnet. AgentMarket does not dispatch the agent or sign execution calls.</p>
        </div>
        <span className={`font-mono text-[9px] px-2.5 py-1 rounded-lg ${verifiedExecution ? "status-green" : pending ? "status-brass" : error ? "status-rust" : "status-brass"}`}>
          {verifiedExecution ? "ONCHAIN VERIFIED" : pending ? "PENDING RECEIPT" : error ? "VERIFICATION ERROR" : "NOT YET OBSERVED"}
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
        {execution?.transaction_hash && <div className="mt-3 text-[10px]"><strong>Transaction:</strong>{" "}<a className="font-mono text-brass underline break-all" href={`https://testnet.bscscan.com/tx/${execution.transaction_hash}`} target="_blank" rel="noreferrer">{compact(execution.transaction_hash)} ↗</a></div>}
      </div>

      {error && <div className="mt-3 text-[10px] text-rust">Unable to refresh independent execution evidence: {error}</div>}
      {!pending && !verifiedExecution && !error && <div className="mt-3 text-[10px] text-inksoft">No independently observed execution transaction is recorded yet. The hired provider operates independently of AgentMarket.</div>}
      {pending && <div className="mt-3 text-[10px] text-brass">A transaction hash exists, but its BSC Testnet receipt is not independently observable yet. AgentMarket will keep checking automatically.</div>}

      {needsAuthorization && canRenderAuthorization && (
        <div className="mt-5">
          <AltanaSessionGrantGate
            requestId={request.id}
            agentSessionAddress={sessionAddress as Address}
            agentSessionPublicKey={sessionPublicKey as Hex}
            allowedCalls={allowedCalls}
            allowedSelectors={allowedSelectors}
            capitalAmount={capitalAmount}
            capitalToken={capitalToken}
            capitalSymbol={typeof capabilityMarket.token_in_symbol === "string" ? capabilityMarket.token_in_symbol : tokenInSymbol}
            capitalDecimals={18}
            approvalSpender={approvalSpender}
            purpose={request.purpose}
            durationSeconds={request.requested_duration_seconds || request.duration_seconds || 86400}
            capabilitySource={jobScopedCapabilityUrl}
            onAuthorized={() => window.location.reload()}
          />
        </div>
      )}
    </section>
  );
}
