import { useEffect, useMemo, useState } from "react";
import { type Address, type EIP1193Provider } from "viem";
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import { ERC8183_ADDRESSES } from "./lib/erc8183";
import {
  bscExplorerUrl,
  claimRefundJob,
  disputeJob,
  readChainJob,
  readPolicyConfig,
  readPolicyVerdict,
  settleJob,
} from "./lib/erc8183Adapter";
import "./mission-console.css";

const WALLETCONNECT_PROJECT_ID = "1dbe8fd5e4974ae7c80d074c4082b5a0";

type ReviewState = {
  id: bigint;
  client: Address;
  provider: Address;
  expiredAt: bigint;
  submittedAt: bigint;
  status: number;
  deliverable: `0x${string}`;
};

const STATUS: Record<number, string> = {
  0: "OPEN",
  1: "FUNDED",
  2: "SUBMITTED",
  3: "COMPLETED",
  4: "REJECTED",
  5: "EXPIRED",
};

const VERDICTS: Record<number, string> = {
  0: "PENDING",
  1: "APPROVE",
  2: "REJECT",
};

const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

function formatDate(seconds: bigint) {
  if (!seconds) return "—";
  return new Date(Number(seconds) * 1000).toLocaleString();
}

function short(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

export default function TestnetPolicyReview() {
  const params = new URLSearchParams(window.location.search);
  const chainJobId = params.get("job") || "";
  const missionId = params.get("mission") || "";
  const marketplaceJobId = params.get("marketplaceJob") || "";

  const [wallet, setWallet] = useState<{ address: Address | null; provider: EIP1193Provider | null }>({ address: null, provider: null });
  const [job, setJob] = useState<ReviewState | null>(null);
  const [disputeWindow, setDisputeWindow] = useState<bigint>(0n);
  const [voteQuorum, setVoteQuorum] = useState<bigint>(0n);
  const [verdict, setVerdict] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  async function connectWallet() {
    setError("");
    try {
      const provider = await EthereumProvider.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        chains: [97],
        showQrModal: true,
        metadata: {
          name: "AgentMarket Testnet",
          description: "ERC-8183 policy review on BSC Testnet",
          url: window.location.origin,
          icons: [],
        },
      });
      await provider.connect();
      const accounts = provider.accounts as string[];
      if (!accounts?.length) throw new Error("No wallet account returned.");
      setWallet({ address: accounts[0] as Address, provider: provider as unknown as EIP1193Provider });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed.");
    }
  }

  async function refresh() {
    if (!/^\d+$/.test(chainJobId)) {
      setError("Missing or invalid Testnet chain job ID.");
      setLoading(false);
      return;
    }

    setError("");
    try {
      const [chain, config] = await Promise.all([
        readChainJob(BigInt(chainJobId)),
        readPolicyConfig(),
      ]);

      let nextVerdict: number | null = null;
      try {
        nextVerdict = Number(await readPolicyVerdict(BigInt(chainJobId)));
      } catch {
        // OptimisticPolicy.check() legitimately reverts while the policy has no
        // verdict yet. The Commerce job is still valid and should remain visible.
        nextVerdict = null;
      }

      setJob({
        id: chain.id,
        client: chain.client,
        provider: chain.provider,
        expiredAt: chain.expiredAt,
        submittedAt: chain.submittedAt,
        status: chain.status,
        deliverable: chain.deliverable,
      });
      setDisputeWindow(config.disputeWindow);
      setVoteQuorum(config.voteQuorum);
      setVerdict(nextVerdict);
    } catch (cause) {
      setJob(null);
      setVerdict(null);
      setError(cause instanceof Error ? cause.message : "Unable to read Testnet ERC-8183 job state.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [chainJobId]);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const disputeDeadline = useMemo(() => job ? job.submittedAt + disputeWindow : 0n, [job, disputeWindow]);
  const disputeOpen = !!job && job.status === 2 && now < disputeDeadline;
  const disputeExpired = !!job && job.status === 2 && now >= disputeDeadline;
  const canDispute = !!wallet.address && !!job && wallet.address.toLowerCase() === job.client.toLowerCase() && disputeOpen;
  const settleReady = !!job && job.status === 2 && verdict !== null && verdict !== 0 && (disputeExpired || verdict === 2);
  const refundable = !!job && (job.status === 5 || (job.status === 1 && now >= job.expiredAt));

  async function runAction(name: "dispute" | "settle" | "refund") {
    if (!wallet.provider || !wallet.address || !job) {
      setError("Connect the client wallet first.");
      return;
    }
    setError("");
    setWorking(name);
    setTxHash("");
    try {
      const args = { jobId: job.id, providerWallet: wallet.provider, account: wallet.address };
      const result = name === "dispute"
        ? await disputeJob(args)
        : name === "settle"
          ? await settleJob(args)
          : await claimRefundJob(args);
      setTxHash(result.hash);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to ${name} this job.`);
    } finally {
      setWorking("");
    }
  }

  if (loading) {
    return <main className="console-page"><div className="console-shell"><section className="console-card"><p className="console-evidence">Loading BSC Testnet policy state…</p></section></div></main>;
  }

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a href="/missions" className="console-brand">← Missions</a>
          <span>ERC-8183 POLICY REVIEW</span>
          <a href="/testnet">Sandbox →</a>
        </header>

        {error && <div className="console-alert console-alert-error">{error}</div>}

        <section className="console-hero">
          <div>
            <span className="console-kicker">BSC TESTNET / CHAIN 97 / ERC-8183</span>
            <h1>Review submitted work</h1>
            <p>The policy is authoritative. AgentMarket does not invent a verdict: it reads the live OptimisticPolicy and only enables actions allowed by the current on-chain state.</p>
          </div>
          <div className="console-state"><small>JOB</small><strong>#{chainJobId || "—"}</strong><span>{job ? STATUS[job.status] || "UNKNOWN" : "NOT FOUND"}</span></div>
        </section>

        {job && (
          <section className="console-grid">
            <article className="console-card">
              <div className="console-section-head"><span>CHAIN STATE</span><b>{STATUS[job.status] || "UNKNOWN"}</b></div>
              <div className="console-stat"><span>Provider / Agent</span><strong>{short(job.provider)}</strong></div>
              <div className="console-stat"><span>Client</span><strong>{short(job.client)}</strong></div>
              <div className="console-stat"><span>Submitted</span><strong>{formatDate(job.submittedAt)}</strong></div>
              <div className="console-stat"><span>Expires</span><strong>{formatDate(job.expiredAt)}</strong></div>
              <div className="console-stat"><span>Deliverable hash</span><strong>{job.deliverable === zeroHash ? "Missing" : short(job.deliverable)}</strong></div>
            </article>

            <article className="console-card">
              <div className="console-section-head"><span>OPTIMISTIC POLICY</span><b>{verdict == null ? "PENDING" : VERDICTS[verdict] || `VERDICT ${verdict}`}</b></div>
              <div className="console-stat"><span>Policy</span><strong>{short(ERC8183_ADDRESSES.policy)}</strong></div>
              <div className="console-stat"><span>Dispute window</span><strong>{disputeWindow.toString()} seconds</strong></div>
              <div className="console-stat"><span>Reject quorum</span><strong>{voteQuorum.toString()}</strong></div>
              <div className="console-stat"><span>Dispute deadline</span><strong>{job.submittedAt ? formatDate(disputeDeadline) : "—"}</strong></div>
              <p className="console-evidence">A pending `check()` result is normal until the policy reaches a verdict. Silence through the dispute window is approval. A client dispute moves the job into the policy's reject-vote path. Whitelisted voters perform `voteReject`; settlement is permissionless once the policy has a verdict.</p>
            </article>
          </section>
        )}

        <section className="console-card">
          <div className="console-section-head"><span>WALLET</span><b>{wallet.address ? `CONNECTED · ${short(wallet.address)}` : "NOT CONNECTED"}</b></div>
          {!wallet.address ? (
            <button className="console-brass-button" onClick={connectWallet}>Connect BSC Testnet wallet →</button>
          ) : (
            <p className="console-evidence">Connected wallet is used only to sign the selected Testnet protocol action. AgentMarket never receives the private key.</p>
          )}
        </section>

        {job && job.status === 2 && (
          <section className="console-card">
            <div className="console-section-head"><span>POST-SUBMISSION ACTIONS</span><b>{verdict == null ? "POLICY PENDING" : VERDICTS[verdict] || "UNKNOWN"}</b></div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <button className="console-brass-button" disabled={!canDispute || !!working} onClick={() => void runAction("dispute")}>{working === "dispute" ? "Submitting dispute…" : "Dispute submission"}</button>
              <button className="console-brass-button" disabled={!settleReady || !!working} onClick={() => void runAction("settle")}>{working === "settle" ? "Settling…" : "Settle job"}</button>
            </div>
            {!disputeOpen && !settleReady && <p className="console-evidence">Settlement remains locked while the policy verdict is pending. After the dispute window expires without rejection, `settle` becomes available.</p>}
            {disputeOpen && <p className="console-evidence">Dispute window is open until {formatDate(disputeDeadline)}. Only the client wallet can dispute.</p>}
            {txHash && <p className="console-evidence">Transaction confirmed: <a href={bscExplorerUrl(txHash as `0x${string}`)} target="_blank" rel="noreferrer">{short(txHash)}</a></p>}
          </section>
        )}

        {refundable && (
          <section className="console-card">
            <div className="console-section-head"><span>EXPIRY / REFUND</span><b>ELIGIBLE</b></div>
            <p className="console-evidence">The job has reached its expiry escape hatch. `claimRefund(jobId)` is permissionless after expiry.</p>
            <button className="console-brass-button" disabled={!wallet.address || !!working} onClick={() => void runAction("refund")}>{working === "refund" ? "Claiming refund…" : "Claim refund"}</button>
          </section>
        )}

        <section className="console-card">
          <p className="console-evidence">Mission: {missionId || "—"} · Marketplace job: {marketplaceJobId || "—"}</p>
        </section>
      </div>
    </main>
  );
}
