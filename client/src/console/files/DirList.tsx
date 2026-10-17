import { File, FileImage, FileText, Folder, Link2, type LucideIcon } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { t } from "../strings";
import { ActionsButton } from "../ui/ActionsButton";
import type { Entry } from "./useDir";

/** What the viewer can show: images and text (others are not rendered). */
export function viewKind(name: string): "image" | "text" | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return "image";
  if (ext === "txt" || ext === "log" || ext === "json" || ext === "ini" || ext === "xml") return "text";
  return null;
}

function iconFor(e: Entry): LucideIcon {
  if (e.kind === "dir") return Folder;
  if (e.kind === "link") return Link2;
  const v = viewKind(e.name);
  return v === "image" ? FileImage : v === "text" ? FileText : File;
}

/**
 * A folder's entries, one row each: ✕ opens (a folder, a viewable file) or,
 * in select mode, marks the row; "⋯" (or △) opens its actions. Names are text
 * nodes only, so any name (quotes, CJK, markup) shows as it is.
 */
export function DirList({
  entries,
  selecting,
  selected,
  onEntry,
  onToggleItem,
  onActions,
  label,
}: {
  entries: Entry[];
  selecting: boolean;
  selected: string[];
  onEntry: (e: Entry) => void;
  onToggleItem: (name: string) => void;
  onActions: (name: string) => void;
  label?: string;
}) {
  const marked = new Set(selected);
  return (
    <ul className="cw-files" data-nav-list aria-label={label}>
      {entries.map((e) => {
        const Icon = iconFor(e);
        const on = marked.has(e.name);
        return (
          <li key={e.name} className={`cw-file${on ? " is-selected" : ""}`} data-nav-item data-entry={e.name}>
            <button
              type="button"
              className="cw-focusable cw-file-main"
              data-entry-main=""
              aria-pressed={selecting ? on : undefined}
              onClick={() => (selecting ? onToggleItem(e.name) : onEntry(e))}
            >
              <Icon className="cw-file-icon" aria-hidden />
              <span className="cw-file-text">
                <span className="cw-file-name">{e.name}</span>
              </span>
              <span className="cw-file-meta cw-dim">
                {e.kind === "dir" ? t("cw_files_kind_dir") : formatBytes(e.size)}
              </span>
            </button>
            <ActionsButton onPress={() => onActions(e.name)} />
          </li>
        );
      })}
    </ul>
  );
}
