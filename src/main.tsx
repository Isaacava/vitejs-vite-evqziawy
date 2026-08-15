import React from "react";
import ReactDOM from "react-dom/client";

import LandingEntry from "./LandingEntry";
import MarketplaceWorkspace from "./MarketplaceWorkspace";
import MissionConsole from "./MissionConsole";
import OnchainPrepare from "./OnchainPrepare";
import OnchainExecute from "./OnchainExecute";
import TestnetQuoteExecution from "./TestnetQuoteExecution";
import TestnetQuoteGate from "./TestnetQuoteGate";
import TestnetSandbox from "./TestnetSandbox";
import TestnetRecovery from "./TestnetRecovery";
import TestnetJobHistory from "./TestnetJobHistory";
import TestnetProviderReadiness from "./TestnetProviderReadiness";
import TestnetTransactionPreflight from "./TestnetTransactionPreflight";
import TestnetGridRun from "./TestnetGridRun";
import EvaluatorConsole from "./EvaluatorConsole";
import ProviderSubmit from "./ProviderSubmit";
import LifecycleActions from "./LifecycleActions";
import AgentRegistration from "./AgentRegistration";
import AgentInbox from "./AgentInbox";
import DashboardShell from "./DashboardShell";
import SessionPermissions from "./SessionPermissions";
import AgentEvidence from "./AgentEvidence";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const jobId = params.get("job");
const missionId = params.get("mission");
const quoteId = params.get("quote");
const appMode = window.location.pathname === "/app";
const dashboardMode = window.location.pathname === "/dashboard";
const permissionsMode = window.location.pathname === "/permissions";
const evidenceMode = window.location.pathname === "/agent/evidence";
const prepareMode = window.location.pathname === "/prepare";
const testnetMode = window.location.pathname === "/testnet";
const testnetQuoteExecuteMode = window.location.pathname === "/testnet/execute";
const testnetQuoteGateMode = window.location.pathname === "/testnet/quote-gate";
const testnetRecoveryMode = window.location.pathname === "/testnet/recover";
const testnetHistoryMode = window.location.pathname === "/testnet/jobs";
const testnetProvidersMode = window.location.pathname === "/testnet/providers";
const testnetPreflightMode = window.location.pathname === "/testnet/preflight";
const testnetGridRunMode = window.location.pathname === "/testnet/run";
const executeMode = window.location.pathname === "/prepare/execute";
const evaluatorMode = window.location.pathname === "/evaluator";
const providerSubmitMode = window.location.pathname === "/provider/submit";
const lifecycleMode = window.location.pathname === "/lifecycle";
const registerMode = window.location.pathname === "/agents/register";
const inboxMode = window.location.pathname === "/agent/inbox";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {testnetQuoteExecuteMode && missionId && quoteId ? (
      <TestnetQuoteExecution />
    ) : testnetQuoteGateMode && missionId && quoteId ? (
      <TestnetQuoteGate />
    ) : testnetRecoveryMode ? (
      <TestnetRecovery />
    ) : testnetHistoryMode ? (
      <TestnetJobHistory />
    ) : testnetProvidersMode ? (
      <TestnetProviderReadiness />
    ) : testnetPreflightMode ? (
      <TestnetTransactionPreflight />
    ) : testnetGridRunMode ? (
      <TestnetGridRun />
    ) : testnetMode ? (
      <TestnetSandbox />
    ) : executeMode && missionId ? (
      <OnchainExecute />
    ) : evaluatorMode && jobId ? (
      <EvaluatorConsole />
    ) : providerSubmitMode && jobId ? (
      <ProviderSubmit />
    ) : lifecycleMode && jobId ? (
      <LifecycleActions />
    ) : evidenceMode ? (
      <AgentEvidence />
    ) : jobId ? (
      <MissionConsole />
    ) : prepareMode && missionId ? (
      <OnchainPrepare />
    ) : registerMode ? (
      <AgentRegistration />
    ) : inboxMode ? (
      <AgentInbox />
    ) : dashboardMode ? (
      <DashboardShell />
    ) : permissionsMode ? (
      <SessionPermissions />
    ) : appMode ? (
      <MarketplaceWorkspace />
    ) : (
      <LandingEntry />
    )}
  </React.StrictMode>
);
