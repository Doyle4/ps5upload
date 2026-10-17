import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "virtual:pc-tokens.css";
import "./console.css";
import { App } from "./App";
import { installBackHistory } from "./backHistory";
import { installFullscreen } from "./fullscreen";
import { DEFAULT_INPUT_MAP, dispatchNav, installNavigation } from "./nav";
import { applyStoredTheme } from "./theme";
import { getLanguage, onLanguageChange, setLanguage, stringsVersion } from "./strings";

applyStoredTheme(); // before the first paint: no flash of the wrong theme
// English is in the page; the detected (or stored) language loads from the helper and the page
// re-renders in it when it arrives (<html lang/dir> follow).
setLanguage(getLanguage());
installNavigation(DEFAULT_INPUT_MAP);
// Full screen on the first press while the Settings switch is on (the default).
installFullscreen();
// The browser's Back (the PS5's ○) steps back inside the page: see backHistory.ts.
installBackHistory(() => dispatchNav("back"));

/** Re-renders the whole page when its strings change (a language loaded or chosen in Settings). */
function Root() {
  // An external store, so a load that lands before the first commit is not missed.
  useSyncExternalStore(onLanguageChange, stringsVersion);
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
