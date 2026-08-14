import React from "react";
import ReactDOM from "react-dom/client";

import MarketplaceDashboardV4 from "./MarketplaceDashboardV4";
import Erc8183Test from "./Erc8183Test";
import ProviderTest from "./ProviderTest";
import SettlementTest from "./SettlementTest";

import "./index.css";

const devMode = new URLSearchParams(window.location.search).get("dev");

function Root() {
  if (devMode === "client") return <Erc8183Test />;
  if (devMode === "provider") return <ProviderTest />;
  if (devMode === "settlement") return <SettlementTest />;
  return <MarketplaceDashboardV4 />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
