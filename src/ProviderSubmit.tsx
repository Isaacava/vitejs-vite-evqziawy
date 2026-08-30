import { useCallback, useEffect, useState } from "react";
import { getAddress, keccak256, stringToBytes, encodeFunctionData, type Address } from "viem";
import { sendAndConfirm } from "./lib/onchainExecutor";
import { PROVIDER_COMMERCE_ABI, PROVIDER_ERC8183_TESTNET, providerPublicClient } from "./lib/erc8183ProviderTestnet";
import "./provider-submit.css";

type Job = {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  submittedAt: bigint;
  deliverable: `0x${string}`;
};

const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

const TESTNET_CHAIN_ID_HEX = "0x61";

export default function ProviderSubmit() {
  const jobId = new URLSearchParams(window.location.search).get("job") || "";
  const agentId = new URLSearchParams(window.location.search).get("agent") || "";
  const [job, setJob] = useState<Job | null>(null);
  const [account, setAccount] = useState<Address | "">("");
  const [deliverable, setDeliverable] = useState("");
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    if (!/^\d+$/.test(jobId)) {
      setError("Open this page with ?job=<chain-job-id>.");
      return;
    }
    try {
      const next = await providerPublicClient.readContract({
        address: PROVIDER_ERC8183_TESTNET.commerce,
        abi: PROVIDER_COMMERCE_ABI,
        functionName: "getJob",
        args: [BigInt(jobId)],
      });
      if (!next || next.id === 0n) throw new Error("Job was not found on BSC Testnet.");
      setJob(next as Job);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to read provider job");
    }
  }, [jobId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function connect() {
    setError("");
    if (!window.ethereum) {
      setError("Connect a browser wallet that supports BSC Testnet.");
      return;
    }
    try {
      const chainIdRaw = String(await window.ethereum.request({ method: "eth_chainId" }));
      const chainId = chainIdRaw.startsWith("0x") ? Number.parseInt(chainIdRaw.slice(2), 16) : Number(chainIdRaw);
      if (chainId !== PROVIDER_ERC8183_TESTNET.chainId) {
        try {
          await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: TESTNET_CHAIN_ID_HEX }] });
        } catch (switchError) {
          const code = typeof switchError === "object" && switchError && "code" in switchError ? Number((switchError as { code?: unknown }).code) : 0;
          if (code !== 4902) throw switchError;
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: TESTNET_CHAIN_ID_HEX,
              chainName: "BNB Smart Chain Testnet",
              nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
              rpcUrls: ["https://bsc-testnet-rpc.publicnode.com"],
              blockExplorerUrls: ["https://testnet.bscscan.com"],
            }],
          });
        }
      }
      const confirmedChainRaw = String(await window.ethereum.request({ method: "eth_chainId" }));
      const confirmedChain = confirmedChainRaw.startsWith("0x") ? Number.parseInt(confirmedChainRaw.slice(2), 16) : Number(confirmedChainRaw);
      if (confirmedChain !== PROVIDER_ERC8183_TESTNET.chainId) throw new Error("Wallet could not switch to BSC Testnet (chain 97).");

      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const first = accounts?.[0];
      if (!first) throw new Error("No wallet account was returned.");
      setAccount(getAddress(first));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to connect wallet");
    }
  }

  async function submit() {
    if (!job || !account) return;
    if (job.status !== 1) {
      setError("The job is no longer FUNDED on-chain.");
      return;
    }
    if (job.provider.toLowerCase() !== account.toLowerCase()) {
      setError("The connected wallet is not the provider assigned to this job.");
      return;
    }
    if (Number(job.expiredAt) * 1000 <= Date.now()) {
      setError("The job has expired.");
      return;
    }
    if (!deliverable.trim()) {
      setError("Add the deliverable before submitting.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const deliverableHash = keccak256(stringToBytes(deliverable.trim()));
      const data = encodeFunctionData({
        abi: PROVIDER_COMMERCE_ABI,
        functionName: "submit",
        args: [BigInt(jobId), deliverableHash, "0x"],
      });
      const receipt = await sendAndConfirm({ to: PROVIDER_ERC8183_TESTNET.commerce, data });
      setHash(receipt.hash);

      const verified = await providerPublicClient.readContract({
        address: PROVIDER_ERC8183_TESTNET.commerce,
        abi: PROVIDER_COMMERCE_ABI,
        functionName: "getJob",
        args: [BigInt(jobId)],
      }) as Job;
      if (verified.status !== 2) throw new Error("Transaction confirmed, but the chain did not move the job to SUBMITTED.");
      if (verified.deliverable.toLowerCase() !== deliverableHash.toLowerCase()) throw new Error("On-chain deliverable hash does not match the submitted result.");

      const response = await fetch("/api/agent-actions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, chain_job_id: jobId, action: "submit", payload: { result: deliverable.trim(), tx_hash: receipt.hash } }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Marketplace submission sync failed");
      setJob(verified);
      setNotice(`Provider submission confirmed on BSC Testnet in block ${receipt.blockNumber}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider submission failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="provider-submit-page">
      <div className="provider-submit-curve provider-submit-curve-a" aria-hidden="true" />
      <div className="provider-submit-shell">
        <header className="provider-submit-nav"><a href="/" className="provider-submit-brand">AgentMarket</a><span>PROVIDER / ON-CHAIN SUBMIT</span><a href={`/agent/inbox?agent=${encodeURIComponent(agentId)}`}>Back to inbox →</a></header>
        {error && <div className="provider-submit-alert error">{error}</div>}
        {notice && <div className="provider-submit-alert success">{notice}</div>}
        <section className="provider-submit-hero"><span>ERC-8183 / BSC TESTNET</span><h1>Submit the real deliverable.</h1><p>The result stays off-chain. Only its keccak256 hash is anchored on-chain. The provider wallet must be the assigned provider for this job.</p></section>
        <div className="provider-submit-grid">
          <section className="provider-submit-card">
            <div className="provider-submit-head"><span>01 / LIVE JOB</span><b>{job ? ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"][job.status] || `STATUS ${job.status}` : "LOADING"}</b></div>
            {job ? <div className="provider-submit-lines"><div><span>JOB</span><strong>#{job.id.toString()}</strong></div><div><span>PROVIDER</span><strong>{compact(job.provider)}</strong></div><div><span>CLIENT</span><strong>{compact(job.client)}</strong></div><div><span>BUDGET</span><strong>{job.budget.toString()}</strong></div><div><span>EXPIRY</span><strong>{new Date(Number(job.expiredAt) * 1000).toLocaleString()}</strong></div><div><span>DELIVERABLE HASH</span><strong>{job.deliverable}</strong></div></div> : null}
          </section>
          <section className="provider-submit-card">
            <div className="provider-submit-head"><span>02 / PROVIDER WALLET</span><b>{account ? compact(account) : "NOT CONNECTED"}</b></div>
            <button className="provider-submit-button" onClick={() => void connect()} disabled={busy}>{account ? "Wallet connected" : "Connect provider wallet →"}</button>
            <textarea className="provider-submit-textarea" value={deliverable} onChange={(event) => setDeliverable(event.target.value)} placeholder="Enter the completed result or evidence…" rows={12} />
            <div className="provider-submit-hash"><span>KECCAK256</span><strong>{deliverable.trim() ? keccak256(stringToBytes(deliverable.trim())) : "Waiting for deliverable"}</strong></div>
            <button className="provider-submit-button primary" onClick={() => void submit()} disabled={busy || !job || !account}>{busy ? "Confirming on-chain…" : "Submit on-chain →"}</button>
            {hash && <div className="provider-submit-tx"><small>CONFIRMED TRANSACTION</small><strong>{hash}</strong></div>}
          </section>
        </div>
        <footer className="provider-submit-footer">Network locked to BSC Testnet (chain ID 97). AgentMarket never receives the provider private key.</footer>
      </div>
    </main>
  );
}
