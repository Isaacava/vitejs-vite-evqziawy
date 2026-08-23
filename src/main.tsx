import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import LandingEntry from "./LandingEntry";
import DashboardShell from "./DashboardShell";
import WorkspaceShell from "./WorkspaceShell";
import AgentRegistration from "./AgentRegistration";
import SessionPermissions from "./SessionPermissions";
import DiscoverPage from "./DiscoverPage";
import MarketplaceWorkspace from "./MarketplaceWorkspace";
import WorkspaceMissionConsole from "./WorkspaceMissionConsole";
import WorkspaceMissionPage from "./WorkspaceMissionPage";
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
const jobId = params.get("job");
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

function renderWorkspace(element: React.ReactNode) {
  return <WorkspaceShell>{element}</WorkspaceShell>;
}

function renderApp() {
  if ((path === "/" || path === "/mission") && jobId) {
    return renderWorkspace(<WorkspaceMissionConsole />);
  }

  if (path === "/") return <LandingEntry />;
  if (path === "/dashboard") return <DashboardShell />;
  if (path === "/discover") return renderWorkspace(<DiscoverPage />);
  if (path === "/missions") return renderWorkspace(<WorkspaceMissionPage />);
  if (path === "/mission") return renderWorkspace(<WorkspaceMissionConsole />);
  if (path === "/agents/register") return renderWorkspace(<AgentRegistration />);
  if (path === "/permissions") return renderWorkspace(<SessionPermissions />);

  if (path === "/testnet") return renderWorkspace(<TestnetSandbox />);
  if (path === "/testnet/execute") return renderWorkspace(<TestnetQuoteExecutionWalletConnect />);
  if (path === "/testnet/provider-submit") return renderWorkspace(<TestnetProviderSubmit />);
  if (path === "/testnet/quote-gate" && missionId && quoteId) return renderWorkspace(<TestnetQuoteGate />);
  if (path === "/testnet/recover") return renderWorkspace(<TestnetRecovery />);
  if (path === "/testnet/jobs") return renderWorkspace(<TestnetJobHistory />);
  if (path === "/testnet/review") return renderWorkspace(<TestnetPolicyReview />);
  if (path === "/testnet/result") return renderWorkspace(<TestnetJobResult />);
  if (path === "/testnet/providers") return renderWorkspace(<TestnetProviderReadiness />);
  if (path === "/testnet/preflight") return renderWorkspace(<TestnetTransactionPreflight />);
  if (path === "/testnet/run") return renderWorkspace(<TestnetGridRun />);
  if (path === "/app") return <TestnetExecutionHandoff />;

  return renderWorkspace(<TestnetSandbox />);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{renderApp()}</React.StrictMode>,
);
