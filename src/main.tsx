import React from "react";
import ReactDOM from "react-dom/client";

import LandingPage from "./LandingPage";
import MarketplaceWorkspace from "./MarketplaceWorkspace";
import MissionConsole from "./MissionConsole";
import OnChainMissionPreparation from "./OnChainMissionPreparation";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const jobId = params.get("job");
const missionId = params.get("mission");
const appMode = window.location.pathname === "/app";
const prepareMode = window.location.pathname === "/prepare";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {prepareMode && missionId ? (
      <OnChainMissionPreparation />
    ) : jobId ? (
      <MissionConsole />
    ) : appMode ? (
      <MarketplaceWorkspace />
    ) : (
      <LandingPage />
    )}
  </React.StrictMode>
);
