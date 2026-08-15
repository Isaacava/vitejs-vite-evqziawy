import { useEffect, useMemo, useState } from "react";
import "./mission-console.css";

type GateResponse = {
  ok: boolean;
  quote: {
    quote_id: string;
    status: string;
    price: string;
    currency: string;
    quote_hash: string;
    expires_at: string;
  };
  network: string;
  chain_id: number;
  next: { path: string } | null;
};

const TESTNET_CHAIN_ID = "0x61";

export default function TestnetQuoteGate() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const missionId = params.get("mission") || "";
  const quoteId = params.get("quote") || "";
  const [result, setResult] = useState<GateResponse | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function verify() {
      try {
        if (!missionId || !quoteId) throw new Error("mission and quote query parameters are required");
        const ethereum = window.ethereum;
        if (!ethereum) throw new Error("Connect a compatible browser wallet before continuing.");
        const chainId = String(await ethereum.request({ method: "eth_chainId" })).toLowerCase();
        if (chainId !== TESTNET_CHAIN_ID) throw new Error("Switch the wallet to BSC Testnet (chain 97).");
        const accounts = (await ethereum.request({ method: "eth_accounts" })) as string[];
        if (!accounts[0]) throw new Error("No wallet account is connected.");
        const response = await fetch("/api/testnet/prepare-quote", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mission_id: missionId, quote_id: quoteId, client_address: accounts[0] }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "The accepted Testnet quote is not executable.");
        if (body.network !== "bsc-testnet" || Number(body.chain_id) !== 97) throw new Error("Quote validation returned a non-Testnet environment.");
        if (!active) return;
        const nextResult = body as GateResponse;
        setResult(nextResult);
        const expiry = Date.parse(nextResult.quote.expires_at);
        setRemaining(Math.max(0, expiry - Date.now()));
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to validate Testnet quote");
      } finally {
        if (active) setLoading(false);
      }
    }
    void verify();
    return () => { active = false; };
  }, [missionId, quoteId]);

  useEffect(() => {
    if (remaining == null || remaining <= 0) return;
    const timer = window.setInterval(() => setRemaining((current) => current == null ? null : Math.max(0, current - 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  const expired = remaining === 0;
  const seconds = remaining == null ? null : Math.ceil(remaining / 1000);

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a href="/" className="console-brand">AgentMarket</a>
          <span>TESTNET / QUOTE GATE</span>
          <a href="/testnet">Sandbox →</a>
        </header>
        {error && <div className="console-alert console-alert-error">{error}</div>}
        <section className="console-hero">
          <div>
            <span className="console-kicker">BSC TESTNET / CHAIN 97</span>
            <h1>Confirm the quote before signing.</h1>
            <p>The accepted provider quote is revalidated immediately before the wallet runner. Expired or non-Testnet quotes cannot proceed.</p>
          </div>
          <div className="console-state"><small>QUOTE WINDOW</small><strong>{seconds == null ? "CHECKING" : expired ? "EXPIRED" : `${seconds}s`}</strong><span>Server validation remains authoritative.</span></div>
        </section>
        {loading ? (
          <section className="console-card"><p className="console-evidence">Validating the accepted Testnet quote…</p></section>
        ) : result ? (
          <section className="console-grid">
            <div className="console-card">
              <div className="console-section-head"><span>ACCEPTED QUOTE</span><b>{result.quote.status}</b></div>
              <div className="console-stat"><span>Price</span><strong>{result.quote.price} {result.quote.currency}</strong></div>
              <div className="console-stat"><span>Expiry</span><strong>{new Date(result.quote.expires_at).toLocaleString()}</strong></div>
              <div className="console-stat"><span>Quote hash</span><strong>{result.quote.quote_hash.slice(0, 10)}…{result.quote.quote_hash.slice(-8)}</strong></div>
              <div className="console-stat"><span>Environment</span><strong>{result.network} / {result.chain_id}</strong></div>
            </div>
            <div className="console-card">
              <div className="console-section-head"><span>EXECUTION GATE</span><b>{expired ? "LOCKED" : "OPEN"}</b></div>
              {expired ? (
                <>
                  <p className="console-evidence">This quote expired. Return to the marketplace and request a fresh provider quote; no wallet transaction is available from this gate.</p>
                  <a className="console-brass-button" href="/app" style={{ textDecoration: "none", display: "inline-flex" }}>Request fresh Testnet quote →</a>
                </>
              ) : result.next ? (
                <a className="console-brass-button" href={result.next.path} style={{ textDecoration: "none", display: "inline-flex" }}>Continue to preflight →</a>
              ) : (
                <p className="console-evidence">The server accepted the quote but did not return a next-step route. Refresh the gate.</p>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
