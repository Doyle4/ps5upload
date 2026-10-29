import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Gamepad2 } from "lucide-react";

import { appsInstalled, type InstalledTitle } from "../../api/ps5";
import { Button, Callout } from "../../components";
import { playFor, useTrackedPlay } from "../../lib/trackedPlay";
import { useTr } from "../../state/lang";
import { usePlayTimeStore } from "../../state/playTime";

/** The installed titles never seen running: Installed Apps' "Only not-seen-playing" list (no
 *  play recorded by the console's tracker, or by this app when the console has none). */
export function notPlayedTitles(
  titles: readonly InstalledTitle[],
  secondsOf: (titleId: string) => number | undefined,
): InstalledTitle[] {
  return titles.filter((t) => !t.system && (secondsOf(t.titleId) ?? 0) === 0);
}

/**
 * Clean up's pointer at the other big space-taker: games and apps nobody plays. It does not
 * remove anything itself; it opens Installed Apps on the not-played list, where each one can be
 * uninstalled with its own confirmation.
 */
export function NotPlayedCard({ host }: { host: string }) {
  const tr = useTr();
  const navigate = useNavigate();
  const playByHost = usePlayTimeStore((s) => s.byHost);
  const lastSeenByHost = usePlayTimeStore((s) => s.lastSeenByHost);
  const tracked = useTrackedPlay(host);
  const [titles, setTitles] = useState<InstalledTitle[] | null>(null);

  useEffect(() => {
    if (!host) return;
    let cancelled = false;
    appsInstalled(host)
      .then((r) => {
        if (!cancelled) setTitles(r.titles);
      })
      .catch(() => {
        // No list, no card: Installed Apps says why when it is opened.
      });
    return () => {
      cancelled = true;
    };
  }, [host]);

  const count = useMemo(
    () =>
      titles
        ? notPlayedTitles(titles, (id) => playFor(tracked, { byHost: playByHost, lastSeenByHost }, host, id).seconds)
            .length
        : 0,
    [titles, tracked, playByHost, lastSeenByHost, host],
  );
  if (count === 0) return null;
  return (
    <Callout tone="info" title={tr("cleanup_not_played_title", { count }, `${count} installed games or apps were never seen running`)}>
      <div className="flex flex-wrap items-center gap-3">
        <span>
          {tr(
            "cleanup_not_played_body",
            undefined,
            "Games and homebrew you never play are often the biggest things on the drive. Review them and uninstall the ones you don't need.",
          )}
        </span>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Gamepad2 size={12} />}
          onClick={() => navigate("/games?unplayed=1")}
          data-testid="cleanup-not-played"
        >
          {tr("cleanup_not_played_review", undefined, "Review them")}
        </Button>
      </div>
    </Callout>
  );
}
