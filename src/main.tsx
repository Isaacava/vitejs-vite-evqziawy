import React from "react";
import ReactDOM from "react-dom/client";

import LandingPage from "./LandingPage";
import MarketplaceWorkspace from "./MarketplaceWorkspace";
import MissionConsole from "./MissionConsole";
import OnchainPrepare from "./OnchainPrepare";
import OnchainExecute from "./OnchainExecute";
import EvaluatorConsole from "./EvaluatorConsole";
import ProviderSubmit from "./ProviderSubmit";
import AgentRegistration from "./AgentRegistration";
import AgentInbox from "./AgentInbox";
import UserDashboard from "./UserDashboard";
import SessionPermissions from "./SessionPermissions";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const jobId = params.get("job");
const missionId = params.get("mission");
const appMode = window.location.pathname === "/app";
const dashboardMode = window.location.pathname === "/dashboard";
const permissionsMode = window.location.pathname === "/permissions";
const prepareMode = window.location.pathname === "/prepare";
const executeMode = window.location.pathname === "/prepare/execute";
const evaluatorMode = window.location.pathname === "/evaluator";
const providerSubmitMode = window.location.pathname === "/provider/submit";
const registerMode = window.location.pathname === "/agents/register";
const inboxMode = window.location.pathname === "/agent/inbox";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {executeMode && missionId ? (
      <OnchainExecute />
    ) : evaluatorMode && jobId ? (
      <EvaluatorConsole />
    ) : providerSubmitMode && jobId ? (
      <ProviderSubmit />
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
