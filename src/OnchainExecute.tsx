import { useEffect, useMemo, useState } from "react";
import OnchainTransactionRunner, { type ConfirmedRunnerReceipt, type TransactionStep } from "./OnchainTransactionRunner";
import { getCurrentUser, type AuthUser } from "./lib/walletAuth";
import { buildErc8183Plan, type Erc8183PreparedResponse } from "./lib/erc8183TransactionPlan";
import { extractCreatedJobId } from "./lib/erc8183Events";
import "./mission-console.css";

const TESTNET_PREPARE_API = "/api/testnet/erc8183";

export default function OnchainExecute() {
  const params = new URLSearchParams(window.location.search);
  const missionId = params.get("mission") || "";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [prepared, setPrepared] = useState<Erc8183PreparedResponse | null>(null);
  const [chainJobId, setChainJobId] = useState("");
  const [receipt, setReceipt] = useState<ConfirmedRunnerReceipt | null>(null);
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
    let active = true;
    fetch(TESTNET_PREPARE_API, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mission_id: missionId, client_address: user.wallet_address, budget: "1" }),
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "Unable to prepare Testnet ERC-8183 job");
        if (active) setPrepared(body as Erc8183PreparedResponse);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to prepare Testnet ERC-8183 job");
      });
    return () => {
      active = false;
    };
  }, [missionId, user]);

  const plan = useMemo(() => {
    if (!prepared) return [];
    return buildErc8183Plan(prepared, chainJobId || undefined);
  }, [prepared, chainJobId]);

  const steps: TransactionStep[] = useMemo(() => plan.map((step) => ({
    id: step.id,
    label: step.label,
    description: step.description,
    tx: step.transaction || undefined,
    disabled: step.id !== "create" && !chainJobId,
  })), [plan, chainJobId]);

  function handleConfirmed(step: TransactionStep, confirmed: ConfirmedRunnerReceipt) {
    if (step.id !== "create") return;
    setReceipt(confirmed);
    try {
      const created = extractCreatedJobId(confirmed.logs || [], prepared?.transactions.create_job?.to || "");
      setChainJobId(created.jobId);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to decode the Testnet JobCreated event");
    }
  }

  return (
    <main className="console-page">
      <div className="console-curve console-curve-a" aria-hidden="true" />
      <div className="console-curve console-curve-b" aria-hidden="true" />
      <div className="console-shell">
        <header className="console-nav">
          <a href="/" className="console-brand">AgentMarket</a>
          <span>TESTNET / WALLET EXECUTION</span>
          <a href={`/prepare?mission=${encodeURIComponent(missionId)}`}>Back to preparation →</a>
        </header>

        {error && <div className="console-alert console-alert-error">{error}</div>}

        <section className="console-hero">
          <div>
            <span className="console-kicker">ERC-8183 / BSC TESTNET / CHAIN 97</span>
            <h1>Fund the Testnet mission from your own wallet.</h1>
            <p>Every state-changing transaction requires explicit wallet confirmation. This development runner only targets the BSC Testnet contracts.</p>
          </div>
          <div className="console-state"><small>JOB</small><strong>{chainJobId ? `#${chainJobId}` : "AWAITING createJob"}</strong><span>{chainJobId ? "Confirmed on BSC Testnet." : "createJob must confirm before later steps are enabled."}</span></div>
        </section>

        <section className="console-card console-plan-card">
          <div className="console-section-head"><span>TESTNET EXECUTION STATE</span><b>{prepared ? (chainJobId ? "JOB READY" : "PLAN READY") : "PREPARING"}</b></div>
          <p className="console-evidence">The Testnet flow decodes the real <code>JobCreated</code> event, then builds Testnet registerJob, setBudget, approval, and fund transactions with the confirmed job ID.</p>
          <OnchainTransactionRunner steps={steps} onConfirmed={handleConfirmed} />
        </section>

        {receipt && chainJobId && (
          <section className="console-card console-plan-card">
            <div className="console-section-head"><span>TESTNET CHAIN EVIDENCE</span><b>JOB #{chainJobId}</b></div>
            <p className="console-evidence">createJob transaction {receipt.hash.slice(0, 10)}… confirmed in block {receipt.blockNumber}. The job ID was decoded directly from the BSC Testnet receipt.</p>
          </section>
        )}
      </div>
    </main>
  );
}
