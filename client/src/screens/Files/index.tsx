// Files (8.0.1): the console's file system and Mesh Drive, a tab each. Both stay mounted (the
// hidden one is paused, not thrown away), so a folder being browsed or a dialog half-filled in
// one survives a look at the other.

import { Activity, lazy } from "react";
import { useSearchParams } from "react-router";
import { FolderSync, FolderTree } from "lucide-react";

import { Tabs } from "../../components";
import { useTr } from "../../state/lang";
import FileSystemScreen from "../FileSystem";

const MeshDriveTab = lazy(() => import("../MeshDrive"));

export type FilesTab = "console" | "mesh";

export function filesTabOf(params: URLSearchParams): FilesTab {
  return params.get("tab") === "mesh" ? "mesh" : "console";
}

export default function FilesScreen() {
  const tr = useTr();
  const [params, setParams] = useSearchParams();
  const tab = filesTabOf(params);
  const tabs = (
    <Tabs
      className="mb-4"
      variant="segmented"
      ariaLabel={tr("v5_tab_files", undefined, "File System")}
      value={tab}
      onChange={(id) =>
        setParams(
          (p) => {
            const next = new URLSearchParams(p);
            if (id === "mesh") next.set("tab", "mesh");
            else next.delete("tab");
            return next;
          },
          { replace: true },
        )
      }
      tabs={[
        { id: "console", label: tr("files_tab_console", undefined, "Console"), icon: FolderTree },
        { id: "mesh", label: tr("drive_title", undefined, "Mesh Drive"), icon: FolderSync },
      ]}
    />
  );
  return (
    <>
      <Activity mode={tab === "console" ? "visible" : "hidden"}>
        <FileSystemScreen tabs={tabs} />
      </Activity>
      {tab === "mesh" && <MeshDriveTab tabs={tabs} />}
    </>
  );
}
