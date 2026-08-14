import { useEffect, useState } from "react";
import "./onchain-prepare.css";

type PrepareResponse = {
  ok: boolean;
  network: string;
  mission: { id: string; status: string };
  agent: {
    agent_id: string;
    name: string | null;
    provider: string;
    status: string | null;
    verification_status: string | null;
  };
  commerce: { address: string; evaluator: string; hook: string; default_policy: string };
  payment: { token: string; symbol: string; decimals: number; budget_raw: string };
  expiry: string;
  wallet_steps: string[];
  transactions: {
    createJob: { to: string; value: string; data: string };
    registerJob: { to: string; value: string; data_builder: string; policy: string };
    setBudget: { to: string; value: string; data_builder: string };
    approve: { to: string; value: string; data_builder: string };
    fund: { to: string; value: string; data_builder: string };
  };
  note: string;
};

function compact(value?: string) {
  if (!value) return "—";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export default function OnchainPrepare() {
  const params = new URLSearchParams(window.location.search);
  const missionId = params.get("mission") || "";
  const [budget, setBudget] = useState("1");
  const [wallet, setWallet] = useState<string | null>(null);
  const [result, setResult] = useState<PrepareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const provider = (window as Window & { ethereum?: { request?: (args: { method: string }) => Promise<unknown> } }).ethereum;
    if (!provider?.request) return;
    void provider.request({ method: "eth_accounts" }).then((accounts) => {
      const first = Array.isArray(accounts) ? accounts[0] : null;
      if (typeof first === "string") setWallet(first);
    });
  }, []);

  async function prepare() {
    if (!missionId) {
      setError("Open this page with a mission id.");
      return;
    }
    if (!wallet) {
      setError("Connect a wallet first. No transaction will be signed on this page.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/erc8183/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission_id: missionId, client_address: wallet, budget }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Unable to prepare mission");
      setResult(data as PrepareResponse);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "Unable to prepare mission");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="prepare-page">
      <div className="prepare-orbit prepare-orbit-a" />
      <div className="prepare-orbit prepare-orbit-b" />
      <header className="prepare-nav">
        <a href="/" className="prepare-brand">AgentMarket</a>
        <span>MISSION / ON-CHAIN PREP</span>
        <a href="/app">Back to marketplace →</a>
      </header>

      <section className="prepare-hero">
        <div>
          <span className="prepare-kicker">ERC-8183 · WALLET-READY</span>
          <h1>Turn the mission into a real job.</h1>
          <p>AgentMarket prepares the transaction sequence. Your wallet remains the signer, and the mission is not marked funded until the blockchain receipts confirm it.</p>
        </div>
        <div className="prepare-note">
          <small>IMPORTANT</small>
          <strong>Prepare ≠ Fund</strong>
          <span>No private key is stored or used by the server.</span>
        </div>
      </section>

      <section className="prepare-card">
        <div className="prepare-form-head"><span>01 / MISSION</span><b>{missionId ? compact(missionId) : "Missing mission"}</b></div>
        <div className="prepare-form">
          <label>
            <span>Budget in payment-token units</span>
            <input value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" min="0" step="0.01" />
          </label>
          <div className="wallet-state">
            <span>Wallet</span>
            <b>{wallet ? compact(wallet) : "Not connected"}</b>
          </div>
          <button type="button" className="prepare-button" onClick={() => void prepare()} disabled={loading}>
            {loading ? "Preparing…" : "Prepare ERC-8183 sequence →"}
          </button>
        </div>
      </section>

      {error && <div className="prepare-alert error">{error}</div>}

      {result && (
        <section className="prepare-result">
          <div className="prepare-result-head"><span>02 / TRANSACTION PLAN</span><b>{result.network}</b></div>
          <div className="prepare-summary">
            <div><small>Agent</small><strong>{result.agent.name || `Agent #${result.agent.agent_id}`}</strong></div>
            <div><small>Payment token</small><strong>{result.payment.symbol}</strong></div>
            <div><small>Budget</small><strong>{result.payment.budget_raw}</strong></div>
            <div><small>Provider</small><strong>{compact(result.agent.provider)}</strong></div>
          </div>
          <div className="prepare-steps">
            {result.wallet_steps.map((step, index) => (
              <div className="prepare-step" key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{step}</strong><p>{index === 0 ? "Creates the on-chain ERC-8183 job." : index === 1 ? "Attaches the evaluation policy before funding." : index === 2 ? "Sets the job escrow budget." : index === 3 ? "Approves the commerce contract only when needed." : "Moves the defined budget into the job escrow."}</p></div>
              </div>
            ))}
          </div>
          <div className="prepare-proof">
            <div><small>Create Job</small><code>{compact(result.transactions.createJob.to)}</code></div>
            <div><small>Policy</small><code>{compact(result.transactions.registerJob.policy)}</code></div>
            <div><small>Token</small><code>{compact(result.payment.token)}</code></div>
          </div>
          <div className="prepare-footnote">{result.note}</div>
        </section>
      )}
    </main>
  );
}
