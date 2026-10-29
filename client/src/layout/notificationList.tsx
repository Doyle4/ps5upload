import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, X, XCircle } from "lucide-react";

import type { NotificationLevel } from "../state/notifications";
import { useTr } from "../state/lang";
import { formatDate } from "../lib/formatDate";

/**
 * What the bell panel and the Notifications screen share, so the two read as
 * one thing: the same row, the same level icons, and the same rule for read.
 *
 * The rule, for every list (the app's own notifications and the messages put
 * on the PS5's screen alike): a list you look at is read. Opening the bell, or
 * showing a tab of the Notifications screen, marks what it lists read; the
 * entries that were new keep their dot until the list is closed, so you can
 * still see what came in.
 */

/** The PS5 helper's free-form level, in the app's four levels. */
export function ps5Level(level: string): NotificationLevel {
  const l = level.toLowerCase();
  if (l === "error" || l === "critical") return "error";
  if (l === "warning" || l === "warn") return "warning";
  if (l === "success" || l === "ok") return "success";
  return "info";
}

/** The ids to keep marked as new: those already kept plus the unread ones now.
 *  Returns `prev` itself when nothing is added, so a state update is a no-op. */
export function addSeen<T>(prev: ReadonlySet<T>, unread: readonly T[]): ReadonlySet<T> {
  if (unread.every((id) => prev.has(id))) return prev;
  const next = new Set(prev);
  for (const id of unread) next.add(id);
  return next;
}

/**
 * The "a list you look at is read" rule. While `open`, the unread ids the
 * list shows (`unread`) are marked read shortly after they show (`markRead`
 * gets exactly those ids), including what arrives while the list stays open.
 * Pass only the ids actually on screen: the bell shows the newest few, so it
 * must not mark the rest read. Returns the ids that were unread at some point
 * while open: the rows that keep their "new" dot. Reset when the list closes.
 */
export function useSeenWhileOpen<T>(
  open: boolean,
  unread: readonly T[],
  markRead: (ids: readonly T[]) => void,
): ReadonlySet<T> {
  const [seen, setSeen] = useState<ReadonlySet<T>>(() => new Set());
  const key = unread.join("|");
  useEffect(() => {
    if (!open) {
      setSeen((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    if (unread.length === 0) return;
    setSeen((prev) => addSeen(prev, unread));
    const shown = [...unread];
    const id = window.setTimeout(() => markRead(shown), 200);
    return () => window.clearTimeout(id);
    // `key` stands for `unread`: the array is new each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, markRead]);
  return seen;
}

export function LevelIcon({ level, size = 14 }: { level: NotificationLevel; size?: number }) {
  const cls = "mt-0.5 shrink-0";
  if (level === "success")
    return <CheckCircle2 size={size} aria-hidden className={`${cls} text-[var(--color-good)]`} />;
  if (level === "warning")
    return <AlertTriangle size={size} aria-hidden className={`${cls} text-[var(--color-warn)]`} />;
  if (level === "error")
    return <XCircle size={size} aria-hidden className={`${cls} text-[var(--color-bad)]`} />;
  return <Info size={size} aria-hidden className={`${cls} text-[var(--color-muted)]`} />;
}

/** One notification, in the bell panel (`compact`) or on the Notifications screen. */
export function NotificationItem({
  level,
  title,
  body,
  ts,
  isNew,
  link,
  onJump,
  onRemove,
  compact = false,
}: {
  level: NotificationLevel;
  title: string;
  body?: string;
  /** Unix milliseconds; 0 when unknown. */
  ts: number;
  /** Unread when the list was opened: shows the dot. */
  isNew: boolean;
  link?: string;
  onJump?: (link: string) => void;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const tr = useTr();
  return (
    <li
      data-new={isNew || undefined}
      className={`group flex items-start gap-2.5 border-b border-[var(--color-border)] last:border-0 ${
        compact ? "px-3 py-2.5 text-xs" : "px-4 py-3 text-sm"
      } ${isNew ? "bg-[var(--color-accent-soft)]" : ""}`}
    >
      <LevelIcon level={level} size={compact ? 13 : 15} />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 font-medium">{title}</span>
          {isNew && (
            <span
              className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent-bright)]"
              title={tr("notif_new", undefined, "New")}
              aria-label={tr("notif_new", undefined, "New")}
            />
          )}
        </div>
        {body && <div className="mt-0.5 text-[var(--color-muted)]">{body}</div>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)]">
          {ts > 0 && <span>{formatDate(new Date(ts))}</span>}
          {link && onJump && (
            <button
              type="button"
              onClick={() => onJump(link)}
              className="inline-flex items-center gap-0.5 text-[var(--color-accent)] hover:underline max-md:min-h-8"
            >
              {tr("notifications_jump", undefined, "open")}
              <ArrowRight size={10} className="rtl:rotate-180" />
            </button>
          )}
        </div>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="-me-1 shrink-0 rounded-full p-1 text-[var(--color-muted)] opacity-0 transition-opacity hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 max-md:p-2"
          aria-label={tr("notifications_remove", undefined, "Dismiss")}
          title={tr("notifications_remove", undefined, "Dismiss")}
        >
          <X size={12} />
        </button>
      )}
    </li>
  );
}
