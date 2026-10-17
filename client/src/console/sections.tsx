import type { ReactNode } from "react";
import { Folder, House, Settings, type LucideIcon } from "lucide-react";
import { Home } from "./home/Home";
import type { ConsoleStatus } from "./shell/TopBar";
import { t } from "./strings";

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
  /** The params this section was opened with, or null. */
  params: SectionParams | null;
}

/** One entry of the Rail. Only implemented sections are listed. */
export interface Section {
  id: string;
  icon: LucideIcon;
  labelKey: string;
  render: (ctx: SectionContext) => ReactNode;
  /** It reads ctx.params, so other sections may open it at a place (Home's Browse USB → Files). */
  acceptsParams?: boolean;
}

/** A section whose screen is not built yet: its heading only. */
function Placeholder({ labelKey }: { labelKey: string }) {
  return <h1 className="cw-h1">{t(labelKey)}</h1>;
}

// Tasks 9–10 replace these renders with the Files and Settings screens. Files
// sets acceptsParams once it opens at ctx.params.path: until then Home hides
// Browse USB.
export const SECTIONS: Section[] = [
  {
    id: "home",
    icon: House,
    labelKey: "cw_nav_home",
    render: (ctx) => <Home ctx={ctx} />,
  },
  {
    id: "files",
    icon: Folder,
    labelKey: "cw_nav_files",
    render: () => <Placeholder labelKey="cw_nav_files" />,
  },
  {
    id: "settings",
    icon: Settings,
    labelKey: "cw_nav_settings",
    render: () => <Placeholder labelKey="cw_nav_settings" />,
  },
];
