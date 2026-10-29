import {
  ArrowLeft,
  FolderArchive,
  Gamepad2,
  HardDriveDownload,
  Settings2,
} from "lucide-react";
import { useSearchParams } from "react-router";

import { Button, PageHeader } from "../../components";
import { OverflowMenu } from "../../components/OverflowMenu";
import { useTr } from "../../state/lang";
import CollectionScreen from "../Collection";
import InstalledAppsScreen from "../InstalledApps";
import LibraryScreen from "../Library";
import { DumpsView } from "./Dumps";
import { gamesTabOf, type GamesTab } from "./gamesTab";

/**
 * Games: one grid, every game once (CollectionScreen): your copies, plus what the selected PS5
 * has installed that you have no copy of. Its filters narrow it to what is or isn't on that
 * console. A game opens its game page, which holds every action for every copy.
 *
 * The work that is about one place rather than one game (an installed game's upkeep, the PS5's
 * drives, the folders and servers this computer reads, dumping) is under Manage, as its own
 * view (`?tab=ready|files|dumps`, the ids of the tabs these views used to be, so every link
 * to them still lands; `?tab=all`, the old copies tab, is the grid).
 */
export default function GamesScreen() {
  const tr = useTr();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = gamesTabOf(searchParams.get("tab"));
  const show = (next: GamesTab) => {
    if (next === tab) return;
    // A view of its own: pushed, so Back returns to the list.
    const params = new URLSearchParams(searchParams);
    if (next === "any") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params);
  };

  const label = tr("games_title", undefined, "Games");
  const manageLabel: Record<Exclude<GamesTab, "any">, string> = {
    ready: tr("games_manage_installed", undefined, "Installed games"),
    files: tr("games_manage_drives", undefined, "Games on the PS5's drives"),
    dumps: tr("games_manage_dumps", undefined, "Dump games"),
  };
  const manage = (
    <OverflowMenu
      triggerLabel={tr("games_manage", undefined, "Manage")}
      triggerIcon={<Settings2 size={14} />}
      triggerVariant="secondary"
      align="right"
      ariaLabel={tr("games_manage", undefined, "Manage")}
      items={[
        {
          label: manageLabel.ready,
          icon: <Gamepad2 size={14} />,
          onSelect: () => show("ready"),
        },
        {
          label: manageLabel.files,
          icon: <FolderArchive size={14} />,
          onSelect: () => show("files"),
        },
        {
          label: manageLabel.dumps,
          icon: <HardDriveDownload size={14} />,
          onSelect: () => show("dumps"),
        },
      ]}
    />
  );

  if (tab === "any") {
    return (
      <div className="app-page flex h-full flex-col">
        <PageHeader
          icon={Gamepad2}
          title={label}
          right={manage}
          description={tr(
            "games_grid_description",
            undefined,
            "Every game you have, once each: your copies on this computer or a saved server, and what the PS5 has installed. Filter by what is on the PS5; open a game for all its copies and actions.",
          )}
        />
        <CollectionScreen embedded />
      </div>
    );
  }

  const description: Record<Exclude<GamesTab, "any">, string> = {
    ready: tr(
      "games_ready_description",
      undefined,
      "Games registered on this PS5. Launch, stop, inspect, or uninstall them here.",
    ),
    files: tr(
      "games_files_description",
      undefined,
      "Game folders and disk images found in console storage. Mount, register, move, or inspect source files here.",
    ),
    dumps: tr(
      "games_dumps_description",
      undefined,
      "Dump installed games, decrypted, to a USB drive or the console with ps5-app-dumper, one at a time or as a queue. Finished dumps open in Files and Workshop.",
    ),
  };
  return (
    <div className="app-page flex h-full flex-col">
      <div className="mb-2">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<ArrowLeft size={14} className="rtl:rotate-180" />}
          onClick={() => show("any")}
        >
          {tr("games_back_all", undefined, "All games")}
        </Button>
      </div>
      <PageHeader
        title={manageLabel[tab]}
        right={manage}
        description={description[tab]}
      />
      <div className="min-h-0 flex-1" data-testid={`games-manage-${tab}`}>
        {tab === "dumps" ? (
          <DumpsView />
        ) : tab === "files" ? (
          <LibraryScreen />
        ) : (
          <InstalledAppsScreen />
        )}
      </div>
    </div>
  );
}
