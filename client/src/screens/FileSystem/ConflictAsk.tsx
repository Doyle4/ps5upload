import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "../../components";
import { activateFocusTrap } from "../../lib/focusTrap";
import { useTr } from "../../state/lang";
import type {
  FsConflict,
  FsConflictChoice,
  FsConflictDecision,
} from "../../state/fsUploadPlan";

/**
 * The question a copy onto the PS5 asks when a name is already in the folder: Skip, Keep both,
 * or Replace (Merge for a folder into a folder), with "do the same for the other N" when more
 * conflicts follow. Asked BEFORE the upload starts (state/fsUploadPlan), so the answers travel
 * with the one job. Same imperative shape as `useConfirm`: `await ask(conflict)`; null = Cancel
 * (nothing is copied).
 */
export function useConflictAsk(): {
  ask: (c: FsConflict) => Promise<FsConflictDecision | null>;
  dialog: React.ReactNode;
} {
  const tr = useTr();
  const [pending, setPending] = useState<
    (FsConflict & { resolve: (d: FsConflictDecision | null) => void }) | null
  >(null);
  const [all, setAll] = useState(false);
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const ask = (c: FsConflict) =>
    new Promise<FsConflictDecision | null>((resolve) => {
      setAll(false);
      setPending({ ...c, resolve });
    });

  const settle = (choice: FsConflictChoice | null) => {
    if (!pending) return;
    pending.resolve(choice ? { choice, all: all && pending.left > 0 } : null);
    setPending(null);
  };

  useEffect(() => {
    if (!pending) return;
    return activateFocusTrap(() => panelRef.current, window, {
      onEscape: (e) => {
        e.preventDefault();
        settle(null);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (!pending) return { ask, dialog: null };
  const folderMerge = pending.canReplace && pending.pickedDir;
  const body = !pending.canReplace
    ? tr(
        "fs_conflict_body_mixed",
        undefined,
        "A file and a folder can't replace each other. Skip it, or keep both under a new name.",
      )
    : folderMerge
      ? tr(
          "fs_conflict_body_folder",
          undefined,
          "Merge copies into the folder that is there: files with the same name are overwritten, everything else in it is left alone.",
        )
      : tr(
          "fs_conflict_body_file",
          undefined,
          "Replace overwrites the file that is there, and that can't be undone. If this is inside a mounted game image, a bad file can stop the game booting.",
        );
  const dialog = (
    <div
      className="anim-scrim scrim fixed inset-0 z-[60] flex items-center justify-center p-4"
      onClick={() => settle(null)}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="anim-pop glass-float elev-3 w-full max-w-md rounded-[var(--radius-panel)] p-6"
        onClick={(e) => e.stopPropagation()}
        data-testid="fs-conflict"
      >
        <header
          id={titleId}
          className="mb-2 flex items-center gap-2 text-base font-semibold"
        >
          <AlertTriangle size={14} className="text-[var(--color-warn)]" />
          <span className="min-w-0 break-words">
            {tr(
              "fs_conflict_title",
              { name: pending.name },
              `"${pending.name}" is already here`,
            )}
          </span>
        </header>
        <p
          id={bodyId}
          className="mb-4 whitespace-pre-line text-sm text-[var(--color-muted)]"
        >
          {body}
        </p>
        {pending.left > 0 && (
          <label className="mb-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
            />
            {tr(
              "fs_conflict_apply_all",
              { count: pending.left },
              `Do the same for the other ${pending.left} conflicts`,
            )}
          </label>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => settle(null)}>
            {tr("cancel", undefined, "Cancel")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => settle("skip")}>
            {tr("fs_conflict_skip", undefined, "Skip")}
          </Button>
          <Button
            variant={folderMerge ? "secondary" : "primary"}
            size="sm"
            onClick={() => settle("keep")}
            // The safe answer has the focus (Enter must never overwrite a file unasked).
            autoFocus={!folderMerge}
          >
            {tr("fs_conflict_keep_both", undefined, "Keep both")}
          </Button>
          {pending.canReplace && (
            <Button
              variant={folderMerge ? "primary" : "danger"}
              size="sm"
              onClick={() => settle("replace")}
              autoFocus={folderMerge}
            >
              {folderMerge
                ? tr("fs_conflict_merge", undefined, "Merge")
                : tr("fs_conflict_replace", undefined, "Replace")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
  return { ask, dialog };
}
