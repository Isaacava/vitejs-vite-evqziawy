import React from "react";
import ReactDOM from "react-dom/client";

import LandingPage from "./LandingPage";
import MarketplaceDashboardV4 from "./MarketplaceDashboardV4";
import MissionConsole from "./MissionConsole";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const jobId = params.get("job");
const appMode = window.location.pathname === "/app";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {jobId ? <MissionConsole /> : appMode ? <MarketplaceDashboardV4 /> : <LandingPage />}
  </React.StrictMode>
);
