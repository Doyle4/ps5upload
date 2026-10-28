import { useEffect, useMemo, useState } from "react";
import { ChevronRight, HardDrive, Laptop, Search } from "lucide-react";
import { useNavigate } from "react-router";

import { appsInstalled, type InstalledTitle } from "../../api/ps5";
import { Badge, Button, EmptyState, GameIcon, Input, Spinner } from "../../components";
import { hostOf, transferAddr } from "../../lib/addr";
import { gamePath } from "../../lib/gamePage";
import { collectionGames, loadCollection, useCollectionStore } from "../../state/collection";
import { useConnectionStore } from "../../state/connection";
import { useTr } from "../../state/lang";
import { libraryForHost, useLibraryStore } from "../../state/library";
import { useRunningTitleIds } from "../../state/runningApps";
import { CollectionCover } from "../Collection/CollectionCover";
import { joinAllGames, rowMatches, type AllGamesRow } from "./gamesJoin";
import type { GamesTab } from "./gamesTab";

/** The connected console's registered titles, kept per console so coming back shows them at
 *  once while they are read again. */
const installedCache = new Map<string, InstalledTitle[]>();

/**
 * Games' All view: every game the app knows, once each, with where its copies are (installed,
 * on the PS5's drives, on this computer) and a click to its game page, which holds every
 * action for every copy. The Installed, On PS5 Storage and On This Computer views stay for
 * working on one place at a time.
 */
export function AllGames({ onShow }: { onShow: (tab: GamesTab) => void }) {
  const tr = useTr();
  const navigate = useNavigate();
  const host = useConnectionStore((s) => s.host?.trim() ?? "");
  const up = useConnectionStore((s) => s.payloadStatus === "up");
  const running = useRunningTitleIds(host);
  const slot = useLibraryStore((s) => libraryForHost(s, host));
  const library = useCollectionStore((s) => s.library);
  const collectionLoading = useCollectionStore((s) => s.loading);
  const [installed, setInstalled] = useState<InstalledTitle[] | null>(
    () => installedCache.get(hostOf(host)) ?? null,
  );
  const [reading, setReading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!library && !collectionLoading) void loadCollection();
    // Once: the Collection keeps itself current after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setInstalled(installedCache.get(hostOf(host)) ?? null);
    if (!host || !up) return;
    let live = true;
    setReading(true);
    appsInstalled(transferAddr(host))
      .then((r) => {
        installedCache.set(hostOf(host), r.titles);
        if (live) setInstalled(r.titles);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setReading(false);
      });
    return () => {
      live = false;
    };
  }, [host, up]);

  const rows = useMemo(
    () =>
      joinAllGames({
        installed,
        storage: slot.entries,
        registeredBySource: slot.registeredBySource,
        collection: collectionGames(library),
      }),
    [installed, slot.entries, slot.registeredBySource, library],
  );
  const shown = rows.filter((r) => rowMatches(r, query));
  const busy = reading || collectionLoading;

  const open = (r: AllGamesRow) => {
    if (r.titleId) navigate(gamePath(r.titleId));
    else onShow("files");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[12rem] flex-1">
          <Input
            id="games-all-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("games_all_search", undefined, "Search games by name, title ID or file")}
            leftIcon={<Search size={14} />}
            aria-label={tr("games_all_search", undefined, "Search games by name, title ID or file")}
          />
        </div>
        {busy && <Spinner size={16} />}
      </div>

      {/* The drives are read by On PS5 Storage; until then their copies can't be listed here. */}
      {up && slot.entries === null && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-muted)]">
          <span>
            {tr(
              "games_all_storage_unread",
              undefined,
              "Game folders and images on the PS5's drives show here once the drives have been read.",
            )}
          </span>
          <Button size="sm" variant="secondary" leftIcon={<HardDrive size={14} />} onClick={() => onShow("files")}>
            {tr("games_all_read_storage", undefined, "Read the PS5's Drives")}
          </Button>
        </div>
      )}

      {shown.length === 0 ? (
        busy ? null : (
          <EmptyState
            title={
              query.trim()
                ? tr("games_all_no_match", undefined, "No games match")
                : tr("games_all_empty", undefined, "No games yet")
            }
            message={
              query.trim()
                ? undefined
                : tr(
                    "games_all_empty_hint",
                    undefined,
                    "Games installed on the PS5, on its drives and in this computer's Collection all show here. Send one to the PS5, or add a folder to the Collection under On This Computer.",
                  )
            }
          />
        )
      ) : (
        <ul className="flex flex-col gap-2" data-testid="games-all">
          {shown.map((r) => (
            <li key={r.titleId || r.storage[0]?.path}>
              <button
                type="button"
                onClick={() => open(r)}
                className="flex w-full items-center gap-3 rounded-[var(--radius-card)] border border-[var(--glass-edge)] bg-[var(--color-surface-raised)] p-3 text-start shadow-[var(--edge-highlight)] transition-colors hover:bg-[var(--color-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
              >
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-md">
                  {r.computer && (r.computer.local_cover || r.computer.cover_url) ? (
                    <CollectionCover game={r.computer} className="h-full" />
                  ) : (
                    <GameIcon
                      host={host}
                      titleId={r.titleId || null}
                      gamePath={r.consolePath ?? r.storage.find((e) => e.kind === "game")?.path ?? null}
                      size={48}
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.title || r.titleId}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-muted)]">
                    {r.titleId && <span className="font-mono">{r.titleId}</span>}
                    {running.has(r.titleId) ? (
                      <Badge tone="good" dot>
                        {tr("installed_badge_playing", undefined, "Playing")}
                      </Badge>
                    ) : (
                      r.installed && <Badge tone="good">{tr("installed_badge_installed", undefined, "Installed")}</Badge>
                    )}
                    {r.storage.length > 0 && (
                      <Badge tone="accent" icon={HardDrive}>
                        {tr("games_all_on_storage", { n: r.storage.length }, "{n} on PS5 storage")}
                      </Badge>
                    )}
                    {r.computer && (
                      <Badge tone="neutral" icon={Laptop}>
                        {tr("games_all_on_computer", { n: r.computer.copies }, "{n} on this computer")}
                      </Badge>
                    )}
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-[var(--color-muted)] rtl:rotate-180" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
