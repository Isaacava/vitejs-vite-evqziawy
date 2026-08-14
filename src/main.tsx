import React from "react";
import ReactDOM from "react-dom/client";

import LandingPage from "./LandingPage";
import MarketplaceWorkspace from "./MarketplaceWorkspace";
import MissionConsole from "./MissionConsole";
import OnchainPrepare from "./OnchainPrepare";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const jobId = params.get("job");
const missionId = params.get("mission");
const appMode = window.location.pathname === "/app";
const prepareMode = window.location.pathname === "/prepare";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {jobId ? <MissionConsole /> : prepareMode && missionId ? <OnchainPrepare /> : appMode ? <MarketplaceWorkspace /> : <LandingPage />}
  </React.StrictMode>
);
