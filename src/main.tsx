import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";

import MarketplaceWorkspace from "./MarketplaceWorkspace";
import TestnetQuoteExecutionWalletConnect from "./TestnetQuoteExecutionWalletConnect";
import TestnetQuoteGate from "./TestnetQuoteGate";
import TestnetSandbox from "./TestnetSandbox";
import TestnetRecovery from "./TestnetRecovery";
import TestnetJobHistory from "./TestnetJobHistory";
import TestnetProviderReadiness from "./TestnetProviderReadiness";
import TestnetTransactionPreflight from "./TestnetTransactionPreflight";
import TestnetGridRun from "./TestnetGridRun";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const missionId = params.get("mission");
const quoteId = params.get("quote");
const path = window.location.pathname;

function TestnetExecutionHandoff() {
  useEffect(() => {
    if (path !== "/app") return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (!button) return;
      if (!button.textContent?.toLowerCase().includes("build erc-8183 testnet plan")) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign("/testnet/execute");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return <MarketplaceWorkspace />;
}

function renderApp() {
  if (path === "/testnet/execute") return <TestnetQuoteExecutionWalletConnect />;
  if (path === "/testnet/quote-gate" && missionId && quoteId) return <TestnetQuoteGate />;
  if (path === "/testnet/recover") return <TestnetRecovery />;
  if (path === "/testnet/jobs") return <TestnetJobHistory />;
  if (path === "/testnet/providers") return <TestnetProviderReadiness />;
  if (path === "/testnet/preflight") return <TestnetTransactionPreflight />;
  if (path === "/testnet/run") return <TestnetGridRun />;
  if (path === "/app") return <TestnetExecutionHandoff />;
  return <TestnetSandbox />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{renderApp()}</React.StrictMode>,
);
