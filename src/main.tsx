import React, {
  useState,
} from "react";

import ReactDOM from "react-dom/client";

import Erc8183Test from "./Erc8183Test";
import ProviderTest from "./ProviderTest";
import SettlementTest from "./SettlementTest";

import "./index.css";

type AppMode =
  | "client"
  | "provider"
  | "settlement";

function App() {
  const [
    mode,
    setMode,
  ] = useState<AppMode>(
    "client"
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
            12,

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
        }}
      >
        <button
          onClick={() =>
            setMode(
              "client"
            )
          }
          style={{
            flex: 1,

            padding:
              "10px 8px",

            borderRadius:
              8,

            border:
              "1px solid #34383a",

            background:
              mode ===
              "client"
                ? "#f0b90b"
                : "#1b1e20",

            color:
              mode ===
              "client"
                ? "#111"
                : "#fff",

            fontWeight:
              800,
          }}
        >
          Client
        </button>

        <button
          onClick={() =>
            setMode(
              "provider"
            )
          }
          style={{
            flex: 1,

            padding:
              "10px 8px",

            borderRadius:
              8,

            border:
              "1px solid #34383a",

            background:
              mode ===
              "provider"
                ? "#f0b90b"
                : "#1b1e20",

            color:
              mode ===
              "provider"
                ? "#111"
                : "#fff",

            fontWeight:
              800,
          }}
        >
          Provider
        </button>

        <button
          onClick={() =>
            setMode(
              "settlement"
            )
          }
          style={{
            flex: 1,

            padding:
              "10px 8px",

            borderRadius:
              8,

            border:
              "1px solid #34383a",

            background:
              mode ===
              "settlement"
                ? "#f0b90b"
                : "#1b1e20",

            color:
              mode ===
              "settlement"
                ? "#111"
                : "#fff",

            fontWeight:
              800,
          }}
        >
          Settlement
        </button>
      </div>

      {mode ===
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

ReactDOM.createRoot(
  document.getElementById(
    "root"
  )!
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
