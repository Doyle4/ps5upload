import { useState, type ReactNode } from "react";
import { Activity, Eraser, Fan as FanIcon } from "lucide-react";

import { Cleanup } from "../cleanup/Cleanup";
import { Fan } from "../fan/Fan";
import { Processes } from "../processes/Processes";
import type { SectionContext } from "../sections";
import { t } from "../strings";

export type SystemView = "fan" | "processes" | "cleanup";

/** The view a System opening asks for (`view=`), else Fan. */
export function systemViewOf(params: Record<string, string> | null): SystemView {
  return params?.view === "processes" || params?.view === "cleanup" ? params.view : "fan";
}

/**
 * System: the console's own upkeep, one Rail entry with a switch under the title, like Games:
 * the fan, what is running, and clean up. They were three Rail entries; each view is kept as
 * it was, one press apart.
 */
export function SystemSection({ ctx }: { ctx: SectionContext }) {
  const [view, setView] = useState<SystemView>(() => systemViewOf(ctx.params));
  const button = (v: SystemView, icon: ReactNode, label: string) => (
    <button
      type="button"
      className="cw-focusable cw-button"
      aria-pressed={view === v}
      data-action={`system-view-${v}`}
      onClick={() => setView(v)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  const switcher = (
    <div className="cw-toolbar" role="group" aria-label={t("cw_system_title")}>
      {button("fan", <FanIcon aria-hidden />, t("cw_fan_title"))}
      {button("processes", <Activity aria-hidden />, t("cw_procs_title"))}
      {button("cleanup", <Eraser aria-hidden />, t("cw_cleanup_title"))}
    </div>
  );
  return view === "processes" ? (
    <Processes ctx={ctx} switcher={switcher} />
  ) : view === "cleanup" ? (
    <Cleanup ctx={ctx} switcher={switcher} />
  ) : (
    <Fan switcher={switcher} />
  );
}
