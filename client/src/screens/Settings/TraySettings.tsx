// Settings › Window: minimize / close to the system tray (#516). Desktop app only.

import { useEffect } from "react";

import { Toggle } from "../../components/Toggle";
import { isMacOrLinuxDesktop, isWindows } from "../../lib/platform";
import { useTr } from "../../state/lang";
import { trayPossible, useTrayStore, type TrayLabels } from "../../state/tray";

/** The tray menu's words, in the app's language. */
export function useTrayLabels(): TrayLabels {
  const tr = useTr();
  return {
    show: tr("tray_show", undefined, "Show PS5Upload"),
    quit: tr("tray_quit", undefined, "Quit PS5Upload"),
    tooltip: "PS5Upload",
  };
}

/** Tells the shell the saved switches at start and whenever the language changes (AppShell). */
export function useTrayApply() {
  // Keyed on the words themselves: a language's strings arrive a moment after it is chosen.
  const { show, quit, tooltip } = useTrayLabels();
  useEffect(() => {
    if (trayPossible()) void useTrayStore.getState().apply({ show, quit, tooltip });
  }, [show, quit, tooltip]);
}

const isMac = () => isMacOrLinuxDesktop() && /Mac/.test(navigator.userAgent) && !isWindows();

export function TraySettings() {
  const tr = useTr();
  const labels = useTrayLabels();
  const { minimize, close, available, error, set } = useTrayStore();
  if (!trayPossible()) return null;
  const mac = isMac();
  return (
    <div className="space-y-3">
      <Toggle
        checked={close}
        disabled={available === false}
        onChange={(checked) => void set({ close: checked }, labels)}
        label={
          mac
            ? tr("tray_close_mac", undefined, "Keep running in the menu bar when the window is closed")
            : tr("tray_close", undefined, "Close to the system tray")
        }
        hint={
          mac
            ? tr(
                "tray_close_mac_hint",
                undefined,
                "Closing the window hides it and its Dock icon; transfers and Mesh Drive keep going. Click the menu bar icon and choose Show to bring it back, or Quit to stop the app.",
              )
            : tr(
                "tray_close_hint",
                undefined,
                "Closing the window hides it to the tray; transfers and Mesh Drive keep going. Click the tray icon to bring it back; right-click it to quit.",
              )
        }
      />
      {!mac && (
        <Toggle
          checked={minimize}
          disabled={available === false}
          onChange={(checked) => void set({ minimize: checked }, labels)}
          label={tr("tray_minimize", undefined, "Minimize to the system tray")}
          hint={tr(
            "tray_minimize_hint",
            undefined,
            "Minimizing hides the window to the tray instead of the taskbar.",
          )}
        />
      )}
      {available === false && (
        <p className="text-xs text-[var(--color-warn)]">
          {tr(
            "tray_unavailable",
            undefined,
            "This desktop has no tray support (on Linux, install libayatana-appindicator3). The window closes and minimizes as usual.",
          )}
        </p>
      )}
      {error && <p className="text-xs text-[var(--color-bad)]">{error}</p>}
    </div>
  );
}
