import { useEffect, useMemo, useState } from "react";
import type { ExecutionCapitalRequest } from "./lib/executionCapital";
import ExecutionCapitalPanel from "./ExecutionCapitalPanel";

type JobView = {
  job: { id: string; status: string; description: string; budget: number | string; chain_job_id: number | null };
  task: { title: string; role: string } | null;
  mission: { title: string; goal: string } | null;
  payment: { token_symbol: string | null; amount: number | string } | null;
  execution_capital: ExecutionCapitalRequest | null;
  chain: { chain_job_id: number; chain_status: string; chain_budget: string; token_symbol: string } | null;
};

type Requirement = {
  execution?: string | null;
  wallet_provider?: string | null;
  authorization_model?: string | null;
  network?: string | null;
  chain_id?: number | null;
  capability_source_url?: string | null;
  source_url?: string | null;
  authorization?: {
    session_key_address?: string | null;
    session_key_public_key?: string | null;
    allowed_targets?: string[];
    allowed_selectors?: string[];
    selectors_required?: boolean;
    expiry?: number | null;
    execution_wallet?: string | null;
  } | null;
  execution_market?: Record<string, unknown> | null;
  execution_capital?: {
    token?: string | null;
    symbol?: string | null;
    decimals?: number | null;
    required_amount?: string | null;
    required_amount_raw?: string | null;
  } | null;
};

function capabilityEvidence(requirement: Requirement | null) {
  const authorization = requirement?.authorization || {};
  if (
    requirement?.network !== "bsc-testnet" ||
    Number(requirement.chain_id) !== 97 ||
    requirement.execution !== "altana-scoped-session" ||
    requirement.wallet_provider !== "altana" ||
    requirement.authorization_model !== "scoped_session"
  ) return null;

  const sessionAddress = authorization.session_key_address;
  const sessionPublicKey = authorization.session_key_public_key;
  const allowedTargets = Array.isArray(authorization.allowed_targets) ? authorization.allowed_targets : [];
  const allowedSelectors = Array.isArray(authorization.allowed_selectors) ? authorization.allowed_selectors : [];
  if (
    !/^0x[a-fA-F0-9]{40}$/.test(String(sessionAddress || "")) ||
    !/^0x[a-fA-F0-9]+$/.test(String(sessionPublicKey || "")) ||
    allowedTargets.length === 0 ||
    allowedSelectors.length === 0
  ) return null;

  return {
    type: "agent-execution-capability-v1",
    network: "bsc-testnet",
    chain_id: 97,
    execution: requirement.execution,
    wallet_provider: requirement.wallet_provider,
    authorization_model: requirement.authorization_model,
    session_key_address: sessionAddress,
    session_key_public_key: sessionPublicKey,
    allowed_targets: allowedTargets,
    allowed_selectors: allowedSelectors,
    selectors_required: authorization.selectors_required !== false,
    private_key_exposed: false,
    session_scope: "request-scoped",
    session_expiry: authorization.expiry ?? null,
    execution_market: requirement.execution_market || undefined,
    source_url: requirement.capability_source_url || requirement.source_url || "provider-capability",
    endpoint_id: "provider_operation",
    endpoint_status: "live",
    fetched_at: new Date().toISOString(),
    independently_authorized: false,
  };
}

export default function FixedMissionConsole() {
  const jobId = useMemo(() => new URLSearchParams(window.location.search).get("job")?.trim() || "", []);
  const [data, setData] = useState<JobView | null>(null);
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    const load = async () => {
      try {
        const [jobResponse, requirementResponse] = await Promise.all([
          fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" }),
          fetch(`/api/testnet?route=execution-capital-requirement&job=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" }),
        ]);
        const jobBody = await jobResponse.json().catch(() => null);
        const requirementBody = await requirementResponse.json().catch(() => null);
        if (!jobResponse.ok) throw new Error(jobBody?.error || "Unable to load mission");
        if (!requirementResponse.ok) throw new Error(requirementBody?.error || "Unable to resolve provider execution capability");
        if (!active) return;
        setData(jobBody as JobView);
        setRequirement(requirementBody as Requirement);
        setError("");
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Unable to load mission execution state");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [jobId]);

  if (!jobId) return <section className="card-asym-lg bg-paperhi p-8 text-[13px] text-inksoft">No mission selected.</section>;
  if (!data) return <section className="card-asym-lg bg-paperhi p-8 text-[13px] text-inksoft">{error || "Loading mission state…"}</section>;

  const verifiedCapability = capabilityEvidence(requirement);
  const baseRequest = data.execution_capital;
  const request: ExecutionCapitalRequest | null = baseRequest && verifiedCapability
    ? {
        ...baseRequest,
        wallet_provider: requirement?.wallet_provider || baseRequest.wallet_provider,
        authorization_model: requirement?.authorization_model || baseRequest.authorization_model,
        agent_session_key: requirement?.authorization?.session_key_address || baseRequest.agent_session_key,
        capital_token: requirement?.execution_capital?.token || baseRequest.capital_token,
        evidence: {
          ...(baseRequest.evidence || {}),
          execution_capability: verifiedCapability,
        },
      }
    : baseRequest;

  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8 md:px-8 font-body text-ink">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <span className="font-mono text-[9.5px] uppercase tracking-wide text-[#8a8477]">Missions / Mission console</span>
          <h1 className="mt-2 font-display text-[30px] font-bold tracking-tight">{data.mission?.title || data.job.description || "Mission"}</h1>
          <p className="mt-2 text-[12px] text-inksoft">{data.mission?.goal || data.task?.title || "Live ERC-8183 mission state"}</p>
        </div>
        <a href="/missions" className="text-[11px] font-bold text-inksoft no-underline">← Back to missions</a>
      </div>

      {error && <div className="mb-4 rounded-[14px_8px_15px_9px] border border-[#cfad9f] bg-rustsoft px-4 py-3 text-[12px] text-rust">{error}</div>}

      <section className="card-asym-lg bg-paperhi p-6 md:p-8">
        <div className="mb-6 grid gap-4 border-b border-dashed border-[#c8c0af] pb-6 sm:grid-cols-4">
          <div><small className="mb-1 block font-mono text-[8.5px] uppercase text-[#8a8477]">Agent</small><strong className="text-[15px]">{data.task?.role || "Provider"}</strong></div>
          <div><small className="mb-1 block font-mono text-[8.5px] uppercase text-[#8a8477]">Chain job ID</small><strong className="font-mono text-[14px]">#{data.chain?.chain_job_id ?? data.job.chain_job_id ?? "—"}</strong></div>
          <div><small className="mb-1 block font-mono text-[8.5px] uppercase text-[#8a8477]">Status</small><strong className="font-mono text-[14px]">{data.chain?.chain_status || data.job.status}</strong></div>
          <div><small className="mb-1 block font-mono text-[8.5px] uppercase text-[#8a8477]">Budget</small><strong className="font-mono text-[14px]">{data.chain?.chain_budget ?? data.job.budget} {data.chain?.token_symbol || data.payment?.token_symbol || "tBNB"}</strong></div>
        </div>

        {request ? (
          <ExecutionCapitalPanel
            request={request}
            jobBudget={data.chain?.chain_budget ?? data.job.budget ?? data.payment?.amount ?? null}
            jobCurrency={data.chain?.token_symbol || data.payment?.token_symbol || "tBNB"}
          />
        ) : (
          <section className="border border-line rounded-[16px_8px_18px_9px] bg-paper p-5 text-[12px] text-inksoft">
            This mission has no execution-capital request yet.
          </section>
        )}
      </section>
    </main>
  );
}
