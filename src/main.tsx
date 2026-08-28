import React from "react";
import ReactDOM from "react-dom/client";

import LandingEntry from "./LandingEntry";
import UserDashboard from "./UserDashboard";
import WorkspaceShell from "./WorkspaceShell";
import DiscoverPage from "./DiscoverPage";
import MarketplaceWorkspace from "./MarketplaceWorkspace";
import WorkspaceMissionConsole from "./WorkspaceMissionConsole";
import WorkspaceMissionPage from "./WorkspaceMissionPage";
import DemoManagePage from "./DemoManagePage";
import DemoActivityPage from "./DemoActivityPage";
import DemoPaymentsPage from "./DemoPaymentsPage";
import TestnetQuoteExecutionWalletConnect from "./TestnetQuoteExecutionWalletConnect";
import TestnetQuoteGate from "./TestnetQuoteGate";
import TestnetProviderSubmit from "./ProviderSubmit";
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

function renderWorkspace(element: React.ReactNode) {
  return <WorkspaceShell>{element}</WorkspaceShell>;
}

function renderApp() {
  if ((path === "/" || path === "/mission") && jobId) return renderWorkspace(<WorkspaceMissionConsole />);

  if (path === "/") return <LandingEntry />;
  if (path === "/dashboard") return renderWorkspace(<UserDashboard />);
  if (path === "/discover") return renderWorkspace(<DiscoverPage />);
  if (path === "/missions") return renderWorkspace(<WorkspaceMissionPage />);
  if (path === "/mission") return renderWorkspace(<WorkspaceMissionConsole />);
  if (path === "/activity") return renderWorkspace(<DemoActivityPage />);
  if (path === "/payments") return renderWorkspace(<DemoPaymentsPage />);
  if (path === "/app") return renderWorkspace(<MarketplaceWorkspace />);

  if (path === "/testnet") return renderWorkspace(<DemoManagePage kind="testnet" />);
  if (path === "/testnet/manage") return renderWorkspace(<DemoManagePage kind="testnet" />);
  if (path === "/agents/register") return renderWorkspace(<DemoManagePage kind="register" />);
  if (path === "/permissions") return renderWorkspace(<DemoManagePage kind="permissions" />);

  if (path === "/testnet/execute") return renderWorkspace(<TestnetQuoteExecutionWalletConnect />);
  if (path === "/testnet/provider-submit") return renderWorkspace(<TestnetProviderSubmit />);
  if (path === "/testnet/quote-gate" && missionId && quoteId) return renderWorkspace(<TestnetQuoteGate />);
  if (path === "/testnet/recover") return renderWorkspace(<TestnetRecovery />);
  if (path === "/testnet/jobs" || path === "/missions/history") return renderWorkspace(<TestnetJobHistory />);
  if (path === "/testnet/review") return renderWorkspace(<TestnetPolicyReview />);
  if (path === "/testnet/result") return renderWorkspace(<TestnetJobResult />);
  if (path === "/testnet/providers") return renderWorkspace(<TestnetProviderReadiness />);
  if (path === "/testnet/preflight") return renderWorkspace(<TestnetTransactionPreflight />);
  if (path === "/testnet/run") return renderWorkspace(<TestnetGridRun />);

  return renderWorkspace(<DemoManagePage kind="testnet" />);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{renderApp()}</React.StrictMode>,
);
