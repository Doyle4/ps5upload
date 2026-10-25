/**
 * Entry point. In the self-hosted web UI the settings every browser shares are read from the
 * engine first (lib/sharedPrefs), so each store reads them as its own when the app loads; then
 * the app starts (appMain). The desktop and mobile apps start at once.
 */
import { isTauriEnv } from "./lib/tauriEnv";
import { preloadSharedPrefs } from "./lib/sharedPrefs";

const ready = isTauriEnv() ? Promise.resolve() : preloadSharedPrefs();
void ready.then(() => import("./appMain"));
