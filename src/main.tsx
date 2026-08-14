import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import Erc8183Test from "./Erc8183Test";
import ProviderTest from "./ProviderTest";
import SettlementTest from "./SettlementTest";

import "./index.css";

// Dev-only ERC-8183 test harnesses, reachable via ?dev=client|provider|settlement
// while we wire real escrow into App.tsx. Not part of the product nav.
const devMode = new URLSearchParams(window.location.search).get("dev");

function Root() {
  if (devMode === "client") return <Erc8183Test />;
  if (devMode === "provider") return <ProviderTest />;
  if (devMode === "settlement") return <SettlementTest />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
