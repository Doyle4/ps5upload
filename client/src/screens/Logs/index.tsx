import { ScrollText, Terminal } from "lucide-react";
import { useSearchParams } from "react-router";

import { Tabs } from "../../components/Tabs";
import TabbedShell, { type TabbedShellTab } from "../../layout/TabbedShell";
import { useTr } from "../../state/lang";
import AppLogsPanel from "./AppLogsPanel";
import KernelLogPanel from "./KernelLogPanel";

/**
 * Logs screen — two URL-routed tabs:
 *
 *   - **app**: in-memory React/Tauri events. Persists for the session.
 *   - **kernel**: live /dev/klog stream from the helper. Polled.
 *
 * (Historically split across /logs and the old /kernel-log route;
 * merged under ?tab=kernel. Now the Logs tab of Activity & logs at
 * /tasks?tab=logs[&log=kernel]; legacy redirects remain for old bookmarks.)
 *
 * The shell (URL contract + tablist + a11y + keyboard nav + page
 * header) lives in `layout/TabbedShell`; this file is just tab
 * metadata and a panel switch.
 */

type TabId = "app" | "kernel";

/** The log on show when embedded in Activity & logs: `?log=`, or an old `?tab=kernel` link. */
export function embeddedLogTabOf(params: URLSearchParams): TabId {
  const raw = params.get("log") ?? params.get("tab");
  return raw === "kernel" ? "kernel" : "app";
}

/**
 * `embedded`: shown as the Logs tab of Activity & logs. `?tab=` is then the outer tab, so
 * the log moves to `?log=app|kernel`; the outer screen's header carries the description.
 */
export default function LogsScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const tr = useTr();
  const [params, setParams] = useSearchParams();
  if (embedded) {
    const active = embeddedLogTabOf(params);
    const setActive = (id: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (next.get("tab") === "kernel") next.set("tab", "logs");
          if (id === "app") next.delete("log");
          else next.set("log", id);
          return next;
        },
        { replace: true },
      );
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Tabs
          variant="segmented"
          size="sm"
          className="mb-4"
          ariaLabel={tr("logs", undefined, "Logs")}
          value={active}
          onChange={setActive}
          tabs={[
            { id: "app", icon: ScrollText, label: tr("logs_tab_app", undefined, "App") },
            { id: "kernel", icon: Terminal, label: tr("logs_tab_kernel", undefined, "Kernel") },
          ]}
        />
        {active === "kernel" ? <KernelLogPanel /> : <AppLogsPanel />}
      </div>
    );
  }
  const tabs: ReadonlyArray<TabbedShellTab<TabId>> = [
    {
      id: "app",
      icon: ScrollText,
      key: "logs_tab_app",
      fallback: "App",
      description: tr(
        "logs_description_app",
        undefined,
        "In-app log of errors, warnings, and notable events on the desktop side. Useful for bug reports — click Copy to grab a plain-text dump.",
      ),
    },
    {
      id: "kernel",
      icon: Terminal,
      key: "logs_tab_kernel",
      fallback: "Kernel",
      description: tr(
        "logs_description_kernel",
        undefined,
        "Live stream of /dev/klog from the payload. Open Filters to hide Sony's routine subsystem chatter while hunting a specific issue.",
      ),
    },
  ];

  return (
    <TabbedShell
      idPrefix="logs"
      titleIcon={null}
      titleKey="logs"
      titleFallback="Logs"
      tabs={tabs}
      renderPanel={(id) => (id === "kernel" ? <KernelLogPanel /> : <AppLogsPanel />)}
    />
  );
}
