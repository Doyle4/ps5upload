import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Cloud,
  Gamepad2,
  HardDrive,
  Laptop,
  Play,
  Search,
  Square,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

import { appsInstalled, type InstalledTitle } from "../../api/ps5";
import {
  Badge,
  Button,
  EmptyState,
  GameIcon,
  Input,
  SegmentedControl,
  Spinner,
} from "../../components";
import { hostOf, transferAddr } from "../../lib/addr";
import { gamePath } from "../../lib/gamePage";
import { useGameLaunch } from "../../lib/useGameLaunch";
import {
  collectionGames,
  loadCollection,
  useCollectionStore,
} from "../../state/collection";
import { useConnectionStore } from "../../state/connection";
import { useConnectionsStore } from "../../state/connections";
import { useTr } from "../../state/lang";
import { libraryForHost, useLibraryStore } from "../../state/library";
import { useRunningTitleIds } from "../../state/runningApps";
import { CollectionCover } from "../Collection/CollectionCover";
import { joinAllGames, rowMatches, type AllGamesRow } from "./gamesJoin";
import type { GamesTab } from "./gamesTab";
import {
  gameLocations,
  gamesWhereOf,
  rowIsIn,
  type GameLocation,
  type GamesWhere,
} from "./gamesWhere";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const where = gamesWhereOf(searchParams.get("where"));
  const setWhere = (next: string) => {
    // A filter, not a view: replaced in place, so Back leaves Games rather than the filter.
    const params = new URLSearchParams(searchParams);
    if (next === "everywhere") params.delete("where");
    else params.set("where", next);
    setSearchParams(params, { replace: true });
  };
  const servers = useConnectionsStore((s) => s.connections);
  const game = useGameLaunch({
    nameOf: (id) => installed?.find((t) => t.titleId === id)?.titleName ?? id,
  });
  const serverName = (id: string) => servers.find((c) => c.id === id)?.name;

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
  const matching = rows.filter((r) => rowMatches(r, query));
  const shown = matching.filter((r) => rowIsIn(r, where));
  const count = (w: GamesWhere) => matching.filter((r) => rowIsIn(r, w)).length;
  const placeLabel = (l: GameLocation) => {
    const n = l.count > 1 ? ` ×${l.count}` : "";
    switch (l.kind) {
      case "installed":
        return tr("installed_badge_installed", undefined, "Installed");
      case "drive":
        return (
          (l.label || tr("games_loc_internal", undefined, "PS5 internal")) + n
        );
      case "computer":
        return tr("games_loc_computer", undefined, "This computer") + n;
      default:
        return (l.label || tr("games_loc_server", undefined, "Server")) + n;
    }
  };
  const busy = reading || collectionLoading;

  const open = (r: AllGamesRow) => {
    if (r.titleId) navigate(gamePath(r.titleId));
    else onShow("files");
  };

  return (
    <div className="flex flex-col gap-4">
      {game.dialogs}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[12rem] flex-1">
          <Input
            id="games-all-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr(
              "games_all_search",
              undefined,
              "Search games by name, title ID or file",
            )}
            leftIcon={<Search size={14} />}
            aria-label={tr(
              "games_all_search",
              undefined,
              "Search games by name, title ID or file",
            )}
          />
        </div>
        {busy && <Spinner size={16} />}
      </div>
      <SegmentedControl
        ariaLabel={tr("games_where", undefined, "Where")}
        value={where}
        onChange={setWhere}
        segments={[
          {
            value: "everywhere",
            label: `${tr("games_where_everywhere", undefined, "Everywhere")} ${count("everywhere")}`,
          },
          {
            value: "installed",
            icon: Gamepad2,
            label: `${tr("installed_badge_installed", undefined, "Installed")} ${count("installed")}`,
          },
          {
            value: "drives",
            icon: HardDrive,
            label: `${tr("games_where_drives", undefined, "On PS5 drives")} ${count("drives")}`,
          },
          {
            value: "yours",
            icon: Laptop,
            label: `${tr("games_manage_yours", undefined, "Your copies")} ${count("yours")}`,
          },
        ]}
      />

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
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<HardDrive size={14} />}
            onClick={() => onShow("files")}
          >
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
                    "games_all_empty_hint_v2",
                    undefined,
                    "Games installed on the PS5, on its drives, on this computer and on saved servers all show here. Send one to the PS5, or add the folders you keep games in under Manage → Your copies.",
                  )
            }
          />
        )
      ) : (
        <ul className="flex flex-col gap-2" data-testid="games-all">
          {shown.map((r) => (
            <li
              key={r.titleId || r.storage[0]?.path}
              className="flex items-center gap-2 rounded-[var(--radius-card)] border border-[var(--glass-edge)] bg-[var(--color-surface-raised)] pe-3 shadow-[var(--edge-highlight)] transition-colors hover:bg-[var(--color-surface)]"
            >
              <button
                type="button"
                onClick={() => open(r)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-card)] p-3 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
              >
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-md">
                  {r.computer &&
                  (r.computer.local_cover || r.computer.cover_url) ? (
                    <CollectionCover game={r.computer} className="h-full" />
                  ) : (
                    <GameIcon
                      host={host}
                      titleId={r.titleId || null}
                      gamePath={
                        r.consolePath ??
                        r.storage.find((e) => e.kind === "game")?.path ??
                        null
                      }
                      size={48}
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {r.title || r.titleId}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-muted)]">
                    {r.titleId && (
                      <span className="font-mono">{r.titleId}</span>
                    )}
                    {running.has(r.titleId) && (
                      <Badge tone="good" dot>
                        {tr("installed_badge_playing", undefined, "Playing")}
                      </Badge>
                    )}
                    {gameLocations(r, serverName)
                      .filter(
                        (l) =>
                          !(l.kind === "installed" && running.has(r.titleId)),
                      )
                      .map((l) => (
                        <Badge
                          key={`${l.kind}:${l.label}`}
                          tone={
                            l.kind === "installed"
                              ? "good"
                              : l.kind === "drive"
                                ? "accent"
                                : "neutral"
                          }
                          icon={
                            l.kind === "drive"
                              ? HardDrive
                              : l.kind === "server"
                                ? Cloud
                                : l.kind === "computer"
                                  ? Laptop
                                  : undefined
                          }
                        >
                          {placeLabel(l)}
                        </Badge>
                      ))}
                  </span>
                </span>
                <ChevronRight
                  size={16}
                  className="shrink-0 text-[var(--color-muted)] rtl:rotate-180"
                  aria-hidden
                />
              </button>
              {/* The one thing a row does in place: play an installed game, or close it. Every
                  other action is on the game page, for whichever copy it is about. */}
              {up &&
                r.installed &&
                r.titleId &&
                (running.has(r.titleId) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Square size={12} />}
                    loading={game.stoppingId === r.titleId}
                    onClick={() =>
                      void game.stop({
                        titleId: r.titleId,
                        titleName: r.title || r.titleId,
                      })
                    }
                  >
                    {tr("installed_stop", undefined, "Close game")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    leftIcon={<Play size={12} />}
                    loading={game.launchingId === r.titleId}
                    disabled={
                      game.launchingId !== null &&
                      game.launchingId !== r.titleId
                    }
                    onClick={() =>
                      void game.launch({
                        titleId: r.titleId,
                        titleName: r.title || r.titleId,
                        source: r.consolePath,
                      })
                    }
                  >
                    {tr("installed_play", undefined, "Play")}
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
