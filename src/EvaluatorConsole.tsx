import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, encodeFunctionData, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { ensureExpectedChain, getWalletProvider } from "./lib/walletAuth";
import { sendAndConfirm } from "./lib/onchainExecutor";
import "./evaluator-console.css";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const ROUTER = "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address;
const POLICY = "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6" as Address;

const COMMERCE_ABI = [{
  type: "function", name: "getJob", stateMutability: "view",
  inputs: [{ name: "jobId", type: "uint256" }],
  outputs: [{ name: "job", type: "tuple", components: [
    { name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" },
    { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" },
    { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" },
    { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" },
  ] }],
}] as const;

const ROUTER_ABI = [{
  type: "function", name: "jobPolicy", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ type: "address" }],
}, {
  type: "function", name: "settle", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [],
}] as const;

const POLICY_ABI = [{
  type: "function", name: "check", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }, { name: "evidence", type: "bytes" }], outputs: [{ name: "verdict", type: "uint8" }, { name: "reason", type: "bytes32" }],
}, {
  type: "function", name: "disputeWindow", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }],
}] as const;

const publicClient = createPublicClient({ chain: bscTestnet, transport: http() });
const STATUS: Record<number, string> = { 0: "OPEN", 1: "FUNDED", 2: "SUBMITTED", 3: "COMPLETED", 4: "REJECTED", 5: "EXPIRED" };
const VERDICT: Record<number, string> = { 0: "PENDING", 1: "APPROVE", 2: "REJECT" };
const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

async function connectedProvider(requestConnection = false): Promise<Eip1193Provider> {
  const provider = await getWalletProvider() as Eip1193Provider;
  let accounts = await provider.request({ method: "eth_accounts" }) as string[];
  if (!accounts?.[0] && requestConnection) {
    await provider.request({ method: "eth_requestAccounts" });
    accounts = await provider.request({ method: "eth_accounts" }) as string[];
  }
  await ensureExpectedChain(provider);
  if (!accounts?.[0]) throw new Error("No connected wallet is available to execute settlement.");
  return provider;
}

