import { FolderArchive, Gamepad2, Library } from "lucide-react";
import { useSearchParams } from "react-router";

import { PageHeader, Tabs } from "../../components";
import { useTr } from "../../state/lang";
import CollectionScreen from "../Collection";
import InstalledAppsScreen from "../InstalledApps";
import LibraryScreen from "../Library";
import { gamesTabOf, type GamesTab } from "./gamesTab";

/**
 * One Games workspace with three deliberately user-facing views:
 *
 * - On this PS5 (`ready`): titles registered with the PS5 and actionable now,
 *   with what was played lately at the top (the old Game Activity screen).
 * - Everything (`all`): the whole library on this computer's drives and shares
 *   (the old Collection screen).
 * - Game files (`files`): folders and disk images stored on console-attached storage.
 *
 * The old "Library" / "Installed Apps" / "Collection" set exposed implementation
 * details as sibling destinations and made users guess which inventory they
 * needed. Keeping the inventories is useful; naming and locating them by intent
 * is what removes the ambiguity.
 *
 * The views are chips (the shared Tabs), selected by `?tab=` so a link, a
 * refresh or Back lands on the same one.
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
    ready: tr("games_tab_on_ps5", undefined, "On this PS5"),
    all: tr("games_tab_all", undefined, "Everything"),
    files: tr("games_tab_files", undefined, "Game files"),
  };
  return (
    <div className="app-page flex h-full flex-col">
      <PageHeader
        icon={Gamepad2}
        title={label}
        description={
          tab === "all"
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
          { id: "ready", icon: Gamepad2, label: tabLabel.ready },
          { id: "all", icon: Library, label: tabLabel.all },
          { id: "files", icon: FolderArchive, label: tabLabel.files },
        ]}
      />
      <div role="tabpanel" aria-label={tabLabel[tab]} className="min-h-0 flex-1">
        {tab === "files" ? (
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
