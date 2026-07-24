import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import EverestObservatory from "./app/EverestObservatory";
import "./app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("The observatory root element is missing.");

createRoot(root).render(
  <StrictMode>
    <EverestObservatory />
  </StrictMode>,
);
