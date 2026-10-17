import type { ReactNode } from "react";
import { Folder, House, Settings, type LucideIcon } from "lucide-react";
import { t } from "./strings";

/** One entry of the Rail. Only implemented sections are listed. */
export interface Section {
  id: string;
  icon: LucideIcon;
  labelKey: string;
  render: () => ReactNode;
}

/** A section whose screen is not built yet: its heading only. */
function Placeholder({ labelKey }: { labelKey: string }) {
  return <h1 className="cw-h1">{t(labelKey)}</h1>;
}

// Tasks 8–10 replace these renders with the Home, Files and Settings screens.
export const SECTIONS: Section[] = [
  { id: "home", icon: House, labelKey: "cw_nav_home", render: () => <Placeholder labelKey="cw_nav_home" /> },
  { id: "files", icon: Folder, labelKey: "cw_nav_files", render: () => <Placeholder labelKey="cw_nav_files" /> },
  {
    id: "settings",
    icon: Settings,
    labelKey: "cw_nav_settings",
    render: () => <Placeholder labelKey="cw_nav_settings" />,
  },
];
