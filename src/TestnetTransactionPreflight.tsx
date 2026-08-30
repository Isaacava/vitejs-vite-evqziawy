import { useEffect, useMemo, useState } from "react";
import "./mission-console.css";

type Check = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
};

type PreflightResponse = {
  ok: boolean;
  ready: boolean;
  network: string;
  chain_id: number;
  checks: Check[];
  next: { path: string } | null;
};

const TESTNET_CHAIN_ID = "0x61";

export default function TestnetTransactionPreflight() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const missionId = params.get("mission") || "";
  const quoteId = params.get("quote") || "";
  const marketplaceJobId = params.get("job") || "";

  const [result, setResult] = useState<PreflightResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [network, setNetwork] = useState("checking");

  async function runPreflight() {
    setRefreshing(true);
    setError("");
    try {
      if (!missionId || !quoteId) throw new Error("mission and quote query parameters are required");
      const ethereum = window.ethereum;
      if (!ethereum) throw new Error("Connect a compatible browser wallet before running the Testnet preflight.");

      const chainId = String(await ethereum.request({ method: "eth_chainId" })).toLowerCase();
      if (chainId !== TESTNET_CHAIN_ID) throw new Error("Wrong network. Switch the wallet to BSC Testnet (chain 97).");
      setNetwork("bsc-testnet / 97");

      const accounts = (await ethereum.request({ method: "eth_accounts" })) as string[];
      const wallet = accounts[0];
      if (!wallet) throw new Error("No wallet account is connected.");

      const auth = await fetch("/api/auth/me", { credentials: "include" });
      if (!auth.ok) throw new Error("Wallet authentication is required before a Testnet transaction can be signed.");

      const response = await fetch("/api/testnet/transaction-preflight", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission_id: missionId, quote_id: quoteId, client_address: wallet, job_id: marketplaceJobId || undefined }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Testnet transaction preflight failed");
      if (body.network !== "bsc-testnet" || Number(body.chain_id) !== 97) throw new Error("Preflight returned a non-Testnet environment.");
      setResult(body as PreflightResponse);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "Unable to run Testnet preflight");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { void runPreflight(); }, []);

  const passed = result?.checks.filter((check) => check.ok).length ?? 0;
  const total = result?.checks.length ?? 0;

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a href="/" className="console-brand">AgentMarket</a>
          <span>TESTNET / TRANSACTION PREFLIGHT</span>
          <a href="/testnet">Sandbox →</a>
        </header>

        {error && <div className="console-alert console-alert-error">{error}</div>}

        <section className="console-hero">
          <div>
            <span className="console-kicker">BSC TESTNET / CHAIN 97</span>
            <h1>Ready before the first signature.</h1>
            <p>AgentMarket verifies the accepted quote, provider, wallet, settlement token and ERC-8183 Testnet contracts before opening the transaction runner.</p>
          </div>
          <div className="console-state"><small>NETWORK</small><strong>{network}</strong><span>Testnet only. Mainnet transactions are not available here.</span></div>
        </section>

        {loading ? (
          <section className="console-card"><p className="console-evidence">Running Testnet transaction preflight…</p></section>
        ) : result ? (
          <>
            <section className="console-grid">
              <div className="console-card">
                <div className="console-section-head"><span>READINESS</span><b>{result.ready ? "READY" : "BLOCKED"}</b></div>
                <div className="console-stat"><span>Checks</span><strong>{passed} / {total}</strong></div>
                <div className="console-stat"><span>Environment</span><strong>{result.network}</strong></div>
                <div className="console-stat"><span>Chain</span><strong>{result.chain_id}</strong></div>
                <button className="console-brass-button" type="button" disabled={refreshing} onClick={() => void runPreflight()}>{refreshing ? "Checking…" : "Run preflight again →"}</button>
              </div>
              <div className="console-card">
                <div className="console-section-head"><span>TRANSACTION GATE</span><b>{result.ready ? "OPEN" : "LOCKED"}</b></div>
                <p className="console-evidence">The execution screen is only unlocked when every mandatory preflight check passes.</p>
                {result.ready && result.next ? (
                  <a className="console-brass-button" href={result.next.path} style={{ textDecoration: "none", display: "inline-flex" }}>Continue to wallet execution →</a>
                ) : (
                  <p className="console-evidence">Fix the failed checks below, then rerun the preflight.</p>
                )}
              </div>
            </section>

            <section className="console-card">
              <div className="console-section-head"><span>CHECKS</span><b>{result.ready ? "ALL CLEAR" : "ACTION REQUIRED"}</b></div>
              <div style={{ display: "grid", gap: 10 }}>
                {result.checks.map((check) => (
                  <div key={check.key} className="console-stat">
                    <span>{check.ok ? "✓" : "✕"} {check.label}</span>
                    <strong>{check.detail}</strong>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
