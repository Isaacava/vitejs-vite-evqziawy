import { useEffect, useState } from "react";
import { createPublicClient, http, parseUnits, type Address, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import { getExecutionCapability, TESTNET_U_TOKEN_ADDRESS } from "./lib/executionCapital";
import ExecutionCapitalCard, { type OnchainExecutionSummary } from "./ExecutionCapitalCard";
import ExecutionCapitalRequestGate from "./ExecutionCapitalRequestGate";
import AltanaWalletGate from "./AltanaWalletGate";
import AltanaSessionGrantGate from "./AltanaSessionGrantGate";
import ExecutionCapitalLivePanel from "./ExecutionCapitalLivePanel";
import { ensureAltanaTradingCapital } from "./lib/executionCapitalFunding";

type Props = {
  request: ExecutionCapitalRequest | null;
  jobBudget: string | number | null;
  jobCurrency: string;
};

type ExecutionRequirement = {
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
  source_url?: string;
};

type AssetState = {
  balance: bigint;
  allowance: bigint;
  decimals: number;
};

const publicClient = createPublicClient({
  chain: bscTestnet,
  transport: http("https://bsc-testnet-rpc.publicnode.com"),
});

const ERC20_STATE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "remaining", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

function parseCapitalAmount(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  try { const amount = BigInt(value); return amount > 0n ? amount : null; } catch { return null; }
}

function normalizedCapitalToken(request: ExecutionCapitalRequest | null, requirement: ExecutionRequirement | null) {
  const token = requirement?.execution_capital?.token || request?.capital_token || "";
  if (!token || ["bnb", "tbnb", "tbn"].includes(token.toLowerCase())) return TESTNET_U_TOKEN_ADDRESS;
  return token;
}

function humanAmount(value: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function requestedRawAmount(value: string | null, decimals: number) {
  if (!value) return null;
  try {
    const parsed = parseUnits(value, decimals);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

export default function ExecutionCapitalPanel({ request, jobBudget, jobCurrency }: Props) {
  const capability = getExecutionCapability(request);
  const capitalAmount = parseCapitalAmount(request?.capital_requested || null);
  const [requirement, setRequirement] = useState<ExecutionRequirement | null>(null);
  const [requirementError, setRequirementError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [onchainExecution, setOnchainExecution] = useState<OnchainExecutionSummary | null>(null);
  const [liveFunded, setLiveFunded] = useState(false);
  const [requestCreated, setRequestCreated] = useState(false);
  const [liveStateError, setLiveStateError] = useState("");
  const [assetState, setAssetState] = useState<AssetState | null>(null);
  const [fundingBusy, setFundingBusy] = useState(false);
  const [fundingError, setFundingError] = useState("");
  const [fundingTx, setFundingTx] = useState<string>("");

  useEffect(() => {
    const jobId = request?.job_id || new URLSearchParams(window.location.search).get("job")?.trim() || "";
    if (!jobId) return;
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const statusResponse = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
        const statusBody = await statusResponse.json().catch(() => null) as Record<string, any> | null;
        if (!statusResponse.ok) throw new Error(statusBody?.error || "Unable to read the live job state");
        const chainStatus = String(statusBody?.chain?.chain_status || "").toLowerCase();
        const workflowStatus = String(statusBody?.job?.status || "").toLowerCase();
        const isSubmitted = chainStatus === "submitted" || workflowStatus === "submitted";
        if (active) setSubmitted(isSubmitted);
        if (isSubmitted) {
          if (active) { setRequirement(null); setRequirementError(""); }
        } else {
          try {
            const response = await fetch(`/api/testnet?route=execution-capital-requirement&job=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
            const body = await response.json().catch(() => null) as { ok?: boolean; error?: string } & ExecutionRequirement;
            if (!response.ok) throw new Error(body?.error || "Unable to resolve the agent's execution-token requirement");
            if (active) { setRequirement(body); setRequirementError(""); }
          } catch (cause) {
            if (active) setRequirementError(cause instanceof Error ? cause.message : "Unable to resolve execution-token requirement");
          }
        }
        if (active && (chainStatus === "funded" || workflowStatus === "funded" || chainStatus === "open" || workflowStatus === "open")) {
          setLiveFunded(chainStatus === "funded" || workflowStatus === "funded");
        }
        if (active && !isSubmitted && (chainStatus === "funded" || workflowStatus === "funded" || chainStatus === "open" || workflowStatus === "open")) timer = window.setTimeout(() => void refresh(), 1500);
      } catch (cause) {
        if (!active) return;
        if (!submitted) setLiveStateError(cause instanceof Error ? cause.message : "Unable to read the live job state");
        timer = window.setTimeout(() => void refresh(), 4000);
      }
    };
    void refresh();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [request?.job_id]);

  useEffect(() => {
    const jobId = request?.job_id || new URLSearchParams(window.location.search).get("job")?.trim() || "";
    if (!jobId) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/testnet?route=execution-evidence&job=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as OnchainExecutionSummary & { error?: string };
        if (!active) return;
        if (!response.ok) throw new Error(body?.error || "Unable to verify execution directly from BSC Testnet");
        setOnchainExecution(body);
      } catch {
        if (active) setOnchainExecution(null);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [request?.job_id]);

  useEffect(() => {
    if (request || requestCreated) { setLiveFunded(false); return; }
    const jobId = new URLSearchParams(window.location.search).get("job")?.trim() || "";
    if (!jobId) { setLiveFunded(false); return; }
    let active = true;
    let timer: number | undefined;
    const checkLiveState = async () => {
      try {
        const response = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
        const body = await response.json().catch(() => null) as Record<string, any> | null;
        if (!response.ok) throw new Error(body?.error || "Unable to read the live job state");
        if (!active) return;
        const chainStatus = String(body?.chain?.chain_status || "").toLowerCase();
        const workflowStatus = String(body?.job?.status || "").toLowerCase();
        const status = chainStatus || workflowStatus;
        setLiveFunded(status === "funded");
        setLiveStateError("");
        if (status === "funded" || status === "open") timer = window.setTimeout(() => void checkLiveState(), 1500);
      } catch (cause) {
        if (!active) return;
        setLiveStateError(cause instanceof Error ? cause.message : "Unable to read the live job state");
        timer = window.setTimeout(() => void checkLiveState(), 4000);
      }
    };
    void checkLiveState();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [request, requestCreated]);

  const capitalToken = normalizedCapitalToken(request, requirement);
  const capitalSymbol = requirement?.execution_capital?.symbol || requirement?.execution_market?.token_in_symbol || (request ? "CAKE2" : "execution token");
  const capitalDecimals = requirement?.execution_capital?.decimals ?? 18;
  const capitalDisplayAmount = requirement?.execution_capital?.required_amount || request?.capital_requested || "1";
  const capabilityWithMarket = capability;
  const fundingLink = requirement?.execution_capital?.token
    ? `/testnet/swap?token=${encodeURIComponent(capitalSymbol)}&address=${encodeURIComponent(requirement.execution_capital.token)}`
    : "/testnet/swap";

  const approvalSpenders = (capability?.allowed_targets || []).filter((target) => target.toLowerCase() !== capitalToken.toLowerCase());
  const approvalSpender = approvalSpenders.length === 1 ? approvalSpenders[0] : undefined;

  useEffect(() => {
    if (!request || submitted || (request.status !== "authorized" && request.status !== "active") || !request.user_execution_wallet) {
      setAssetState(null);
      return;
    }
    const token = capitalToken as Address;
    const spender = approvalSpender;
    if (!/^0x[a-fA-F0-9]{40}$/.test(token) || !/^0x[a-fA-F0-9]{40}$/.test(request.user_execution_wallet)) {
      setAssetState(null);
      return;
    }
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const decimals = Number(await publicClient.readContract({ address: token, abi: ERC20_STATE_ABI, functionName: "decimals" }));
        const balance = await publicClient.readContract({ address: token, abi: ERC20_STATE_ABI, functionName: "balanceOf", args: [request.user_execution_wallet as Address] });
        const allowance = spender && /^0x[a-fA-F0-9]{40}$/.test(spender)
          ? await publicClient.readContract({ address: token, abi: ERC20_STATE_ABI, functionName: "allowance", args: [request.user_execution_wallet as Address, spender as Address] })
          : 0n;
        if (!active) return;
        setAssetState({ balance, allowance, decimals });
        timer = window.setTimeout(() => void refresh(), 10_000);
      } catch {
        if (active) timer = window.setTimeout(() => void refresh(), 15_000);
      }
    };
    void refresh();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [request?.id, request?.status, request?.user_execution_wallet, submitted, capitalToken, approvalSpender]);

  const requiredAmountDisplay = requirement?.execution_capital?.required_amount || request?.capital_requested || "";
  const requiredRawDisplay = requirement?.execution_capital?.required_amount_raw || request?.spend_cap || "";
  const requiredRaw = assetState
    ? (requiredRawDisplay && /^\d+$/.test(requiredRawDisplay)
      ? BigInt(requiredRawDisplay)
      : requestedRawAmount(requiredAmountDisplay || null, assetState.decimals))
    : null;
  const needsFunding = Boolean(assetState && requiredRaw !== null && assetState.balance < requiredRaw);
  const needsAllowance = Boolean(assetState && requiredRaw !== null && approvalSpender && assetState.allowance < requiredRaw);

  async function repairFunding() {
    if (!request?.user_execution_wallet || requiredRaw === null || !approvalSpender) return;
    setFundingBusy(true);
    setFundingError("");
    try {
      const result = await ensureAltanaTradingCapital(
        request.user_execution_wallet as Address,
        capitalToken as Address,
        requiredRaw,
        approvalSpender as Address,
        requiredRaw,
      );
      setFundingTx(result.transactionHash || "");
      setAssetState((current) => current ? { ...current, balance: requiredRaw > current.balance ? requiredRaw : current.balance, allowance: requiredRaw } : current);
    } catch (cause) {
      setFundingError(cause instanceof Error ? cause.message : "Execution-capital funding failed");
    } finally {
      setFundingBusy(false);
    }
  }

  return (
    <div className="mb-6 space-y-4">
      <ExecutionCapitalCard request={request} jobBudget={jobBudget} jobCurrency={jobCurrency} onchainExecution={onchainExecution} />

      {!submitted && request && (request.status === "authorized" || request.status === "active") && request.user_execution_wallet && (needsFunding || needsAllowance) && (
        <section className="border border-[#cfad9f] bg-rustsoft text-rust rounded-[16px_8px_18px_9px] p-5">
          <small className="block font-mono text-[8.5px] uppercase tracking-widest mb-1.5">Execution capital readiness</small>
          <h3 className="font-display text-[17px] font-bold m-0">Authorized, but not execution-ready</h3>
          <p className="text-[10.5px] mt-1.5 max-w-[700px]">The Altana session is authorized, but the same execution wallet does not currently hold enough of the authorized token or allowance for the agent to perform the job. AgentMarket will not substitute another wallet.</p>
          {assetState && requiredRaw !== null && <div className="mt-3 font-mono text-[9.5px]">Balance {humanAmount(assetState.balance, assetState.decimals)} {capitalSymbol} · Required {humanAmount(requiredRaw, assetState.decimals)} {capitalSymbol}{approvalSpender && ` · Allowance ${humanAmount(assetState.allowance, assetState.decimals)} ${capitalSymbol}`}</div>}
          {approvalSpender && <div className="mt-2 text-[9.5px] break-all">Approval spender: <span className="font-mono">{approvalSpender}</span></div>}
          {!approvalSpender && capability?.allowed_targets && capability.allowed_targets.length > 1 && <div className="mt-2 text-[9.5px]">AgentMarket could not select a unique ERC-20 approval spender from the declared execution scope, so no allowance transaction is offered.</div>}
          {fundingError && <div className="mt-3 border border-[#cfad9f] bg-paper px-3 py-2 rounded-lg text-[10.5px]">{fundingError}</div>}
          {fundingTx && <a className="mt-3 inline-block font-mono text-[9px] text-brass break-all" href={`https://testnet.bscscan.com/tx/${fundingTx}`} target="_blank" rel="noreferrer">Execution readiness transaction ↗</a>}
          <button type="button" onClick={() => void repairFunding()} disabled={fundingBusy || !approvalSpender || requiredRaw === null} className="mt-4 font-display font-bold text-[11px] px-4 py-2.5 bg-ink text-paperhi btn-asym">{fundingBusy ? "Repairing execution readiness…" : needsAllowance ? `Approve ${capitalDisplayAmount} ${capitalSymbol} for the authorized session →` : `Repair execution readiness for the authorized session →`}</button>
        </section>
      )}

      {!request && liveFunded && !requestCreated && (() => {
        const jobId = new URLSearchParams(window.location.search).get("job")?.trim() || "";
        return jobId ? <ExecutionCapitalRequestGate jobId={jobId} jobBudget={jobBudget} jobCurrency={jobCurrency} onRequested={() => setRequestCreated(true)} /> : null;
      })()}

      {!request && !liveFunded && liveStateError && <section className="border border-[#cfad9f] bg-rustsoft text-rust rounded-[16px_8px_18px_9px] p-4 text-[10.5px]">Unable to confirm the live Funded state right now. The execution-capital request remains unavailable until the chain state can be verified.</section>}

      {requirementError && !submitted && <section className="border border-[#cfad9f] bg-rustsoft text-rust rounded-[16px_8px_18px_9px] p-4 text-[10.5px]">Unable to resolve the agent's execution-token requirement yet: {requirementError}</section>}

      {request && request.status === "requested" && !capability && <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5"><small className="block font-mono text-[8.5px] uppercase tracking-widest text-brass mb-1.5">Execution Capital · Provider Capability</small><h3 className="font-display text-[17px] font-bold m-0">Waiting for a valid execution scope</h3><p className="text-[10.5px] text-inksoft mt-1.5 max-w-[680px]">AgentMarket has not received a valid BSC Testnet Altana capability descriptor for this request. No session grant is shown until the provider publishes a public session key, target allowlist, and selector allowlist.</p></section>}

      {request && request.status === "requested" && capabilityWithMarket && (
        <>
          <AltanaWalletGate />
          {capitalAmount ? (
            <AltanaSessionGrantGate
              requestId={request.id}
              agentSessionAddress={capabilityWithMarket.session_key_address as Address}
              agentSessionPublicKey={capabilityWithMarket.session_key_public_key as Hex}
              allowedCalls={capabilityWithMarket.allowed_targets as readonly Address[]}
              allowedSelectors={capabilityWithMarket.allowed_selectors as readonly Hex[]}
              capitalAmount={capitalAmount}
              capitalToken={capitalToken as Address}
              capitalSymbol={capitalSymbol}
              capitalDecimals={capitalDecimals}
              purpose={request.purpose}
              durationSeconds={request.requested_duration_seconds || request.duration_seconds || 86400}
              capabilitySource={capabilityWithMarket.source_url}
            />
          ) : (
            <section className="border border-[#cfad9f] bg-rustsoft text-rust rounded-[16px_8px_18px_9px] bg-rustsoft p-5 text-[11px]">Execution capital was requested with a non-integer amount that the current Altana spend-permission adapter cannot safely encode. The request remains un-authorized.</section>
          )}
          <div className="text-[10px] text-inksoft">Agent execution token: <strong>{capitalDisplayAmount} {capitalSymbol}</strong> · <a className="text-brass" href={fundingLink}>Get {capitalSymbol} on PancakeSwap Testnet →</a></div>
        </>
      )}

      {request && capability && (request.status === "authorized" || request.status === "active") && !needsFunding && !needsAllowance && <ExecutionCapitalLivePanel request={request} />}
    </div>
  );
}
