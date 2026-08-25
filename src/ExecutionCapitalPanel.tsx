import type { Address, Hex } from "viem";
import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import { getExecutionCapability } from "./lib/executionCapital";
import ExecutionCapitalCard from "./ExecutionCapitalCard";
import AltanaWalletGate from "./AltanaWalletGate";
import AltanaSessionGrantGate from "./AltanaSessionGrantGate";

type Props = {
  request: ExecutionCapitalRequest | null;
  jobBudget: string | number | null;
  jobCurrency: string;
};

function parseCapitalAmount(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  try {
    const amount = BigInt(value);
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
}

export default function ExecutionCapitalPanel({ request, jobBudget, jobCurrency }: Props) {
  const capability = getExecutionCapability(request);
  const capitalAmount = parseCapitalAmount(request?.capital_requested || null);

  return (
    <div className="mb-6 space-y-4">
      <ExecutionCapitalCard request={request} jobBudget={jobBudget} jobCurrency={jobCurrency} />

      {request && request.status === "requested" && !capability && (
        <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5">
          <small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution Capital · Provider Capability</small>
          <h3 className="font-display text-[17px] font-bold m-0">Waiting for a valid execution scope</h3>
          <p className="text-[10.5px] text-inksoft mt-1.5 max-w-[680px]">AgentMarket has not received a valid BSC Testnet Altana capability descriptor for this request. No session grant is shown until the provider publishes a public session key, target allowlist, and selector allowlist.</p>
        </section>
      )}

      {request && request.status === "requested" && capability && (
        <>
          <AltanaWalletGate />
          {capitalAmount ? (
            <AltanaSessionGrantGate
              requestId={request.id}
              agentSessionAddress={capability.session_key_address as Address}
              agentSessionPublicKey={capability.session_key_public_key as Hex}
              allowedCalls={capability.allowed_targets as readonly Address[]}
              allowedSelectors={capability.allowed_selectors as readonly Hex[]}
              capitalAmount={capitalAmount}
              purpose={request.purpose}
              durationSeconds={request.duration_seconds || 3600}
              capabilitySource={capability.source_url}
            />
          ) : (
            <section className="border border-[#cfad9f] bg-rustsoft text-rust rounded-[16px_8px_18px_9px] p-5 text-[11px]">
              Execution capital was requested with a non-integer amount that the current Altana spend-permission adapter cannot safely encode. The request remains un-authorized.
            </section>
          )}
        </>
      )}
    </div>
  );
}
