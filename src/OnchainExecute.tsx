import { useEffect, useMemo, useState } from "react";
import OnchainTransactionRunner, { type TransactionStep } from "./OnchainTransactionRunner";
import { getCurrentUser, type AuthUser } from "./lib/walletAuth";
import { buildErc8183Plan, type Erc8183PreparedResponse } from "./lib/erc8183TransactionPlan";
import { extractCreatedJobId } from "./lib/erc8183Events";
import "./mission-console.css";

type Receipt = { hash: string; blockNumber: string; logs: Array<{ topics: readonly `0x${string}`[]; data: `0x${string}` }> };

export default function OnchainExecute() {
  const params = new URLSearchParams(window.location.search);
  const missionId = params.get("mission") || "";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [prepared, setPrepared] = useState<Erc8183PreparedResponse | null>(null);
  const [chainJobId, setChainJobId] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void getCurrentUser().then((current) => {
      if (!current) {
        window.location.href = `/dashboard?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      setUser(current);
    });
  }, []);

  useEffect(() => {
    if (!missionId || !user) return;
    void fetch("/api/erc8183/prepare", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mission_id: missionId, client_address: user.wallet_address, budget: "1" }),
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "Unable to prepare ERC-8183 job");
        setPrepared(body as Erc8183PreparedResponse);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to prepare ERC-8183 job"));
  }, [missionId, user]);

  const plan = useMemo(() => {
    if (!prepared) return [];
    try {
      return buildErc8183Plan(prepared, chainJobId || undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to build transaction plan");
      return [];
    }
  }, [prepared, chainJobId]);

  const steps: TransactionStep[] = useMemo(() => plan.map((step) => ({
    id: step.id,
    label: step.label,
    description: step.description,
    tx: step.transaction || undefined,
    disabled: step.id !== "create" && !chainJobId,
  })), [plan, chainJobId]);

  return (
    <main className="console-page">
      <div className="console-curve console-curve-a" aria-hidden="true" />
      <div className="console-curve console-curve-b" aria-hidden="true" />
      <div className="console-shell">
        <header className="console-nav">
          <a href="/" className="console-brand">AgentMarket</a>
          <span>MISSION / WALLET EXECUTION</span>
          <a href={`/prepare?mission=${encodeURIComponent(missionId)}`}>Back to preparation →</a>
        </header>

        {error && <div className="console-alert console-alert-error">{error}</div>}

        <section className="console-hero">
          <div>
            <span className="console-kicker">ERC-8183 / BSC TESTNET</span>
            <h1>Fund the mission from your own wallet.</h1>
            <p>Each state-changing transaction requires an explicit wallet confirmation. AgentMarket never receives or stores your private key.</p>
          </div>
          <div className="console-state"><small>SESSION</small><strong>{user ? `${user.wallet_address.slice(0, 8)}…${user.wallet_address.slice(-6)}` : "CHECKING"}</strong><span>Wallet signs every transaction.</span></div>
        </section>

        <section className="console-card console-plan-card">
          <div className="console-section-head"><span>EXECUTION STATE</span><b>{chainJobId ? `JOB ${chainJobId}` : "AWAITING createJob"}</b></div>
          <p className="console-evidence">The first confirmed receipt is decoded for the real ERC-8183 <code>JobCreated</code> event. Later calls are then encoded with that confirmed job ID.</p>
          <OnchainTransactionRunner steps={steps} />
        </section>

        {receipt && (
          <section className="console-card console-plan-card">
            <div className="console-section-head"><span>CREATE RECEIPT</span><b>CONFIRMED</b></div>
            <p className="console-evidence">Transaction {receipt.hash.slice(0, 10)}… confirmed in block {receipt.blockNumber}.</p>
            <button className="console-dark-button" onClick={() => {
              try {
                if (!prepared) return;
                const created = extractCreatedJobId(receipt.logs, prepared.transactions.create_job?.to || "");
                setChainJobId(created.jobId);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Unable to decode JobCreated event");
              }
            }}>Extract confirmed job ID →</button>
          </section>
        )}
      </div>
    </main>
  );
}
