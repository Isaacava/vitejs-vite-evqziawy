import { useEffect, useState } from "react";
import { getCurrentUser, type AuthUser } from "./lib/walletAuth";
import { readPaymentState, type PaymentState } from "./lib/bscTestnet";
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
const validAddress = (value?: string | null) => /^0x[a-fA-F0-9]{40}$/.test(value || "");

export default function OnchainPrepare() {
  const missionId = new URLSearchParams(window.location.search).get("mission") || "";
  const [budget, setBudget] = useState("1");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [livePayment, setLivePayment] = useState<PaymentState | null>(null);
  const [data, setData] = useState<Preparation | null>(null);
  const [loading, setLoading] = useState(true);
  const [readingChain, setReadingChain] = useState(false);
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

  useEffect(() => {
    if (!validAddress(user?.wallet_address)) return;
    let mounted = true;
    async function loadPaymentState() {
      setReadingChain(true);
      try {
        const state = await readPaymentState(user!.wallet_address as `0x${string}`);
        if (mounted) setLivePayment(state);
      } catch (cause) {
        if (mounted) setError(cause instanceof Error ? cause.message : "Unable to read BSC Testnet payment state");
      } finally {
        if (mounted) setReadingChain(false);
      }
    }
    void loadPaymentState();
    return () => {
      mounted = false;
    };
  }, [user?.wallet_address]);

  async function prepare() {
    if (!missionId) {
      setError("No mission selected.");
      return;
    }
    if (!user?.wallet_address) {
      setError("Connect and sign in before preparing the mission.");
      return;
    }

    const requested = Number(budget);
    if (!Number.isFinite(requested) || requested <= 0) {
      setError("Enter a valid positive mission budget.");
      return;
    }

    if (livePayment) {
      const balance = Number(livePayment.balanceFormatted);
      if (Number.isFinite(balance) && requested > balance) {
        setError(`Wallet balance is ${livePayment.balanceFormatted} ${livePayment.symbol}; the requested mission budget is ${budget} ${livePayment.symbol}.`);
        return;
      }
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

  const allowanceEnough = livePayment && Number(livePayment.allowanceFormatted) >= Number(budget);

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
            <span className="console-kicker">ERC-8183 / BSC TESTNET</span>
            <h1>Review the job before the wallet signs.</h1>
            <p>AgentMarket reads the live testnet payment state first. The server never receives your private key, and no transaction is sent automatically.</p>
          </div>
          <div className="console-state"><small>CHAIN</small><strong>BSC TESTNET / 97</strong><span>{readingChain ? "Reading live payment state…" : "Live balance and allowance checked."}</span></div>
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
                <div className="console-stat"><span>Payment asset</span><strong>{livePayment?.symbol || data?.payment?.symbol || "—"}</strong></div>
                <label className="console-field-label" htmlFor="mission-budget">MISSION BUDGET</label>
                <input id="mission-budget" className="console-input" value={budget} onChange={(event) => { setBudget(event.target.value); setData(null); }} inputMode="decimal" />
                <button className="console-brass-button" disabled={preparing || readingChain || !user?.wallet_address} onClick={() => void prepare()}>{preparing ? "Preparing…" : "Build transaction plan →"}</button>
              </section>

              <aside className="console-card">
                <div className="console-section-head"><span>02 / LIVE PREFLIGHT</span><b>{readingChain ? "READING" : livePayment ? "CONNECTED" : "WAITING"}</b></div>
                <div className="console-stat"><span>Payment token</span><strong>{livePayment ? compact(livePayment.token) : "—"}</strong></div>
                <div className="console-stat"><span>Wallet balance</span><strong>{livePayment ? `${livePayment.balanceFormatted} ${livePayment.symbol}` : "—"}</strong></div>
                <div className="console-stat"><span>Allowance to Commerce</span><strong>{livePayment ? `${livePayment.allowanceFormatted} ${livePayment.symbol}` : "—"}</strong></div>
                <div className="console-stat"><span>Approval required</span><strong>{livePayment ? (allowanceEnough ? "No" : "Yes") : "—"}</strong></div>
                <p className="console-evidence">The SDK resolves the payment token from the Commerce contract at runtime. An ERC-20 approval is only needed when the existing allowance is insufficient.</p>
              </aside>
            </div>

            <section className="console-card console-plan-card">
              <div className="console-section-head"><span>03 / TRANSACTION PLAN</span><b>{data ? "INSPECTABLE" : "NOT LOADED"}</b></div>
              {!data ? (
                <ol className="console-sequence">
                  {["createJob", "registerJob", "setBudget", "approve payment token if needed", "fund"].map((step, index) => (
                    <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong><small>{index === 4 ? "Moves the approved payment into ERC-8183 escrow." : "Preparation only; wallet confirmation is required."}</small></li>
                  ))}
                </ol>
              ) : (
                <>
                  <div className="console-plan-list">
                    {Object.entries(data.transactions).map(([name, tx]) => (
                      <article className="console-plan-row" key={name}>
                        <div><small>{name.replace(/_/g, " ")}</small><strong>{tx.to ? compact(tx.to) : tx.policy ? compact(tx.policy) : "builder"}</strong></div>
                        <p>{tx.data ? "Encoded transaction data ready." : tx.data_builder || "No data generated yet."}</p>
                      </article>
                    ))}
                  </div>
                  <div className="console-evidence"><small>IMPORTANT</small><p>{data.note}</p></div>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
