import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";

import LandingEntry from "./LandingEntry";
import DashboardShell from "./DashboardShell";
import AgentRegistration from "./AgentRegistration";
import SessionPermissions from "./SessionPermissions";
import MarketplaceWorkspace from "./MarketplaceWorkspace";
import WorkspaceShell from "./WorkspaceShell";
import TestnetQuoteExecutionWalletConnect from "./TestnetQuoteExecutionWalletConnect";
import TestnetQuoteGate from "./TestnetQuoteGate";
import TestnetProviderSubmit from "./ProviderSubmit";
import TestnetSandbox from "./TestnetSandbox";
import TestnetRecovery from "./TestnetRecovery";
import TestnetJobHistory from "./TestnetJobHistory";
import TestnetProviderReadiness from "./TestnetProviderReadiness";
import TestnetTransactionPreflight from "./TestnetTransactionPreflight";
import TestnetGridRun from "./TestnetGridRun";
import TestnetPolicyReview from "./TestnetPolicyReview";
import TestnetJobResult from "./TestnetJobResult";
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

  return (
    <WorkspaceShell>
      <MarketplaceWorkspace />
    </WorkspaceShell>
  );
}

function renderApp() {
  if (path === "/") return <LandingEntry />;
  if (path === "/dashboard") return <DashboardShell />;

  if (path === "/agents/register") {
    return (
      <WorkspaceShell>
        <AgentRegistration />
      </WorkspaceShell>
    );
  }

  if (path === "/permissions") {
    return (
      <WorkspaceShell>
        <SessionPermissions />
      </WorkspaceShell>
    );
  }

  if (path === "/testnet") return <TestnetSandbox />;
  if (path === "/testnet/execute") return <TestnetQuoteExecutionWalletConnect />;
  if (path === "/testnet/provider-submit") return <TestnetProviderSubmit />;
  if (path === "/testnet/quote-gate" && missionId && quoteId) return <TestnetQuoteGate />;
  if (path === "/testnet/recover") return <TestnetRecovery />;
  if (path === "/testnet/jobs" || path === "/missions") return <TestnetJobHistory />;
  if (path === "/testnet/review") return <TestnetPolicyReview />;
  if (path === "/testnet/result") return <TestnetJobResult />;
  if (path === "/testnet/providers") return <TestnetProviderReadiness />;
  if (path === "/testnet/preflight") return <TestnetTransactionPreflight />;
  if (path === "/testnet/run") return <TestnetGridRun />;
  if (path === "/app") return <TestnetExecutionHandoff />;
  return <TestnetSandbox />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{renderApp()}</React.StrictMode>,
);
