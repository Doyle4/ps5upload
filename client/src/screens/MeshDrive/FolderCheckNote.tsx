import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import type { FolderCheck } from "../../api/meshDrive";
import { useTr, type Translator } from "../../state/lang";

/** What a checked folder choice means, in words. */
export function folderCheckText(tr: Translator, c: FolderCheck, where: "console" | "local"): string {
  const n = c.more ? `${c.files}+` : String(c.files);
  if (c.ok) {
    if (c.will_create) return tr("drive_check_new", undefined, "A new folder is made here.");
    if (c.files === 0)
      return c.marker
        ? tr("drive_check_empty_marker", undefined, "An empty folder that was a Mesh Drive's before. It is used again.")
        : tr("drive_check_empty", undefined, "An empty folder.");
    return where === "console"
      ? tr("drive_check_files_console", { n }, `${n} files already here join the drive.`)
      : tr(
          "drive_check_files_local",
          { n },
          `${n} files already here join the drive. A file with the same name on both sides is compared; if they differ, both are kept.`,
        );
  }
  const other = c.detail ?? "";
  switch (c.problem) {
    case "bad_name":
      return tr("drive_check_bad_name", undefined, 'That name cannot be a folder name (no / \\ : * ? " < > |).');
    case "not_absolute":
      return tr("drive_check_not_absolute", undefined, "Choose a folder.");
    case "no_parent":
      return tr("drive_check_no_parent", undefined, "The folder it would go in does not exist.");
    case "not_folder":
      return tr("drive_check_not_folder", undefined, "That is a file, not a folder.");
    case "exists":
      return tr("drive_check_exists", undefined, "A folder with this name is already there.");
    case "taken":
      return tr("drive_check_taken", { other }, `It is already the folder of the drive ${other}.`);
    case "inside":
      return tr("drive_check_inside", { other }, `It is inside the folder of the drive ${other}.`);
    case "holds":
      return tr("drive_check_holds", { other }, `It holds the folder of the drive ${other}.`);
    case "already_linked":
      return tr("drive_link_already", undefined, "That console already holds this drive.");
    case "too_broad":
      return tr(
        "drive_check_too_broad",
        undefined,
        "That is a whole drive or home folder: everything on it would be synced. Choose or make a folder inside it.",
      );
    case "app_data":
      return tr("drive_check_app_data", undefined, "That is the app's own data folder. Choose another.");
    case "not_writable":
      return tr("drive_check_not_writable", undefined, "This app cannot write there.");
    default:
      return tr("drive_check_unreadable", { detail: other }, `It cannot be read: ${other}`);
  }
}

export function FolderCheckNote({
  check,
  busy,
  where,
}: {
  check: FolderCheck | null;
  busy: boolean;
  where: "console" | "local";
}) {
  const tr = useTr();
  if (busy)
    return (
      <p className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
        <Loader2 size={12} className="animate-spin" aria-hidden />
        {tr("drive_checking", undefined, "Checking…")}
      </p>
    );
  if (!check) return null;
  return (
    <p className={`flex items-start gap-1.5 text-xs ${check.ok ? "text-[var(--color-muted)]" : "text-[var(--color-bad)]"}`}>
      {check.ok ? (
        <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-[var(--color-good)]" aria-hidden />
      ) : (
        <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 break-words">{folderCheckText(tr, check, where)}</span>
    </p>
  );
}
