import React from "react";
import ReactDOM from "react-dom/client";

import LandingPage from "./LandingPage";
import MarketplaceWorkspace from "./MarketplaceWorkspace";
import MissionConsole from "./MissionConsole";
import OnchainPrepare from "./OnchainPrepare";
import OnchainExecute from "./OnchainExecute";
import TestnetQuoteExecution from "./TestnetQuoteExecution";
import TestnetSandbox from "./TestnetSandbox";
import EvaluatorConsole from "./EvaluatorConsole";
import ProviderSubmit from "./ProviderSubmit";
import LifecycleActions from "./LifecycleActions";
import AgentRegistration from "./AgentRegistration";
import AgentInbox from "./AgentInbox";
import UserDashboard from "./UserDashboard";
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
      <UserDashboard />
    ) : permissionsMode ? (
      <SessionPermissions />
    ) : appMode ? (
      <MarketplaceWorkspace />
    ) : (
      <LandingPage />
    )}
  </React.StrictMode>
);
