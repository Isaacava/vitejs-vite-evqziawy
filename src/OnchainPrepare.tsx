import { useEffect, useState } from "react";
import { getCurrentUser, type AuthUser } from "./lib/walletAuth";
import "./mission-console.css";

type Preparation = {
  ok: boolean;
  network: string;
  mission: { id: string; status: string };
  agent: { agent_id: string; name: string | null; provider: string; status: string; verification_status: string };
  commerce: { address: string; evaluator: string; hook: string; default_policy: string };
  payment: { token: string; symbol: string; decimals: number; budget_raw: string };
  expiry: string;
  wallet_steps: string[];
  transactions: Record<string, { to?: string; value?: string; data?: string; policy?: string; data_builder?: string }>;
  note: string;
};

const compact = (value?: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

export default function OnchainPrepare() {
  const missionId = new URLSearchParams(window.location.search).get("mission") || "";
  const [budget, setBudget] = useState("1");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [data, setData] = useState<Preparation | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    async function loadUser() {
      try {
        const current = await getCurrentUser();
        if (!mounted) return;
        if (!current) {
          window.location.href = `/dashboard?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;
          return;
        }
        setUser(current);
      } catch (cause) {
        if (mounted) setError(cause instanceof Error ? cause.message : "Unable to load your wallet session");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void loadUser();
    return () => {
      mounted = false;
    };
  }, []);

  async function prepare() {
    if (!missionId) {
      setError("No mission selected.");
      return;
    }
    if (!user?.wallet_address) {
      setError("Connect and sign in before preparing the mission.");
      return;
    }

    setPreparing(true);
    setError("");
    try {
      const response = await fetch("/api/erc8183/prepare", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission_id: missionId,
          client_address: user.wallet_address,
          budget,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Unable to prepare mission");
      setData(body as Preparation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to prepare mission");
    } finally {
      setPreparing(false);
    }
  }

  if (!missionId) {
    return (
      <main className="console-page">
        <div className="console-shell">
          <section className="console-card">
            <span className="console-kicker">ERC-8183 / PREPARE</span>
            <h1>No mission selected.</h1>
            <p>Return to the marketplace and choose a mission before preparing on-chain.</p>
            <a className="console-dark-button" href="/app">Back to marketplace →</a>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="console-page">
      <div className="console-curve console-curve-a" aria-hidden="true" />
      <div className="console-curve console-curve-b" aria-hidden="true" />
      <div className="console-shell">
        <header className="console-nav">
          <a href="/" className="console-brand">AgentMarket</a>
          <span>MISSION / ON-CHAIN PREPARATION</span>
          <a href="/app">Back to marketplace →</a>
        </header>

        {error && <div className="console-alert console-alert-error">{error}</div>}

        <section className="console-hero">
          <div>
            <span className="console-kicker">ERC-8183 / PREPARE</span>
            <h1>Review the job before the wallet signs.</h1>
            <p>We prepare the on-chain call sequence from the selected mission. Your signed AgentMarket wallet session is used as the client identity; the server never receives or stores your private key.</p>
          </div>
          <div className="console-state"><small>NETWORK</small><strong>{data?.network || "BSC TESTNET"}</strong><span>Preparation only. State-changing transactions still require an explicit wallet confirmation.</span></div>
        </section>

        {loading ? (
          <section className="console-card"><div className="console-section-head"><span>SESSION</span><b>LOADING</b></div><p className="console-evidence">Checking your signed AgentMarket session…</p></section>
        ) : (
          <>
            <div className="console-grid">
              <section className="console-card">
                <div className="console-section-head"><span>01 / JOB TERMS</span><b>{data?.agent?.name || "Selected agent"}</b></div>
                <div className="console-stat"><span>Mission</span><strong>{compact(missionId)}</strong></div>
                <div className="console-stat"><span>Client wallet</span><strong>{compact(user?.wallet_address)}</strong></div>
                <div className="console-stat"><span>Provider wallet</span><strong>{compact(data?.agent?.provider)}</strong></div>
                <div className="console-stat"><span>Identity</span><strong>{data?.agent?.verification_status || "indexed"}</strong></div>
                <div className="console-stat"><span>Endpoint</span><strong>{data?.agent?.status || "unknown"}</strong></div>
                <div className="console-stat"><span>Payment asset</span><strong>{data?.payment?.symbol || "—"}</strong></div>
                <label className="console-field-label" htmlFor="mission-budget">MISSION BUDGET</label>
                <input id="mission-budget" className="console-input" value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" />
                <button className="console-brass-button" disabled={preparing || !user?.wallet_address} onClick={() => void prepare()}>{preparing ? "Preparing…" : "Build transaction plan →"}</button>
              </section>

              <aside className="console-card">
                <div className="console-section-head"><span>02 / SEQUENCE</span><b>{data ? "READY" : "WAITING"}</b></div>
                <ol className="console-sequence">
                  {(data?.wallet_steps || ["createJob", "registerJob", "setBudget", "approve payment token", "fund"]).map((step, index) => (
                    <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong><small>{index === 0 ? "Create the ERC-8183 job." : index === 4 ? "Fund escrow after prior receipts confirm." : "Prepare only; wallet confirmation is required."}</small></li>
                  ))}
                </ol>
              </aside>
            </div>

            <section className="console-card console-plan-card">
              <div className="console-section-head"><span>03 / TRANSACTION PLAN</span><b>{data ? "INSPECTABLE" : "NOT LOADED"}</b></div>
              {!data ? (
                <p className="console-evidence">Build the plan to load the live payment asset, provider, evaluator and encoded transaction details.</p>
              ) : (
                <div className="console-plan-list">
                  {Object.entries(data.transactions).map(([name, tx]) => (
                    <article className="console-plan-row" key={name}>
                      <div><small>{name.replace(/_/g, " ")}</small><strong>{tx.to ? compact(tx.to) : tx.policy ? compact(tx.policy) : "builder"}</strong></div>
                      <p>{tx.data ? "Encoded transaction data ready." : tx.data_builder || "No data generated yet."}</p>
                    </article>
                  ))}
                </div>
              )}
              {data && <div className="console-evidence"><small>IMPORTANT</small><p>{data.note}</p></div>}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
