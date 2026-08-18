import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import MarketplaceWorkspace from "./MarketplaceWorkspace";
import TestnetQuoteExecution from "./TestnetQuoteExecution";
import TestnetQuoteGate from "./TestnetQuoteGate";
import TestnetSandbox from "./TestnetSandbox";
import TestnetRecovery from "./TestnetRecovery";
import TestnetJobHistory from "./TestnetJobHistory";
import TestnetProviderReadiness from "./TestnetProviderReadiness";
import TestnetTransactionPreflight from "./TestnetTransactionPreflight";
import TestnetGridRun from "./TestnetGridRun";
import { ensureWalletConnectedProvider } from "./lib/walletAuth";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const missionId = params.get("mission");
const quoteId = params.get("quote");
const path = window.location.pathname;

function WalletExecutionGate() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        await ensureWalletConnectedProvider();
        if (active) setReady(true);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to restore WalletConnect");
      }
    }
    void restore();
    return () => { active = false; };
  }, []);

  if (ready) return <TestnetQuoteExecution />;

  return (
    <main className="console-page">
      <div className="console-shell">
        <header className="console-nav">
          <a href="/testnet" className="console-brand">AgentMarket Testnet</a>
          <span>TESTNET / WALLET</span>
          <a href="/app">Back to Testnet marketplace →</a>
        </header>
        <section className="console-card">
          <span className="console-kicker">WALLETCONNECT · BSC TESTNET / 97</span>
          <h1 style={{ marginTop: 8 }}>Reconnect your Testnet wallet.</h1>
          <p className="console-evidence">
            This preview only accepts a WalletConnect session on BSC Testnet. Mainnet wallet sessions are rejected before authentication or transaction signing.
          </p>
          {error && <div className="console-alert console-alert-error">{error}</div>}
          <button className="console-brass-button" type="button" onClick={() => window.location.reload()}>
            Retry WalletConnect →
          </button>
        </section>
      </div>
    </main>
  );
}

function renderApp() {
  if (path === "/testnet/execute" && missionId && quoteId) return <WalletExecutionGate />;
  if (path === "/testnet/quote-gate" && missionId && quoteId) return <TestnetQuoteGate />;
  if (path === "/testnet/recover") return <TestnetRecovery />;
  if (path === "/testnet/jobs") return <TestnetJobHistory />;
  if (path === "/testnet/providers") return <TestnetProviderReadiness />;
  if (path === "/testnet/preflight") return <TestnetTransactionPreflight />;
  if (path === "/testnet/run") return <TestnetGridRun />;
  if (path === "/app") return <MarketplaceWorkspace />;
  return <TestnetSandbox />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{renderApp()}</React.StrictMode>,
);
