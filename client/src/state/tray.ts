// Minimize / close to the system tray (#516; the menu bar on macOS). Desktop app only, off until
// turned on. Kept on this computer (not a shared setting: another computer may have no tray).
// The shell does the hiding (src-tauri/src/tray.rs); this holds the two switches and tells it.

import { create } from "zustand";

import { invoke } from "../lib/invokeLogged";
import { isMobile } from "../lib/platform";
import { safeGetItem, safeSetItem } from "../lib/safeStorage";
import { isTauriEnv } from "../lib/tauriEnv";

const KEY = "ps5upload.tray.v1";

export interface TrayPrefs {
  minimize: boolean;
  close: boolean;
}

export interface TrayLabels {
  show: string;
  quit: string;
  tooltip: string;
}

interface TrayState extends TrayPrefs {
  /** This computer can show a tray icon (Linux needs the AppIndicator library). null: not asked yet. */
  available: boolean | null;
  error: string | null;
  set: (prefs: Partial<TrayPrefs>, labels: TrayLabels) => Promise<void>;
  /** Tells the shell the saved switches (at start, and when the language changes the menu). */
  apply: (labels: TrayLabels) => Promise<void>;
}

/** Desktop app only: the browser and the phone apps have no tray. */
export function trayPossible(): boolean {
  return isTauriEnv() && !isMobile();
}

export function loadTrayPrefs(): TrayPrefs {
  try {
    const v = JSON.parse(safeGetItem(KEY) ?? "{}") as Partial<TrayPrefs>;
    return { minimize: v.minimize === true, close: v.close === true };
  } catch {
    return { minimize: false, close: false };
  }
}

export const useTrayStore = create<TrayState>((set, get) => {
  async function tell(labels: TrayLabels) {
    if (!trayPossible()) return;
    const { minimize, close } = get();
    try {
      const r = await invoke<{ available: boolean; active: boolean }>("tray_configure", {
        minimize,
        close,
        labels,
      });
      set({ available: r.available, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  return {
    ...loadTrayPrefs(),
    available: null,
    error: null,
    async set(prefs, labels) {
      const next = { minimize: get().minimize, close: get().close, ...prefs };
      safeSetItem(KEY, JSON.stringify(next));
      set(next);
      await tell(labels);
    },
    apply: tell,
  };
});
