import { FolderArchive, Gamepad2, LayoutGrid, Laptop } from "lucide-react";
import { useSearchParams } from "react-router";

import { PageHeader, Tabs } from "../../components";
import { useTr } from "../../state/lang";
import CollectionScreen from "../Collection";
import InstalledAppsScreen from "../InstalledApps";
import LibraryScreen from "../Library";
import { AllGames } from "./AllGames";
import { gamesTabOf, type GamesTab } from "./gamesTab";

/**
 * Games: one place for every game, wherever it is.
 *
 * - All (`any`, the default): every game once, with where its copies are; a click opens its
 *   game page, which holds every action for every copy.
 * - Installed (`ready`): what the PS5 has registered; Play, Close, uninstall, backport.
 * - On PS5 Storage (`files`): game folders and images on the console's drives; mount,
 *   register, move, edit files.
 * - On This Computer (`all`): the Collection on this computer's drives and shares.
 *
 * The three last views were the whole screen ("On this PS5", "Everything", "Game files"), so a
 * game sat in up to three lists and people had to know which one to look in. All answers
 * "where is my game" in one list; the others are for working on one place at a time.
 *
 * The views are chips (the shared Tabs), selected by `?tab=` so a link, a refresh or Back
 * lands on the same one.
 */
export default function GamesScreen() {
  const tr = useTr();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = gamesTabOf(searchParams.get("tab"));
  const setTab = (next: string) => {
    if (next === tab) return;
    // A full view, not a transient filter: push it so Back returns to the
    // previous one. Other query state the panels own is kept.
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params);
  };

  const label = tr("games_title", undefined, "Games");
  const tabLabel: Record<GamesTab, string> = {
    any: tr("games_tab_any", undefined, "All"),
    ready: tr("games_tab_installed", undefined, "Installed"),
    files: tr("games_tab_storage", undefined, "On PS5 Storage"),
    all: tr("games_tab_computer", undefined, "On This Computer"),
  };
  return (
    <div className="app-page flex h-full flex-col">
      <PageHeader
        icon={Gamepad2}
        title={label}
        description={
          tab === "any"
            ? tr(
                "games_any_description",
                undefined,
                "Every game you have, once each: installed on the PS5, on its drives, or on this computer. Open one to see all its copies and what you can do with them.",
              )
            : tab === "all"
            ? tr(
                "collection.description",
                undefined,
                "Every game you keep on this computer's drives, grouped by game: its copies, updates and DLC, duplicates and the space they take. Each item is read from the file itself, wherever it sits.",
              )
            : tab === "files"
            ? tr(
                "games_files_description",
                undefined,
                "Game folders and disk images found in console storage. Mount, register, move, or inspect source files here.",
              )
            : tr(
                "games_ready_description",
                undefined,
                "Games registered on this PS5. Launch, stop, inspect, or uninstall them here.",
              )
        }
      />
      <Tabs
        ariaLabel={label}
        value={tab}
        onChange={setTab}
        className="mb-6"
        tabs={[
          { id: "any", icon: LayoutGrid, label: tabLabel.any },
          { id: "ready", icon: Gamepad2, label: tabLabel.ready },
          { id: "files", icon: FolderArchive, label: tabLabel.files },
          { id: "all", icon: Laptop, label: tabLabel.all },
        ]}
      />
      <div role="tabpanel" aria-label={tabLabel[tab]} className="min-h-0 flex-1">
        {tab === "any" ? (
          <AllGames onShow={setTab} />
        ) : tab === "files" ? (
          <LibraryScreen />
        ) : tab === "all" ? (
          <CollectionScreen embedded />
        ) : (
          <InstalledAppsScreen />
        )}
      </div>
    </div>
  );
}
