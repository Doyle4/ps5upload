import { useState } from "react";
import { Link } from "react-router";
import { History, Trash2 } from "lucide-react";

import { activityReset, type InstalledTitle } from "../../api/ps5";
import { Button, GameIcon, Modal } from "../../components";
import { transferAddr } from "../../lib/addr";
import { gamePath } from "../../lib/gamePage";
import { humanizePs5Error } from "../../lib/humanizeError";
import { refreshTrackedPlay } from "../../lib/trackedPlay";
import { formatLastSeen, formatPlayTime } from "../../state/playTime";
import { useLangStore, useTr } from "../../state/lang";
import { pushNotification } from "../../state/notifications";

export interface RecentPlay {
  title: InstalledTitle;
  seconds: number | undefined;
  lastSeenMs: number;
}

/** The titles last seen played, newest first: ones never seen played are left out, and
 *  so are the ones running now (the Now playing banner above already shows those). */
export function recentlyPlayed(
  titles: readonly InstalledTitle[],
  playOf: (titleId: string) => { seconds: number | undefined; lastSeenMs: number | undefined },
  running: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  limit = 8,
): RecentPlay[] {
  const out: RecentPlay[] = [];
  for (const t of titles) {
    if (t.system || running.has(t.titleId)) continue;
    const p = playOf(t.titleId);
    if (p.lastSeenMs) out.push({ title: t, seconds: p.seconds, lastSeenMs: p.lastSeenMs });
  }
  return out.sort((a, b) => b.lastSeenMs - a.lastSeenMs).slice(0, limit);
}

/**
 * A compact row of the games last played on this PS5, each opening its game page: what the
 * Game Activity screen listed, where people look for their games. Reset clears the helper's
 * tracked play time, so it is offered only when the helper answered (`canReset`).
 */
export function RecentlyPlayedStrip({
  host,
  items,
  canReset,
}: {
  host: string;
  items: readonly RecentPlay[];
  canReset: boolean;
}) {
  const tr = useTr();
  const lang = useLangStore((s) => s.lang);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  if (items.length === 0) return null;

  const reset = async () => {
    setResetting(true);
    try {
      await activityReset(transferAddr(host));
      refreshTrackedPlay();
      setResetOpen(false);
    } catch (e) {
      pushNotification("error", tr("game_activity_reset", undefined, "Reset play time"), {
        body: humanizePs5Error(String(e)),
      });
    } finally {
      setResetting(false);
    }
  };

  return (
    <section
      className="flex flex-col gap-2"
      aria-label={tr("games_recently_played", undefined, "Recently played")}
      data-testid="recently-played"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">
          <History size={12} className="shrink-0" aria-hidden />
          {tr("games_recently_played", undefined, "Recently played")}
        </div>
        {canReset && (
          <Button variant="ghost" size="sm" leftIcon={<Trash2 size={12} />} onClick={() => setResetOpen(true)}>
            {tr("game_activity_reset", undefined, "Reset play time")}
          </Button>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {items.map(({ title: t, seconds, lastSeenMs }) => (
          <Link
            key={t.titleId}
            to={gamePath(t.titleId)}
            className="surface-panel flex w-56 shrink-0 items-center gap-3 !rounded-2xl p-2 transition-colors hover:bg-[var(--color-surface)]"
          >
            <span className="shrink-0 rounded-xl border border-[var(--glass-edge)] bg-[var(--color-pill)] p-0.5">
              <GameIcon host={host} titleId={t.titleId} size={40} rounded="rounded-lg" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold" title={t.titleName}>
                {t.titleName}
              </span>
              <span className="block truncate text-xs text-[var(--color-muted)]">
                {seconds && seconds > 0
                  ? `${formatPlayTime(seconds)} · ${formatLastSeen(lastSeenMs, undefined, lang)}`
                  : formatLastSeen(lastSeenMs, undefined, lang)}
              </span>
            </span>
          </Link>
        ))}
      </div>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={tr("game_activity_reset_title", undefined, "Reset play time?")}
      >
        <p className="text-sm text-[var(--color-muted)]">
          {tr(
            "games_recent_reset_explain",
            undefined,
            "This permanently deletes the play time ps5upload has recorded on this console. It cannot be undone. The console's own Play Time records are not affected.",
          )}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setResetOpen(false)}>
            {tr("cancel", undefined, "Cancel")}
          </Button>
          <Button variant="danger" disabled={resetting} onClick={() => void reset()}>
            {resetting
              ? tr("game_activity_resetting", undefined, "Resetting…")
              : tr("game_activity_reset_confirm", undefined, "Reset")}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
