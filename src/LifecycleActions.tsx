import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, encodeFunctionData, http, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { ensureExpectedChain, getWalletProvider } from "./lib/walletAuth";
import { sendAndConfirm } from "./lib/onchainExecutor";
import "./lifecycle-actions.css";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const POLICY = "0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6" as Address;
const PUBLIC = createPublicClient({ chain: bscTestnet, transport: http() });

const COMMERCE_ABI = [{
  type: "function", name: "getJob", stateMutability: "view",
  inputs: [{ name: "jobId", type: "uint256" }],
  outputs: [{ name: "job", type: "tuple", components: [
    { name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" },
    { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" },
    { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" },
    { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" },
  ] }],
}, {
  type: "function", name: "claimRefund", stateMutability: "nonpayable",
  inputs: [{ name: "jobId", type: "uint256" }], outputs: [],
}] as const;

const POLICY_ABI = [{
  type: "function", name: "dispute", stateMutability: "nonpayable",
  inputs: [{ name: "jobId", type: "uint256" }], outputs: [],
}, {
  type: "function", name: "voteReject", stateMutability: "nonpayable",
  inputs: [{ name: "jobId", type: "uint256" }], outputs: [],
}] as const;

const STATUS: Record<number, string> = { 0: "OPEN", 1: "FUNDED", 2: "SUBMITTED", 3: "COMPLETED", 4: "REJECTED", 5: "EXPIRED" };

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

async function connectedProvider(requestConnection = false): Promise<Eip1193Provider> {
  const provider = await getWalletProvider() as Eip1193Provider;
  const accounts = await provider.request({ method: "eth_accounts" }) as string[];
  if (!accounts?.[0] && requestConnection) {
    await provider.request({ method: "eth_requestAccounts" });
  }
  const confirmedAccounts = await provider.request({ method: "eth_accounts" }) as string[];
  if (!confirmedAccounts?.[0]) throw new Error("Connect a wallet before continuing.");
  await ensureExpectedChain(provider);
  return provider;
}

export default function LifecycleActions() {
  const jobId = new URLSearchParams(window.location.search).get("job") || "";
  const [job, setJob] = useState<any>(null);
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!/^\d+$/.test(jobId)) throw new Error("Open this page with ?job=<chain-job-id>.");
    const next = await PUBLIC.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "getJob", args: [BigInt(jobId)] });
    if (!next || next.id === 0n) throw new Error("Job not found on BSC Testnet.");
    setJob(next);
  }, [jobId]);

  useEffect(() => {
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load job"));
    void getWalletProvider()
      .then(async (provider) => {
        const accounts = await provider.request({ method: "eth_accounts" }) as string[];
        if (accounts?.[0]) setWallet(accounts[0].toLowerCase());
      })
      .catch(() => undefined);
  }, [refresh]);

  const status = Number(job?.status);
  const expired = !!job && Number(job.expiredAt) * 1000 <= Date.now();
  const isClient = !!job && !!wallet && wallet === String(job.client).toLowerCase();
  const disputeAvailable = status === 2 && isClient && !expired;
  const refundAvailable = !!job && expired && ![3, 4, 5].includes(status);
  const statusLabel = useMemo(() => STATUS[status] || "UNKNOWN", [status]);

  async function run(action: "dispute" | "voteReject" | "claimRefund") {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const provider = await connectedProvider(true);
      const accounts = await provider.request({ method: "eth_accounts" }) as string[];
      setWallet(String(accounts[0]).toLowerCase());
      let tx;
      if (action === "dispute") {
        const connectedClient = String(accounts[0]).toLowerCase();
        if (!disputeAvailable || connectedClient !== String(job?.client || "").toLowerCase()) {
          throw new Error("Dispute is only available to the connected job client while the submitted job is within the protocol's dispute window.");
        }
        tx = { to: POLICY, data: encodeFunctionData({ abi: POLICY_ABI, functionName: "dispute", args: [BigInt(jobId)] }) };
      } else if (action === "voteReject") {
        if (status !== 2) throw new Error("Vote rejection is only relevant while the job is SUBMITTED.");
        tx = { to: POLICY, data: encodeFunctionData({ abi: POLICY_ABI, functionName: "voteReject", args: [BigInt(jobId)] }) };
      } else {
        if (!refundAvailable) throw new Error("Refund is only available after expiry when the job is not already terminal.");
        tx = { to: COMMERCE, data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: "claimRefund", args: [BigInt(jobId)] }) };
      }
      const receipt = await sendAndConfirm(tx);
      setNotice(`${action} confirmed in block ${receipt.blockNumber}. Re-reading the chain…`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${action} failed`);
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="lifecycle-page">
      <div className="lifecycle-curve lifecycle-curve-a" aria-hidden="true" />
      <div className="lifecycle-curve lifecycle-curve-b" aria-hidden="true" />
      <div className="lifecycle-shell">
        <header className="lifecycle-nav">
          <a href="/" className="lifecycle-brand">AgentMarket</a>
          <span>ERC-8183 / EXCEPTIONS</span>
          <a href={`/evaluator?job=${encodeURIComponent(jobId)}`}>Back to evaluator →</a>
        </header>
        {error && <div className="lifecycle-alert lifecycle-alert-error">{error}</div>}
        {notice && <div className="lifecycle-alert lifecycle-alert-success">{notice}</div>}
        <section className="lifecycle-hero">
          <div><span className="lifecycle-kicker">DISPUTE / REJECT / REFUND</span><h1>The unhappy paths are first-class protocol states.</h1><p>AgentMarket does not invent a dispute verdict. These controls call the ERC-8183 policy/kernel directly and then re-read the chain.</p></div>
          <div className="lifecycle-state"><small>CHAIN STATUS</small><strong>{job ? statusLabel : "LOADING"}</strong><span>Job #{jobId || "—"} · BSC Testnet</span></div>
        </section>
        <div className="lifecycle-grid">
          <section className="lifecycle-card"><div className="lifecycle-head"><span>01 / DISPUTE</span><b>{disputeAvailable ? "AVAILABLE" : "LOCKED"}</b></div><h2>Client dispute</h2><p>Available only to the job client while the chain still reports SUBMITTED and the protocol dispute window is open. The contract remains the final authority on the exact window.</p><button disabled={!disputeAvailable || !!busy} onClick={() => void run("dispute")}>{busy === "dispute" ? "Confirming…" : "Raise dispute →"}</button><small>Wallet must match the on-chain client.</small></section>
          <section className="lifecycle-card"><div className="lifecycle-head"><span>02 / VOTER PATH</span><b>{status === 2 ? "READY FOR ELIGIBLE VOTER" : "LOCKED"}</b></div><h2>Vote reject</h2><p>Whitelisted voters may vote after a dispute. AgentMarket does not maintain the voter whitelist; the OptimisticPolicy contract decides whether the connected wallet is authorized.</p><button disabled={status !== 2 || !!busy} onClick={() => void run("voteReject")}>{busy === "voteReject" ? "Confirming…" : "Vote reject →"}</button><small>A non-whitelisted wallet will be rejected by the policy contract.</small></section>
          <section className="lifecycle-card lifecycle-card-wide"><div className="lifecycle-head"><span>03 / EXPIRY ESCAPE HATCH</span><b>{refundAvailable ? "AVAILABLE" : "LOCKED"}</b></div><div><h2>Claim refund after expiry</h2><p>The current BNB implementation documents <code>claimRefund(jobId)</code> as the fallback after <code>expiredAt</code> when settlement has not completed. It is non-pausable and does not rely on a platform moderator.</p><div className="lifecycle-meta"><span>EXPIRES</span><strong>{job ? new Date(Number(job.expiredAt) * 1000).toLocaleString() : "—"}</strong></div><button disabled={!refundAvailable || !!busy} onClick={() => void run("claimRefund")}>{busy === "claimRefund" ? "Confirming…" : "Claim refund →"}</button></div></section>
        </div>
        <footer className="lifecycle-footer">Protocol source of truth: BSC Testnet. Supabase mirrors verified chain results; it never decides whether a dispute, reject, settle, or refund is valid.</footer>
      </div>
    </main>
  );
}
