import { useCallback, useEffect, useState } from "react";
import { createPublicClient, encodeFunctionData, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { sendAndConfirm } from "./lib/onchainExecutor";
import "./evaluator-console.css";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const ROUTER = "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address;
const COMMERCE_ABI = [{ type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "job", type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }, { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" }] }] }] as const;
const ROUTER_ABI = [{ type: "function", name: "jobPolicy", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ type: "address" }] }, { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [] }] as const;
const publicClient = createPublicClient({ chain: bscTestnet, transport: http() });
const STATUS: Record<number, string> = { 0: "OPEN", 1: "FUNDED", 2: "SUBMITTED", 3: "COMPLETED", 4: "REJECTED", 5: "EXPIRED" };
const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

async function requireTestnetWallet() {
  if (!window.ethereum) throw new Error("No compatible browser wallet was detected.");
  const chainId = String(await window.ethereum.request({ method: "eth_chainId" })).toLowerCase();
  if (chainId !== "0x61") throw new Error("Switch the connected wallet to BSC Testnet (chain ID 97) before settlement.");
}

export default function EvaluatorConsole() {
  const jobId = new URLSearchParams(window.location.search).get("job") || "";
  const missionId = new URLSearchParams(window.location.search).get("mission") || "";
  const marketplaceJobId = new URLSearchParams(window.location.search).get("market_job") || "";
  const [job, setJob] = useState<any>(null);
  const [policy, setPolicy] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);
  const [settling, setSettling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    if (!jobId || !/^\d+$/.test(jobId)) { setError("Open this page with ?job=<chain-job-id>."); return; }
    setRefreshing(true); setError("");
    try {
      const chainJob = await publicClient.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "getJob", args: [BigInt(jobId)] });
      if (!chainJob || chainJob.id === 0n) throw new Error("Chain job was not found on BSC Testnet.");
      const jobPolicy = await publicClient.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "jobPolicy", args: [BigInt(jobId)] });
      setJob(chainJob); setPolicy(jobPolicy);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to read evaluator state"); }
    finally { setRefreshing(false); }
  }, [jobId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function syncSettlement(hash: string) {
    if (!missionId || !marketplaceJobId) { setNotice("Settlement confirmed on Testnet. Open the evaluator from the mission workspace to sync marketplace history."); return; }
    setSyncing(true);
    try {
      const response = await fetch("/api/testnet/erc8183-settlement", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission_id: missionId, job_id: marketplaceJobId, chain_job_id: jobId, tx_hash: hash }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Testnet marketplace settlement sync failed");
      setNotice(`Testnet settlement confirmed and marketplace state synced as ${String(data.chain_status).toUpperCase()}.`);
    } catch (cause) { throw cause instanceof Error ? cause : new Error("Testnet marketplace settlement sync failed"); }
    finally { setSyncing(false); }
  }

  async function settle() {
    if (!job || Number(job.status) !== 2) { setError("Settlement is only prepared after the chain reports SUBMITTED."); return; }
    setSettling(true); setError(""); setNotice("");
    try {
      await requireTestnetWallet();
      const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "settle", args: [BigInt(jobId), "0x"] });
      const receipt = await sendAndConfirm({ to: ROUTER, data });
      setTxHash(receipt.hash); setNotice(`Testnet settlement transaction confirmed in block ${receipt.blockNumber}. Verifying terminal state…`);
      await refresh();
      try { await syncSettlement(receipt.hash); } catch (cause) { setError(cause instanceof Error ? cause.message : "Testnet marketplace settlement sync failed"); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Testnet settlement transaction failed"); }
    finally { setSettling(false); }
  }

  return (
    <main className="evaluator-page">
      <div className="evaluator-curve evaluator-curve-a" aria-hidden="true" /><div className="evaluator-curve evaluator-curve-b" aria-hidden="true" />
      <div className="evaluator-shell">
        <header className="evaluator-nav"><a href="/" className="evaluator-brand">AgentMarket</a><span>TESTNET / EVALUATOR / SETTLEMENT</span><div className="evaluator-nav-actions"><a href={`/lifecycle?job=${encodeURIComponent(jobId)}`}>Dispute / refund →</a><a href={`/dashboard?job=${encodeURIComponent(jobId)}`}>Back to dashboard →</a></div></header>
        {error && <div className="evaluator-alert evaluator-alert-error">{error}</div>}{notice && <div className="evaluator-alert evaluator-alert-success">{notice}</div>}
        <section className="evaluator-hero"><div><span className="evaluator-kicker">ERC-8183 / BSC TESTNET / 97</span><h1>Settlement follows the Testnet chain, not a platform button.</h1><p>AgentMarket reads the live Testnet Commerce job and Router policy. The platform does not invent a verdict or release payment in Supabase.</p></div><div className="evaluator-state"><small>CHAIN STATUS</small><strong>{job ? STATUS[Number(job.status)] || `STATUS ${Number(job.status)}` : "LOADING"}</strong><span>Job #{jobId || "—"} · BSC Testnet</span></div></section>
        <div className="evaluator-grid"><section className="evaluator-card"><div className="evaluator-head"><span>01 / JOB EVIDENCE</span><b>{job ? STATUS[Number(job.status)] || "UNKNOWN" : "WAITING"}</b></div>{job ? <div className="evaluator-lines"><div><span>CLIENT</span><strong>{compact(job.client)}</strong></div><div><span>PROVIDER</span><strong>{compact(job.provider)}</strong></div><div><span>EVALUATOR</span><strong>{compact(job.evaluator)}</strong></div><div><span>POLICY</span><strong>{compact(policy)}</strong></div><div><span>BUDGET</span><strong>{job.budget.toString()}</strong></div><div><span>SUBMITTED AT</span><strong>{Number(job.submittedAt) ? new Date(Number(job.submittedAt) * 1000).toLocaleString() : "—"}</strong></div><div className="evaluator-full"><span>DELIVERABLE HASH</span><strong>{job.deliverable}</strong></div></div> : <div className="evaluator-empty">Reading the Testnet chain job…</div>}</section><aside className="evaluator-card evaluator-policy-card"><div className="evaluator-head"><span>02 / OPTIMISTIC POLICY</span><b>LIVE</b></div><h2>How completion works</h2><p>ERC-8183 uses an optimistic policy. After the provider submits, the client has a dispute window. Silence is approval; a qualified dispute can lead to rejection. Settlement applies the policy verdict to the Commerce kernel.</p><div className="evaluator-rule"><span>0</span><strong>Platform verdict</strong><small>Never invented by AgentMarket</small></div><div className="evaluator-rule"><span>1</span><strong>On-chain policy</strong><small>Controls the verdict</small></div><div className="evaluator-rule"><span>2</span><strong>Permissionless settle</strong><small>Anyone may finalize when eligible</small></div></aside></div>
        <section className="evaluator-card evaluator-settle-card"><div><span className="evaluator-kicker">03 / TESTNET SETTLEMENT</span><h2>{job && Number(job.status) === 2 ? "Submitted Testnet job detected." : "Waiting for SUBMITTED."}</h2><p>{job && Number(job.status) === 2 ? "The wallet can prepare router.settle(jobId). The Testnet policy and contract determine whether it succeeds now or must wait for the dispute window." : "Settlement is intentionally unavailable until the Testnet chain reports SUBMITTED."}</p></div><div className="evaluator-actions"><button onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Reading chain…" : "Refresh Testnet chain state"}</button><button onClick={() => void settle()} disabled={settling || syncing || !job || Number(job.status) !== 2}>{settling ? "Confirming…" : syncing ? "Syncing…" : "Settle Testnet job →"}</button></div>{txHash && <div className="evaluator-tx"><small>CONFIRMED TESTNET TX</small><strong>{txHash}</strong></div>}<small className="evaluator-note">Development mode: BSC Testnet only. The browser wallet remains the signer; AgentMarket never receives a private key. Terminal settlement is mirrored into marketplace history only after receipt verification and a fresh Testnet chain read.</small></section>
      </div>
    </main>
  );
}
