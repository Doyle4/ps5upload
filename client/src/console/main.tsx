import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "virtual:pc-tokens.css";
import "./console.css";
import { App } from "./App";
import { installBackHistory } from "./backHistory";
import { DEFAULT_INPUT_MAP, dispatchNav, installNavigation } from "./nav";
import { getLanguage, onLanguageChange, setLanguage } from "./strings";

setLanguage(getLanguage()); // sets <html lang/dir> for the detected language
installNavigation(DEFAULT_INPUT_MAP);
// The browser's Back (the PS5's ○) steps back inside the page: see backHistory.ts.
installBackHistory(() => dispatchNav("back"));

/** Re-renders the whole page when Settings changes the language. */
function Root() {
  const [, setTick] = useState(0);
  useEffect(() => onLanguageChange(() => setTick((n) => n + 1)), []);
  return <App inputMap={DEFAULT_INPUT_MAP} />;
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}
