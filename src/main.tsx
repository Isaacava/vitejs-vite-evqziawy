import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Erc8183Test from "./Erc8183Test";

createRoot(
  document.getElementById("root")!
).render(
  <StrictMode>
    <Erc8183Test />
  </StrictMode>
);
