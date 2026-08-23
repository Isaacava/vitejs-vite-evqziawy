import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";

import LandingEntry from "./LandingEntry";
import DashboardShell from "./DashboardShell";
import WorkspaceShell from "./WorkspaceShell";
import AgentRegistration from "./AgentRegistration";
import SessionPermissions from "./SessionPermissions";
import MarketplaceWorkspace from "./MarketplaceWorkspace";
import MissionConsole from "./MissionConsole";
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

  return <WorkspaceShell><MarketplaceWorkspace /></WorkspaceShell>;
}

function renderApp() {
  if (path === "/" && jobId) return <WorkspaceShell><MissionConsole /></WorkspaceShell>;
  if (path === "/") return <LandingEntry />;
  if (path === "/dashboard") return <WorkspaceShell><DashboardShell /></WorkspaceShell>;
  if (path === "/agents/register") return <WorkspaceShell><AgentRegistration /></WorkspaceShell>;
  if (path === "/permissions") return <WorkspaceShell><SessionPermissions /></WorkspaceShell>;

  if (path === "/testnet/execute") return <WorkspaceShell><TestnetQuoteExecutionWalletConnect /></WorkspaceShell>;
  if (path === "/testnet/provider-submit") return <WorkspaceShell><TestnetProviderSubmit /></WorkspaceShell>;
  if (path === "/testnet/quote-gate" && missionId && quoteId) return <WorkspaceShell><TestnetQuoteGate /></WorkspaceShell>;
  if (path === "/testnet/recover") return <WorkspaceShell><TestnetRecovery /></WorkspaceShell>;
  if (path === "/testnet/jobs" || path === "/missions") return <WorkspaceShell><TestnetJobHistory /></WorkspaceShell>;
  if (path === "/testnet/review") return <WorkspaceShell><TestnetPolicyReview /></WorkspaceShell>;
  if (path === "/testnet/result") return <WorkspaceShell><TestnetJobResult /></WorkspaceShell>;
  if (path === "/testnet/providers") return <WorkspaceShell><TestnetProviderReadiness /></WorkspaceShell>;
  if (path === "/testnet/preflight") return <WorkspaceShell><TestnetTransactionPreflight /></WorkspaceShell>;
  if (path === "/testnet/run") return <WorkspaceShell><TestnetGridRun /></WorkspaceShell>;
  if (path === "/app") return <TestnetExecutionHandoff />;
  return <TestnetSandbox />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode>{renderApp()}</React.StrictMode>);
