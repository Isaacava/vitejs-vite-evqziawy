import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";

import LandingEntry from "./LandingEntry";
import DashboardShell from "./DashboardShell";
import AgentRegistration from "./AgentRegistration";
import SessionPermissions from "./SessionPermissions";
import MarketplaceWorkspace from "./MarketplaceWorkspace";
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
    <div style={{ minHeight: "100vh", position: "relative" }}>
      <MarketplaceWorkspace />
      <a
        href="/missions"
        aria-label="Open Testnet mission history"
        style={{
          position: "fixed",
          right: 18,
          top: 18,
          zIndex: 1000,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 14px",
          borderRadius: 999,
          background: "#15181b",
          border: "1px solid #343a40",
          color: "#f0b90b",
          textDecoration: "none",
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "0.03em",
          boxShadow: "0 10px 28px rgba(0,0,0,.3)",
        }}
      >
        Missions →
      </a>
    </div>
  );
}

function renderApp() {
  // Public entry point: the polished AgentMarket landing page owns wallet
  // connection/sign-in and redirects to /dashboard after authentication.
  if (path === "/") return <LandingEntry />;

  // Authenticated workspace shell. UserDashboard performs the authenticated
  // data load; the shell supplies the single workspace navigation/UX.
  if (path === "/dashboard") return <DashboardShell />;

  // These routes already have real screens/components. They should not fall
  // through to the Testnet sandbox when opened directly from the workspace nav.
  if (path === "/agents/register") return <AgentRegistration />;
  if (path === "/permissions") return <SessionPermissions />;

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
