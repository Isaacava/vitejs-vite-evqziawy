import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import "./evaluator-console.css";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const ROUTER = "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address;

const COMMERCE_ABI = [{
  type: "function",
  name: "getJob",
  stateMutability: "view",
  inputs: [{ name: "jobId", type: "uint256" }],
  outputs: [{ name: "job", type: "tuple", components: [
    { name: "id", type: "uint256" },
    { name: "client", type: "address" },
    { name: "provider", type: "address" },
    { name: "evaluator", type: "address" },
    { name: "description", type: "string" },
    { name: "budget", type: "uint256" },
    { name: "expiredAt", type: "uint256" },
    { name: "status", type: "uint8" },
    { name: "hook", type: "address" },
    { name: "submittedAt", type: "uint256" },
    { name: "deliverable", type: "bytes32" },
  ] }],
}] as const;

const ROUTER_ABI = [{
  type: "function",
  name: "jobPolicy",
  stateMutability: "view",
  inputs: [{ name: "jobId", type: "uint256" }],
  outputs: [{ type: "address" }],
}] as const;

const POLICY_ABI = [{
  type: "function",
  name: "check",
  stateMutability: "view",
  inputs: [{ name: "jobId", type: "uint256" }],
  outputs: [{ name: "verdict", type: "uint8" }],
}] as const;

const publicClient = createPublicClient({ chain: bscTestnet, transport: http() });
const STATUS: Record<number, string> = { 0: "OPEN", 1: "FUNDED", 2: "SUBMITTED", 3: "COMPLETED", 4: "REJECTED", 5: "EXPIRED" };
const POLICY: Record<number, string> = { 0: "PENDING", 1: "APPROVE", 2: "REJECT" };
const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

type ChainJob = {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  budget: bigint;
  status: number;
  submittedAt: bigint;
  deliverable: `0x${string}`;
};

