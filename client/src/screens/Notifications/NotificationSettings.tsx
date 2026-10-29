import { useState } from "react";
import { Bell } from "lucide-react";

import { Toggle } from "../../components";
import { useTr } from "../../state/lang";
import {
  getNotifPruneDays,
  setNotifPruneDays,
  useNotificationsStore,
} from "../../state/notifications";
import { isTauriEnv } from "../../lib/tauriEnv";
import { isMobile } from "../../lib/platform";
import { settingsVisibility } from "../Settings/visibility";

/**
 * The notification settings: mirroring to the system's notification center
 * and how long notifications are kept. One component, shown both in Settings
 * and on the Settings tab of the Notifications screen.
 */
export function NotificationSettingsPanel() {
  const tr = useTr();
  const osNotifyEnabled = useNotificationsStore((s) => s.osNotifyEnabled);
  const setOsNotifyEnabled = useNotificationsStore((s) => s.setOsNotifyEnabled);
  // UA-based, stable for the whole session.
  const show = settingsVisibility({ tauri: isTauriEnv(), mobile: isMobile() });
  return (
    <>
      {show.osNotifications && (
        <>
          <Toggle
            checked={osNotifyEnabled}
            onChange={(checked) => setOsNotifyEnabled(checked)}
            label={
              <span className="inline-flex items-center gap-2 font-medium">
                <Bell size={14} />
                {tr("os_notify_label", undefined, "Show system notifications")}
              </span>
            }
            hint={tr(
              "os_notify_hint",
              undefined,
              "Mirror in-app notifications (transfer done, errors, etc.) to your operating system's notification center — but only when the app is in the background, so you're not notified twice. You may be asked to grant notification permission.",
            )}
          />
          <div className="my-3 border-t border-[var(--color-border)]" />
        </>
      )}
      <NotifPrunePanel />
    </>
  );
}

/** How long notifications are kept. Default 30 days; 0 disables auto-prune.
 *  Pruning runs at app start + every 6h (wired in AppShell). A change takes
 *  effect on the next tick — instant pruning isn't worth the surprise of
 *  "I changed it to 1 day and lost everything." */
function NotifPrunePanel() {
  const tr = useTr();
  const [days, setDays] = useState<number>(() => getNotifPruneDays());

  function pickDays(d: number) {
    setNotifPruneDays(d);
    setDays(d);
  }

  const options: Array<{ days: number; labelKey: string; labelFallback: string }> = [
    { days: 7, labelKey: "settings_retention_7", labelFallback: "7 days" },
    { days: 30, labelKey: "settings_retention_30", labelFallback: "30 days" },
    { days: 90, labelKey: "settings_retention_90", labelFallback: "90 days" },
    { days: 0, labelKey: "settings_retention_never", labelFallback: "Never (keep all)" },
  ];

  return (
    <div className="space-y-2 text-sm">
      <div className="text-xs text-[var(--color-muted)]">
        {tr(
          "notif_prune_hint",
          undefined,
          "Notifications older than this are auto-deleted. Runs at startup and every 6 hours.",
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.days}
            type="button"
            onClick={() => pickDays(o.days)}
            aria-pressed={days === o.days}
            className="chip min-h-8 px-3.5 text-xs max-md:min-h-11 max-md:px-4"
          >
            {tr(o.labelKey, o.labelFallback)}
          </button>
        ))}
      </div>
    </div>
  );
}
