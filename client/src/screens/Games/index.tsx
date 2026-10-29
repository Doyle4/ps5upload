import { useCallback, useEffect, useMemo } from "react";
import {
  ArrowLeft,
  Gamepad2,
  HardDriveDownload,
  Settings2,
} from "lucide-react";
import { useSearchParams } from "react-router";

import { Button, PageHeader, WarningCard } from "../../components";
import EditSessionBanner from "../../components/EditSessionBanner";
import { OverflowMenu } from "../../components/OverflowMenu";
import { playFor, useTrackedPlay } from "../../lib/trackedPlay";
import { useLibraryScan } from "../../lib/useLibraryScan";
import { useCollectionStore } from "../../state/collection";
import { useConnectionStore } from "../../state/connection";
import { useInstalledTitles } from "../../state/installedTitles";
import { useTr } from "../../state/lang";
import { refreshLibrary } from "../../state/library";
import { usePlayTimeStore } from "../../state/playTime";
import { useRunningTitleIds } from "../../state/runningApps";
import CollectionScreen from "../Collection";
import { installedKindOf } from "../GameHub/installedKind";
import { SmpNeededWarning, useSmpState } from "../GameHub/SmpNeeded";
import { DumpsView } from "./Dumps";
import { gamesTabOf, legacyConsoleFilter } from "./gamesTab";
import { recentlyPlayed, RecentlyPlayedStrip } from "./RecentlyPlayed";
import { UnlinkedFiles } from "./UnlinkedFiles";

/**
 * Games: one grid, every game once (CollectionScreen): your copies, what the selected PS5 has
 * installed, and the games on its drives, each once. Its filters narrow it to what is or isn't
 * on that console. A game opens its game page, which holds every action for every copy: the
 * installed game's upkeep and its files on the PS5's drives included.
 *
 * Dumping is about the console rather than one game, so it is a view of its own under Manage
 * (`?tab=dumps`). Links to the views the grid replaced (`?tab=ready`, `?tab=files`,
 * `unplayed=1`) open the grid with the filter that shows the same games.
 */
export default function GamesScreen() {
  const tr = useTr();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = gamesTabOf(searchParams.get("tab"));
  const showDumps = (on: boolean) => {
    // A view of its own: pushed, so Back returns to the list.
    const params = new URLSearchParams(searchParams);
    if (on) params.set("tab", "dumps");
    else params.delete("tab");
    setSearchParams(params);
  };

  // An old link: the grid, filtered to what that view listed, and the link put away.
  useEffect(() => {
    const filter = legacyConsoleFilter(searchParams);
    if (!filter) return;
    useCollectionStore.getState().set({ consoleFilter: filter });
    const params = new URLSearchParams(searchParams);
    params.delete("tab");
    params.delete("unplayed");
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const label = tr("games_title", undefined, "Games");
  const manage = (
    <OverflowMenu
      triggerLabel={tr("games_manage", undefined, "Manage")}
      triggerIcon={<Settings2 size={14} />}
      triggerVariant="secondary"
      align="right"
      ariaLabel={tr("games_manage", undefined, "Manage")}
      items={[
        {
          label: tr("games_manage_dumps", undefined, "Dump games"),
          icon: <HardDriveDownload size={14} />,
          onSelect: () => showDumps(true),
        },
      ]}
    />
  );

  if (tab === "dumps") {
    return (
      <div className="app-page flex h-full flex-col">
        <div className="mb-2">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft size={14} className="rtl:rotate-180" />}
            onClick={() => showDumps(false)}
          >
            {tr("games_back_all", undefined, "All games")}
          </Button>
        </div>
        <PageHeader
          title={tr("games_manage_dumps", undefined, "Dump games")}
          right={manage}
          description={tr(
            "games_dumps_description2",
            undefined,
            "Copy installed games to a USB drive or the console, one at a time or as a queue. A plain copy by default; decrypting the executables is an option.",
          )}
        />
        <div className="min-h-0 flex-1" data-testid="games-manage-dumps">
          <DumpsView />
        </div>
      </div>
    );
  }

  return (
    <div className="app-page flex h-full flex-col">
      <PageHeader
        icon={Gamepad2}
        title={label}
        right={manage}
        description={tr(
          "games_grid_description2",
          undefined,
          "Every game you have, once each: your copies on this computer or a saved server, what the PS5 has installed, and the games on its drives. Filter by what is on the PS5; open a game for all its copies and actions.",
        )}
      />
      <ConsoleNotes />
      <CollectionScreen embedded />
      <UnlinkedFiles />
    </div>
  );
}

/**
 * What the connected PS5 needs said above the grid: an image checked out for editing, the
 * games it last played, and what stops its games from starting (no kstuff; ShadowMount+ not
 * running while some installed games run from a disk image). Each only when it applies. Also
 * keeps the PS5's drive scan current, which the grid and the game pages read.
 */
function ConsoleNotes() {
  const tr = useTr();
  const host = useConnectionStore((s) => s.host?.trim() ?? "");
  const up = useConnectionStore((s) => s.payloadStatus === "up");
  const ucredElevated = useConnectionStore((s) => s.ucredElevated);
  useLibraryScan();
  const titles = useInstalledTitles(up && host ? host : undefined);
  const discs = useMemo(
    () => (titles ?? []).filter((t) => installedKindOf(t) === "disc").length,
    [titles],
  );
  const smp = useSmpState(up && discs > 0 ? host : "");

  const tracked = useTrackedPlay(up ? host : null);
  const byHost = usePlayTimeStore((s) => s.byHost);
  const lastSeenByHost = usePlayTimeStore((s) => s.lastSeenByHost);
  const playOf = useCallback(
    (id: string) => playFor(tracked, { byHost, lastSeenByHost }, host, id),
    [tracked, byHost, lastSeenByHost, host],
  );
  const running = useRunningTitleIds(up ? host : null);
  const recent = useMemo(
    () => recentlyPlayed(titles ?? [], playOf, running),
    [titles, playOf, running],
  );

  if (!up || !host) return null;
  return (
    <div className="mb-5 flex flex-col gap-4 empty:hidden">
      {/* An open edit session hides a game from the home screen; re-scan once it ends. */}
      <EditSessionBanner onFinished={() => void refreshLibrary(host)} />
      {ucredElevated === false && (
        <WarningCard
          title={tr(
            "installed_kstuff_off_title",
            undefined,
            "kstuff isn't active — games won't launch",
          )}
          detail={tr(
            "installed_kstuff_off_body",
            undefined,
            "The payload doesn't have kernel read/write, which means a jailbreak/kstuff entry point isn't loaded. Launching (and installing) fpkg games will fail until you load the console through kstuff and reconnect.",
          )}
        />
      )}
      {discs > 0 && smp.absent && <SmpNeededWarning host={host} count={discs} />}
      <RecentlyPlayedStrip host={host} items={recent} canReset={tracked !== null} />
    </div>
  );
}