export default function EvaluatorConsole() {
  const params = new URLSearchParams(window.location.search);
  const jobId = params.get("job") || "";
  const [job, setJob] = useState<ChainJob | null>(null);
  const [policyAddress, setPolicyAddress] = useState<string>("");
  const [policyVerdict, setPolicyVerdict] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (silent = false) => {
    if (!jobId || !/^\d+$/.test(jobId)) {
      setError("Open this page with ?job=<chain-job-id>.");
      return;
    }

    if (!silent) setRefreshing(true);
    setError("");

    try {
      const chainJob = await publicClient.readContract({
        address: COMMERCE,
        abi: COMMERCE_ABI,
        functionName: "getJob",
        args: [BigInt(jobId)],
      }) as unknown as ChainJob;

      if (!chainJob || chainJob.id === 0n) throw new Error("Chain job was not found on BSC Testnet.");

      const jobPolicy = await publicClient.readContract({
        address: ROUTER,
        abi: ROUTER_ABI,
        functionName: "jobPolicy",
        args: [BigInt(jobId)],
      }) as Address;

      let verdict: number | null = null;
      if (Number(chainJob.status) === 2) {
        verdict = Number(await publicClient.readContract({
          address: jobPolicy,
          abi: POLICY_ABI,
          functionName: "check",
          args: [BigInt(jobId)],
        }));
      }

      setJob(chainJob);
      setPolicyAddress(jobPolicy);
      setPolicyVerdict(verdict);

      if (Number(chainJob.status) === 2) {
        if (verdict === 0) setNotice("Submitted. The optimistic dispute window is still open; AgentMarket will settle automatically when the policy leaves PENDING.");
        else if (verdict === 1) setNotice("Policy approved. AgentMarket settlement worker will finalize the job automatically.");
        else if (verdict === 2) setNotice("Policy rejected. AgentMarket settlement worker will finalize the refund path automatically.");
      } else if ([3, 4, 5].includes(Number(chainJob.status))) {
        setNotice(`Terminal chain state verified: ${STATUS[Number(chainJob.status)]}.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to read evaluator state");
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, [jobId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const terminal = job ? [3, 4, 5].includes(Number(job.status)) : false;
  const submitted = job && Number(job.status) === 2;

  return (
    <main className="evaluator-page">
      <div className="evaluator-curve evaluator-curve-a" aria-hidden="true" />
      <div className="evaluator-curve evaluator-curve-b" aria-hidden="true" />
      <div className="evaluator-shell">
        <header className="evaluator-nav">
          <a href="/" className="evaluator-brand">AgentMarket</a>
          <span>TESTNET / EVALUATOR / SETTLEMENT</span>
          <div className="evaluator-nav-actions">
            <a href={`/lifecycle?job=${encodeURIComponent(jobId)}`}>Dispute / refund →</a>
            <a href={`/dashboard?job=${encodeURIComponent(jobId)}`}>Back to dashboard →</a>
          </div>
        </header>

        {error && <div className="evaluator-alert evaluator-alert-error">{error}</div>}
        {notice && <div className="evaluator-alert evaluator-alert-success">{notice}</div>}

        <section className="evaluator-hero">
          <div>
            <span className="evaluator-kicker">ERC-8183 / BSC TESTNET / 97</span>
            <h1>Settlement follows the Testnet policy, not a user button.</h1>
            <p>AgentMarket reads the live Commerce job and OptimisticPolicy. Once the policy reaches a final verdict, the permissionless settlement worker finalizes the job without requiring the client wallet to sign another transaction.</p>
          </div>
          <div className="evaluator-state">
            <small>CHAIN STATUS</small>
            <strong>{job ? STATUS[Number(job.status)] || `STATUS ${Number(job.status)}` : "LOADING"}</strong>
            <span>Job #{jobId || "—"} · BSC Testnet</span>
          </div>
        </section>

        <div className="evaluator-grid">
          <section className="evaluator-card">
            <div className="evaluator-head">
              <span>01 / JOB EVIDENCE</span>
              <b>{job ? STATUS[Number(job.status)] || "UNKNOWN" : "WAITING"}</b>
            </div>
            {job ? (
              <div className="evaluator-lines">
                <div><span>CLIENT</span><strong>{compact(job.client)}</strong></div>
                <div><span>PROVIDER</span><strong>{compact(job.provider)}</strong></div>
                <div><span>EVALUATOR</span><strong>{compact(job.evaluator)}</strong></div>
                <div><span>POLICY</span><strong>{compact(policyAddress)}</strong></div>
                <div><span>BUDGET</span><strong>{job.budget.toString()}</strong></div>
                <div><span>SUBMITTED AT</span><strong>{Number(job.submittedAt) ? new Date(Number(job.submittedAt) * 1000).toLocaleString() : "—"}</strong></div>
                <div className="evaluator-full"><span>DELIVERABLE HASH</span><strong>{job.deliverable}</strong></div>
              </div>
            ) : (
              <div className="evaluator-empty">Reading the Testnet chain job…</div>
            )}
          </section>

          <aside className="evaluator-card evaluator-policy-card">
            <div className="evaluator-head"><span>02 / OPTIMISTIC POLICY</span><b>LIVE</b></div>
            <h2>{submitted ? (policyVerdict === null ? "Reading policy…" : POLICY[policyVerdict] || `VERDICT ${policyVerdict}`) : terminal ? "FINAL" : "WAITING"}</h2>
            <p>After submission, silence during the dispute window leaves the policy pending. When the policy returns APPROVE or REJECT, `settle(jobId)` can be called permissionlessly to apply that verdict to the Commerce job.</p>
            <div className="evaluator-rule"><span>0</span><strong>Pending</strong><small>Dispute window still active</small></div>
            <div className="evaluator-rule"><span>1</span><strong>Approve</strong><small>Settlement completes the job</small></div>
            <div className="evaluator-rule"><span>2</span><strong>Reject</strong><small>Settlement refunds the client</small></div>
          </aside>
        </div>

        <section className="evaluator-card evaluator-settle-card">
          <div>
            <span className="evaluator-kicker">03 / AUTOMATIC TESTNET SETTLEMENT</span>
            <h2>{terminal ? "Terminal state verified." : submitted ? "Settlement is monitored automatically." : "Waiting for SUBMITTED."}</h2>
            <p>
              {terminal
                ? "The chain is terminal. AgentMarket mirrors the verified outcome into marketplace history after receipt verification."
                : submitted
                  ? "No second wallet connection is required. AgentMarket's settlement worker checks the live policy and submits the permissionless router.settle(jobId) transaction when the verdict is ready."
                  : "The settlement worker only acts after the BSC Testnet chain reports SUBMITTED."}
            </p>
          </div>
          <div className="evaluator-actions">
            <button onClick={() => void refresh()} disabled={refreshing}>
              {refreshing ? "Reading chain…" : "Refresh Testnet chain state"}
            </button>
          </div>
          {terminal && (
            <div className="evaluator-tx">
              <small>VERIFIED TERMINAL STATE</small>
              <strong>{STATUS[Number(job?.status)]}</strong>
            </div>
          )}
          <small className="evaluator-note">The client wallet is only required for client actions such as dispute. Settlement is permissionless in the BNB OptimisticPolicy architecture, so AgentMarket finalizes it with its settlement operator rather than asking the client to sign a second transaction.</small>
        </section>
      </div>
    </main>
  );
}
