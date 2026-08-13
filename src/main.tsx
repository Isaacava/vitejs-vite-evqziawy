import React, {
  useState,
} from "react";

import ReactDOM from "react-dom/client";

import Erc8183Test from "./Erc8183Test";
import MissionPlanner from "./MissionPlanner";
import MissionWorkspace from "./MissionWorkspace";
import AgentRegistry from "./AgentRegistry";
import MissionSubJob from "./MissionSubJob";
import ProviderTest from "./ProviderTest";
import SettlementTest from "./SettlementTest";

import "./index.css";

type AppMode =
  | "marketplace"
  | "workspace"
  | "agents"
  | "subjob"
  | "client"
  | "provider"
  | "settlement";

function App() {
  const [
    mode,
    setMode,
  ] = useState<AppMode>(
    "marketplace"
  );

  return (
    <div>
      <div
        style={{
          display:
            "flex",

          gap:
            8,

          padding:
            10,

          background:
            "#0b0d0e",

          borderBottom:
            "1px solid #2c3032",

          position:
            "sticky",

          top:
            0,

          zIndex:
            100,

          overflowX:
            "auto",
        }}
      >
        <NavButton
          active={
            mode ===
            "marketplace"
          }
          onClick={() =>
            setMode(
              "marketplace"
            )
          }
        >
          🏪 Marketplace
        </NavButton>

        <NavButton
          active={
            mode ===
            "workspace"
          }
          onClick={() =>
            setMode(
              "workspace"
            )
          }
        >
          🧭 Workspace
        </NavButton>

        <NavButton
          active={
            mode ===
            "agents"
          }
          onClick={() =>
            setMode(
              "agents"
            )
          }
        >
          🤖 Agents
        </NavButton>

        <NavButton
          active={
            mode ===
            "subjob"
          }
          onClick={() =>
            setMode(
              "subjob"
            )
          }
        >
          ⛓️ Sub-job
        </NavButton>

        <NavButton
          active={
            mode ===
            "client"
          }
          onClick={() =>
            setMode(
              "client"
            )
          }
        >
          Client
        </NavButton>

        <NavButton
          active={
            mode ===
            "provider"
          }
          onClick={() =>
            setMode(
              "provider"
            )
          }
        >
          Provider
        </NavButton>

        <NavButton
          active={
            mode ===
            "settlement"
          }
          onClick={() =>
            setMode(
              "settlement"
            )
          }
        >
          Settlement
        </NavButton>
      </div>

      {mode ===
      "marketplace" ? (
        <MissionPlanner />
      ) : mode ===
        "workspace" ? (
        <MissionWorkspace />
      ) : mode ===
        "agents" ? (
        <AgentRegistry />
      ) : mode ===
        "subjob" ? (
        <MissionSubJob />
      ) : mode ===
        "client" ? (
        <Erc8183Test />
      ) : mode ===
        "provider" ? (
        <ProviderTest />
      ) : (
        <SettlementTest />
      )}
    </div>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={
        onClick
      }
      style={{
        flex:
          "0 0 auto",

        padding:
          "10px 13px",

        borderRadius:
          9,

        border:
          "1px solid #34383a",

        background:
          active
            ? "#f0b90b"
            : "#1b1e20",

        color:
          active
            ? "#111"
            : "#fff",

        fontWeight:
          800,

        whiteSpace:
          "nowrap",

        cursor:
          "pointer",
      }}
    >
      {
        children
      }
    </button>
  );
}

ReactDOM.createRoot(
  document.getElementById(
    "root"
  )!
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
