import React from "react";
import ReactDOM from "react-dom/client";

import MarketplaceDashboardV4 from "./MarketplaceDashboardV4";
import MissionConsole from "./MissionConsole";
import "./index.css";

const jobId = new URLSearchParams(window.location.search).get("job");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {jobId ? <MissionConsole /> : <MarketplaceDashboardV4 />}
  </React.StrictMode>
);
