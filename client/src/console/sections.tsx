import type { ReactNode } from "react";
import { Activity, Eraser, Fan as FanIcon, Folder, Gamepad2, House, LibraryBig, Settings, Sparkles, type LucideIcon } from "lucide-react";
import { Cleanup } from "./cleanup/Cleanup";
import { Cheats } from "./cheats/Cheats";
import { Fan } from "./fan/Fan";
import { Files } from "./files/Files";
import { Games } from "./games/Games";
import { Home } from "./home/Home";
import { Library } from "./library/Library";
import { Processes } from "./processes/Processes";
import { Settings as SettingsSection } from "./settings/Settings";
import type { ConsoleStatus } from "./shell/TopBar";

/** What a section is opened with, e.g. Files at {path: "/mnt/usb0"}. */
export type SectionParams = Record<string, string>;

/** What App hands every section. */
export interface SectionContext {
  /** The last /api/status answer (App polls it for the console chip). */
  status: ConsoleStatus | null;
  /** Read /api/status again now (after closing a game). */
  refreshStatus: () => void;
  /** Switch to section `id`, opened with `params`. */
  openSection: (id: string, params?: SectionParams) => void;
  /** Whether section `id` exists and reads params (e.g. Files at a path). */
  canOpen: (id: string) => boolean;
  /** Whether section `id` is registered (Home hides the Cheats shortcut until it is). */
  hasSection: (id: string) => boolean;
  /** The params this section was opened with, or null. */
  params: SectionParams | null;
  /** Open the Controls screen (Settings). */
  openControls?: () => void;
  /** Show the first-run tips again (Settings). */
  showTips?: () => void;
}

/** One entry of the Rail. Only implemented sections are listed. */
export interface Section {
  id: string;
  icon: LucideIcon;
  labelKey: string;
  render: (ctx: SectionContext) => ReactNode;
  /** It reads ctx.params, so other sections may open it at a place (Home's drive cards → Files). */
  acceptsParams?: boolean;
}

// Registry: Home, Games (installed titles), Library (games on shares and drives, #498), Files, Cheats (the running game's), Fan, Processes, Clean up, Settings. Files opens at ctx.params.path
// (acceptsParams), so Home's drive cards open it at a drive.
export const SECTIONS: Section[] = [
  {
    id: "home",
    icon: House,
    labelKey: "cw_nav_home",
    render: (ctx) => <Home ctx={ctx} />,
  },
  {
    id: "games",
    icon: Gamepad2,
    labelKey: "cw_games_title",
    render: (ctx) => <Games ctx={ctx} />,
  },
  {
    id: "library",
    icon: LibraryBig,
    labelKey: "cw_lib_title",
    render: () => <Library />,
  },
  {
    id: "files",
    icon: Folder,
    labelKey: "cw_nav_files",
    render: (ctx) => <Files ctx={ctx} />,
    acceptsParams: true,
  },
  {
    id: "cheats",
    icon: Sparkles,
    labelKey: "cw_cheats_title",
    render: () => <Cheats />,
  },
  {
    id: "fan",
    icon: FanIcon,
    labelKey: "cw_fan_title",
    render: () => <Fan />,
  },
  {
    id: "processes",
    icon: Activity,
    labelKey: "cw_procs_title",
    render: (ctx) => <Processes ctx={ctx} />,
  },
  {
    id: "cleanup",
    icon: Eraser,
    labelKey: "cw_cleanup_title",
    render: (ctx) => <Cleanup ctx={ctx} />,
  },
  {
    id: "settings",
    icon: Settings,
    labelKey: "cw_nav_settings",
    render: (ctx) => <SettingsSection onOpenControls={ctx.openControls} onShowTips={ctx.showTips} />,
  },
];
