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

function WorkspacePage({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}

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
    <WorkspacePage>
      <MarketplaceWorkspace />
    </WorkspacePage>
  );
}

function renderWorkspacePage(element: React.ReactNode) {
  return <WorkspacePage>{element}</WorkspacePage>;
}

function renderApp() {
  if (path === "/") return <LandingEntry />;
  if (path === "/dashboard") return <DashboardShell />;

  if (path === "/agents/register") return renderWorkspacePage(<AgentRegistration />);
  if (path === "/permissions") return renderWorkspacePage(<SessionPermissions />);

  if (path === "/testnet") return renderWorkspacePage(<TestnetSandbox />);
  if (path === "/testnet/execute") return renderWorkspacePage(<TestnetQuoteExecutionWalletConnect />);
  if (path === "/testnet/provider-submit") return renderWorkspacePage(<TestnetProviderSubmit />);
  if (path === "/testnet/quote-gate" && missionId && quoteId) return renderWorkspacePage(<TestnetQuoteGate />);
  if (path === "/testnet/recover") return renderWorkspacePage(<TestnetRecovery />);
  if (path === "/testnet/jobs" || path === "/missions") return renderWorkspacePage(<TestnetJobHistory />);
  if (path === "/testnet/review") return renderWorkspacePage(<TestnetPolicyReview />);
  if (path === "/testnet/result") return renderWorkspacePage(<TestnetJobResult />);
  if (path === "/testnet/providers") return renderWorkspacePage(<TestnetProviderReadiness />);
  if (path === "/testnet/preflight") return renderWorkspacePage(<TestnetTransactionPreflight />);
  if (path === "/testnet/run") return renderWorkspacePage(<TestnetGridRun />);
  if (path === "/app") return <TestnetExecutionHandoff />;
  return renderWorkspacePage(<TestnetSandbox />);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{renderApp()}</React.StrictMode>,
);
