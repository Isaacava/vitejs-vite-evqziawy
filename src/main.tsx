import {
  StrictMode,
  useState,
} from "react";

import {
  createRoot,
} from "react-dom/client";

import "./index.css";

import Erc8183Test from "./Erc8183Test";
import ProviderTest from "./ProviderTest";

function App() {
  const [
    mode,
    setMode,
  ] = useState<
    "client" | "provider"
  >("client");

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: 12,
          background: "#0b0d0e",
          borderBottom:
            "1px solid #2c3032",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <button
          onClick={() =>
            setMode("client")
          }
          style={{
            flex: 1,
            padding:
              "10px 14px",
            borderRadius: 8,
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
            fontWeight: 800,
          }}
        >
          Client / Marketplace
        </button>

        <button
          onClick={() =>
            setMode("provider")
          }
          style={{
            flex: 1,
            padding:
              "10px 14px",
            borderRadius: 8,
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
            fontWeight: 800,
          }}
        >
          Provider / Agent
        </button>
      </div>

      {mode ===
      "client" ? (
        <Erc8183Test />
      ) : (
        <ProviderTest />
      )}
    </div>
  );
}

createRoot(
  document.getElementById(
    "root"
  )!
).render(
  <StrictMode>
    <App />
  </StrictMode>
);
