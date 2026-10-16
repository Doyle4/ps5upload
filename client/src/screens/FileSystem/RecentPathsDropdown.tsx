import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { useTr } from "../../state/lang";
import { useRecentPathsStore } from "../../state/recentPaths";

/** The open list of the Recent dropdown. An opaque raised surface (the
 *  app's floating-menu glass), stacked above the file list: on the plain
 *  `--color-surface` tint, a 4% wash, the rows under it showed through. */
export function RecentPathsPanel({
  paths,
  onPick,
  onRemove,
  onClear,
}: {
  paths: string[];
  onPick: (p: string) => void;
  onRemove: (p: string) => void;
  onClear: () => void;
}) {
  const tr = useTr();
  return (
    <div
      data-testid="fs-recent-list"
      className="glass-float elev-2 absolute right-0 top-full z-40 mt-1 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--radius-card)]"
    >
      <ul className="max-h-60 overflow-y-auto py-1">
        {paths.map((p) => (
          <li key={p} className="flex items-center">
            <button
              type="button"
              onClick={() => onPick(p)}
              className="min-w-0 flex-1 truncate px-2 py-1 text-left font-mono text-xs hover:bg-[var(--color-surface-3)]"
              title={p}
            >
              {p}
            </button>
            <button
              type="button"
              onClick={() => onRemove(p)}
              className="px-1 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-bad)]"
              title={tr("fs_recent_remove", undefined, "Forget this entry")}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onClear}
        className="block w-full border-t border-[var(--color-border)] px-2 py-1 text-left text-xs text-[var(--color-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]"
      >
        {tr("fs_recent_clear", undefined, "Clear all")}
      </button>
    </div>
  );
}

/** Compact "recent paths" dropdown that lives next to the breadcrumb
 *  trail. Hidden when the recents list is empty (no point showing an
 *  empty button). Positioned to the right of the breadcrumbs so it
 *  doesn't push the active path off-screen on small windows. */
export function RecentPathsDropdown({
  onPick,
  currentPath,
}: {
  onPick: (p: string) => void;
  currentPath: string;
}) {
  const tr = useTr();
  const paths = useRecentPathsStore((s) => s.paths);
  const remove = useRecentPathsStore((s) => s.remove);
  const clear = useRecentPathsStore((s) => s.clear);
  const [open, setOpen] = useState(false);

  // Filter out the current path — no value in offering "go where you
  // already are." Keeps the list focused on actual destinations.
  const filtered = useMemo(
    () => paths.filter((p) => p !== currentPath),
    [paths, currentPath],
  );

  if (filtered.length === 0) return null;

  return (
    <div className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={tr("fs_recent_tooltip", undefined, "Recent destinations")}
        aria-expanded={open}
        className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs uppercase tracking-wider text-[var(--color-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]"
      >
        {tr("fs_recent", "Recent")}
        <ChevronRight
          size={10}
          className={`transition-transform ${open ? "rotate-90" : "rtl:rotate-180"}`}
        />
      </button>
      {open && (
        <RecentPathsPanel
          paths={filtered}
          onPick={(p) => {
            onPick(p);
            setOpen(false);
          }}
          onRemove={remove}
          onClear={() => {
            clear();
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