export default function EvaluatorConsole() {
  const params = new URLSearchParams(window.location.search);
  const jobId = params.get("job") || "";
  const missionId = params.get("mission") || "";
  const marketplaceJobId = params.get("market_job") || "";
  const [job, setJob] = useState<any>(null);
  const [policy, setPolicy] = useState<string>("");
  const [policyVerdict, setPolicyVerdict] = useState(0);
  const [disputeWindow, setDisputeWindow] = useState<bigint | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settling, setSettling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const settleAttemptedRef = useRef(false);
  const autoSettleTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!jobId || !/^\d+$/.test(jobId)) {
      setError("Open this page with ?job=<chain-job-id>.");
      return;
    }
    setRefreshing(true);
    setError("");
    try {
      const chainJob = await publicClient.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "getJob", args: [BigInt(jobId)] });
      if (!chainJob || chainJob.id === 0n) throw new Error("Chain job was not found on BSC Testnet.");
      const jobPolicy = await publicClient.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "jobPolicy", args: [BigInt(jobId)] });
      setJob(chainJob);
      setPolicy(jobPolicy);
      setDisputeWindow(await publicClient.readContract({ address: POLICY, abi: POLICY_ABI, functionName: "disputeWindow" }));
      const policyAddress = String(jobPolicy).toLowerCase();
      if (policyAddress === POLICY.toLowerCase()) {
        const checked = await publicClient.readContract({ address: POLICY, abi: POLICY_ABI, functionName: "check", args: [BigInt(jobId), "0x"] });
        setPolicyVerdict(Number(checked[0]));
      } else {
        setPolicyVerdict(0);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to read evaluator state");
    } finally {
      setRefreshing(false);
    }
  }, [jobId]);

  useEffect(() => {
    void refresh();
    return () => {
      if (autoSettleTimerRef.current !== null) window.clearTimeout(autoSettleTimerRef.current);
    };
  }, [refresh]);

  async function syncSettlement(hash: string) {
    if (!missionId || !marketplaceJobId) {
      setNotice("Settlement confirmed on-chain. Open the evaluator from the mission workspace to sync marketplace history.");
      return;
    }
    setSyncing(true);
    try {
      const response = await fetch("/api/erc8183-settlement", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission_id: missionId, job_id: marketplaceJobId, chain_job_id: jobId, tx_hash: hash }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Marketplace settlement sync failed");
      setNotice(`Settlement confirmed and marketplace state synced as ${String(data.chain_status).toUpperCase()}.`);
    } catch (cause) {
      throw cause instanceof Error ? cause : new Error("Marketplace settlement sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const settleOnChain = useCallback(async (automatic = false) => {
    if (!job || Number(job.status) !== 2 || policyVerdict === 0 || settling || syncing || settleAttemptedRef.current) return;
    settleAttemptedRef.current = true;
    setSettling(true);
    setError("");
    if (automatic) setNotice("Policy verdict is ready. Finalizing the submitted job on-chain…");
    try {
      const provider = await connectedProvider(false);
      const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "settle", args: [BigInt(jobId), "0x"] });
      const receipt = await sendAndConfirm({ to: ROUTER, data });
      setTxHash(receipt.hash);
      setNotice(`Settlement transaction confirmed in block ${receipt.blockNumber}. Verifying terminal state…`);
      await refresh();
      try {
        await syncSettlement(receipt.hash);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Marketplace settlement sync failed");
      }
    } catch (cause) {
      settleAttemptedRef.current = false;
      const detail = cause instanceof Error ? cause.message : "Settlement transaction failed";
      if (automatic) {
        setNotice("The on-chain verdict is ready. Settlement is permissionless; the browser will finalize it when a connected wallet is available.");
      }
      setError(detail);
    } finally {
      setSettling(false);
    }
  }, [job, jobId, policyVerdict, refresh, settling, syncing, missionId, marketplaceJobId]);

  useEffect(() => {
    if (!job || Number(job.status) !== 2 || policyVerdict !== 0 || !disputeWindow || !job.submittedAt) return;
    const deadline = Number(job.submittedAt) * 1000 + Number(disputeWindow) * 1000;
    const delay = Math.max(1000, deadline - Date.now() + 250);
    if (autoSettleTimerRef.current !== null) window.clearTimeout(autoSettleTimerRef.current);
    autoSettleTimerRef.current = window.setTimeout(() => {
      void refresh();
    }, Math.min(delay, 15_000));
    return () => {
      if (autoSettleTimerRef.current !== null) window.clearTimeout(autoSettleTimerRef.current);
    };
  }, [job, policyVerdict, disputeWindow, refresh]);

  useEffect(() => {
    if (!job || Number(job.status) !== 2 || policyVerdict === 0) return;
    void settleOnChain(true);
  }, [job, policyVerdict, settleOnChain]);

  async function settleManually() {
    settleAttemptedRef.current = false;
    await refresh();
    if (policyVerdict === 0) {
      setError("The optimistic policy is still PENDING. Settlement becomes valid after the dispute window closes or a rejection quorum is reached.");
      return;
    }
    await settleOnChain(false);
  }

  return (
    <main className="evaluator-page">
      <div className="evaluator-curve evaluator-curve-a" aria-hidden="true" />
      <div className="evaluator-curve evaluator-curve-b" aria-hidden="true" />
      <div className="evaluator-shell">
        <header className="evaluator-nav">
          <a href="/" className="evaluator-brand">AgentMarket</a>
          <span>EVALUATOR / SETTLEMENT</span>
          <div className="evaluator-nav-actions"><a href={`/lifecycle?job=${encodeURIComponent(jobId)}`}>Dispute / refund →</a><a href={`/dashboard?job=${encodeURIComponent(jobId)}`}>Back to dashboard →</a></div>
        </header>

        {error && <div className="evaluator-alert evaluator-alert-error">{error}</div>}
        {notice && <div className="evaluator-alert evaluator-alert-success">{notice}</div>}

        <section className="evaluator-hero">
          <div>
            <span className="evaluator-kicker">ERC-8183 / POLICY CONTROLLED</span>
            <h1>Settlement follows the chain, not a platform button.</h1>
            <p>AgentMarket reads the live Commerce job and Router policy. The platform does not invent a verdict or release payment in Supabase.</p>
          </div>
          <div className="evaluator-state"><small>CHAIN STATUS</small><strong>{job ? STATUS[Number(job.status)] || `STATUS ${Number(job.status)}` : "LOADING"}</strong><span>Job #{jobId || "—"} · BSC Testnet</span></div>
        </section>

        <div className="evaluator-grid">
          <section className="evaluator-card">
            <div className="evaluator-head"><span>01 / JOB EVIDENCE</span><b>{job ? STATUS[Number(job.status)] || "UNKNOWN" : "WAITING"}</b></div>
            {job ? <div className="evaluator-lines">
              <div><span>CLIENT</span><strong>{compact(job.client)}</strong></div>
              <div><span>PROVIDER</span><strong>{compact(job.provider)}</strong></div>
              <div><span>EVALUATOR</span><strong>{compact(job.evaluator)}</strong></div>
              <div><span>POLICY</span><strong>{compact(policy)}</strong></div>
              <div><span>BUDGET</span><strong>{job.budget.toString()}</strong></div>
              <div><span>SUBMITTED AT</span><strong>{Number(job.submittedAt) ? new Date(Number(job.submittedAt) * 1000).toLocaleString() : "—"}</strong></div>
              <div className="evaluator-full"><span>DELIVERABLE HASH</span><strong>{job.deliverable}</strong></div>
            </div> : <div className="evaluator-empty">Reading the on-chain job…</div>}
          </section>

          <aside className="evaluator-card evaluator-policy-card">
            <div className="evaluator-head"><span>02 / OPTIMISTIC POLICY</span><b>LIVE</b></div>
            <h2>How completion works</h2>
            <p>ERC-8183 uses an optimistic policy. After the provider submits, the client has a dispute window. Silence is approval; a qualified dispute can lead to rejection. Settlement applies the policy verdict to the Commerce kernel.</p>
            <div className="evaluator-rule"><span>0</span><strong>Platform verdict</strong><small>Never invented by AgentMarket</small></div>
            <div className="evaluator-rule"><span>1</span><strong>On-chain policy</strong><small>Controls the verdict</small></div>
            <div className="evaluator-rule"><span>2</span><strong>Permissionless settle</strong><small>Anyone may finalize when eligible</small></div>
          </aside>
        </div>

        <section className="evaluator-card evaluator-settle-card">
          <div>
            <span className="evaluator-kicker">03 / SETTLEMENT</span>
            <h2>{job && Number(job.status) === 2 ? "Submitted job detected." : "Waiting for SUBMITTED."}</h2>
            <p>{job && Number(job.status) === 2 ? `Policy verdict: ${VERDICT[policyVerdict] || "PENDING"}. The settlement call is permissionless; AgentMarket uses the already-connected browser wallet as the transaction executor when available.` : "Settlement is intentionally unavailable until the chain reports SUBMITTED."}</p>
          </div>
          <div className="evaluator-actions">
            <button onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Reading chain…" : "Refresh chain state"}</button>
            <button onClick={() => void settleManually()} disabled={settling || syncing || !job || Number(job.status) !== 2 || policyVerdict === 0}>{settling ? "Confirming…" : syncing ? "Syncing…" : "Settle via wallet →"}</button>
          </div>
          {txHash && <div className="evaluator-tx"><small>CONFIRMED TX</small><strong>{txHash}</strong></div>}
          <small className="evaluator-note">BSC Testnet only. Dispute uses the connected client wallet; settlement itself is permissionless and does not require the client to be the signer. AgentMarket never receives a private key. Terminal settlement is mirrored into marketplace history only after receipt verification and a fresh chain read.</small>
        </section>
      </div>
    </main>
  );
}
