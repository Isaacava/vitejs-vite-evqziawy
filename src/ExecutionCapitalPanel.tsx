import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import { getExecutionCapability, TESTNET_U_TOKEN_ADDRESS } from "./lib/executionCapital";
import ExecutionCapitalCard from "./ExecutionCapitalCard";
import ExecutionCapitalRequestGate from "./ExecutionCapitalRequestGate";
import AltanaWalletGate from "./AltanaWalletGate";
import AltanaSessionGrantGate from "./AltanaSessionGrantGate";
import ExecutionCapitalLivePanel from "./ExecutionCapitalLivePanel";

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

function normalizedCapitalToken(request: ExecutionCapitalRequest | null) {
  const token = String(request?.capital_token || "").trim();
  if (!token || token.toLowerCase() === "bnb" || token.toLowerCase() === "tbn" || token.toLowerCase() === "tbnb") {
    return TESTNET_U_TOKEN_ADDRESS;
  }
  return token;
}

export default function ExecutionCapitalPanel({ request, jobBudget, jobCurrency }: Props) {
  const capability = getExecutionCapability(request);
  const capitalAmount = parseCapitalAmount(request?.capital_requested || null);
  const capitalToken = normalizedCapitalToken(request);
  const [liveFunded, setLiveFunded] = useState(false);
  const [requestCreated, setRequestCreated] = useState(false);
  const [liveStateError, setLiveStateError] = useState("");

  useEffect(() => {
    if (request || requestCreated) {
      setLiveFunded(false);
      return;
    }

    const jobId = new URLSearchParams(window.location.search).get("job")?.trim() || "";
    if (!jobId) {
      setLiveFunded(false);
      return;
    }

    let active = true;
    let timer: number | undefined;

    const checkLiveState = async () => {
      try {
        const response = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`, {
          credentials: "include",
          cache: "no-store",
        });
        const body = await response.json().catch(() => null) as Record<string, any> | null;
        if (!response.ok) throw new Error(body?.error || "Unable to read the live job state");
        if (!active) return;

        const chainStatus = String(body?.chain?.chain_status || "").toLowerCase();
        const workflowStatus = String(body?.job?.status || "").toLowerCase();
        const status = chainStatus || workflowStatus;
        setLiveFunded(status === "funded");
        setLiveStateError("");

        if (status === "funded" || status === "open") {
          timer = window.setTimeout(() => void checkLiveState(), 1500);
        }
      } catch (cause) {
        if (!active) return;
        setLiveStateError(cause instanceof Error ? cause.message : "Unable to read the live job state");
        timer = window.setTimeout(() => void checkLiveState(), 4000);
      }
    };

    void checkLiveState();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [request, requestCreated]);

  return (
    <div className="mb-6 space-y-4">
      <ExecutionCapitalCard request={request} jobBudget={jobBudget} jobCurrency={jobCurrency} />

      {!request && liveFunded && !requestCreated && (() => {
        const jobId = new URLSearchParams(window.location.search).get("job")?.trim() || "";
        return jobId ? (
          <ExecutionCapitalRequestGate
            jobId={jobId}
            jobBudget={jobBudget}
            jobCurrency={jobCurrency}
            onRequested={() => setRequestCreated(true)}
          />
        ) : null;
      })()}

      {!request && !liveFunded && liveStateError && (
        <section className="border border-[#cfad9f] bg-rustsoft text-rust rounded-[16px_8px_18px_9px] p-4 text-[10.5px]">
          Unable to confirm the live Funded state right now. The execution-capital request remains unavailable until the chain state can be verified.
        </section>
      )}

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
              capitalToken={capitalToken as Address}
              purpose={request.purpose}
              durationSeconds={request.requested_duration_seconds || request.duration_seconds || 86400}
              capabilitySource={capability.source_url}
            />
          ) : (
            <section className="border border-[#cfad9f] bg-rustsoft text-rust rounded-[16px_8px_18px_9px] p-5 text-[11px]">
              Execution capital was requested with a non-integer amount that the current Altana spend-permission adapter cannot safely encode. The request remains un-authorized.
            </section>
          )}
        </>
      )}

      {request && capability && (request.status === "authorized" || request.status === "active") && (
        <ExecutionCapitalLivePanel request={request} />
      )}
    </div>
  );
}
