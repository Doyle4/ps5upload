import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "virtual:pc-tokens.css";
import "./console.css";
import { App } from "./App";
import { DEFAULT_INPUT_MAP, installNavigation } from "./nav";
import { getLanguage, setLanguage } from "./strings";

setLanguage(getLanguage()); // sets <html lang/dir> for the detected language
installNavigation(DEFAULT_INPUT_MAP);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App inputMap={DEFAULT_INPUT_MAP} />
    </StrictMode>,
  );
}
