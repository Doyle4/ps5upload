import { Activity as ActivityIcon, ScrollText, ShieldCheck } from "lucide-react";
import { useSearchParams } from "react-router";

import TabbedShell, { type TabbedShellTab } from "../../layout/TabbedShell";
import { useTr } from "../../state/lang";
import ActivityScreen from "../Activity";
import AuditLogScreen from "../AuditLog";
import LogsScreen, { embeddedLogTabOf } from "../Logs";

type TabId = "tasks" | "logs" | "audit";

/**
 * Activity & logs (/tasks): what the app is doing and has done, in one place, as three tabs
 * (`?tab=tasks|logs|audit`). Each tab is the old screen's body, unchanged; this header
 * replaces theirs. The bodies keep their own views under other names (`?view=` for Tasks,
 * `?log=` for Logs), and the old `?tab=history|stats` and `?tab=kernel` links still land.
 */
export default function ActivityLogsScreen() {
  const tr = useTr();
  const [params] = useSearchParams();
  const tabs: ReadonlyArray<TabbedShellTab<TabId>> = [
    {
      id: "tasks",
      icon: ActivityIcon,
      key: "v5_tab_tasks",
      fallback: "Tasks",
      description: tr(
        "activity_description_v2",
        undefined,
        "Everything the app is doing and has done on your consoles: uploads, downloads, installs and file operations. Stop or retry one from here. The last 100 are kept, also after a restart.",
      ),
    },
    {
      id: "logs",
      icon: ScrollText,
      key: "logs",
      fallback: "Logs",
      description:
        embeddedLogTabOf(params) === "kernel"
          ? tr(
              "logs_description_kernel",
              undefined,
              "Live stream of /dev/klog from the payload. Open Filters to hide Sony's routine subsystem chatter while hunting a specific issue.",
            )
          : tr(
              "logs_description_app",
              undefined,
              "In-app log of errors, warnings, and notable events on the desktop side. Useful for bug reports — click Copy to grab a plain-text dump.",
            ),
    },
    {
      id: "audit",
      icon: ShieldCheck,
      key: "audit_log_title",
      fallback: "Audit log",
      description: tr(
        "audit_log_description_v3",
        undefined,
        "A record, kept in this app on this computer, of power actions, deletes, unregisters, uninstalls and installs. The newest 256 are kept and older ones roll off; there is no clear button, but clearing the app's data or browser storage erases it. The last 100 are shown.",
      ),
    },
  ];

  return (
    <TabbedShell
      idPrefix="activity-logs"
      titleIcon={ActivityIcon}
      titleKey="activity_logs_title"
      titleFallback="Activity & logs"
      tabs={tabs}
      // An old Logs link (`?tab=kernel`) opens Logs; anything else unknown opens Tasks.
      defaultTab={params.get("tab") === "kernel" ? "logs" : "tasks"}
      renderPanel={(id) =>
        id === "logs" ? (
          <LogsScreen embedded />
        ) : id === "audit" ? (
          <AuditLogScreen embedded />
        ) : (
          <ActivityScreen embedded />
        )
      }
    />
  );
}
