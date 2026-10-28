import { Fragment } from "react";
import { AlertTriangle, Check, ChevronRight, Loader2, X } from "lucide-react";

import { useTr } from "../../state/lang";
import type { Stage, StageKey } from "./queueStages";

/** A queue row's steps on one line: "Upload ✓ › Install 62% › Done". Nothing for one step. */
export function StageRail({
  stages,
  installPct,
}: {
  stages: Stage[];
  installPct?: number | null;
}) {
  const tr = useTr();
  if (stages.length < 2) return null;
  const label: Record<StageKey, string> = {
    upload: tr("queue_stage_upload", undefined, "Upload"),
    install: tr("queue_stage_install", undefined, "Install"),
    mount: tr("queue_stage_mount", undefined, "Mount"),
    register: tr("queue_stage_register", undefined, "Add to Home"),
  };
  return (
    <ol
      className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[var(--color-muted)]"
      aria-label={tr("queue_stages", undefined, "Steps")}
      data-testid="queue-stages"
    >
      {stages.map((s, i) => (
        <Fragment key={s.key}>
          {i > 0 && (
            <ChevronRight
              size={12}
              aria-hidden
              className="shrink-0 rtl:rotate-180"
            />
          )}
          <li
            className={`inline-flex items-center gap-1 ${
              s.state === "active"
                ? "font-medium text-[var(--color-text)]"
                : s.state === "done"
                  ? "text-[var(--color-good)]"
                  : s.state === "failed"
                    ? "text-[var(--color-bad)]"
                    : s.state === "warn"
                      ? "text-[var(--color-warn)]"
                      : ""
            }`}
            data-state={s.state}
          >
            {s.state === "done" && <Check size={12} aria-hidden />}
            {s.state === "active" && (
              <Loader2 size={12} aria-hidden className="animate-spin" />
            )}
            {s.state === "failed" && <X size={12} aria-hidden />}
            {s.state === "warn" && <AlertTriangle size={12} aria-hidden />}
            {label[s.key]}
            {s.key === "install" &&
              s.state === "active" &&
              installPct != null &&
              ` ${Math.round(installPct)}%`}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
