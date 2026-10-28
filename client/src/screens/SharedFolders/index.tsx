import { FolderSync } from "lucide-react";

import { PageHeader } from "../../components";
import { useTr } from "../../state/lang";
import { ServersSection } from "../Connections";
import { MeshDriveSection } from "../MeshDrive";

/**
 * Shared Folders: every folder the app reaches over the network, on one page.
 *
 * - Servers: your NAS and servers (SMB, FTP, FTPS, SFTP), and the shares the PS5 itself uses.
 * - Mesh Drive: folders kept the same on every device, with their home on this console.
 *
 * They were two screens (Network shares, Mesh Drive). To a user both are "folders that live
 * somewhere else", so they sit together with their own Add button each. Old /connections links
 * (?add=1, ?edit=<id> included) and /mesh-drive land here.
 */
export default function SharedFoldersScreen() {
  const tr = useTr();
  return (
    <div className="app-page space-y-10">
      <PageHeader
        icon={FolderSync}
        title={tr("shared_folders_title", undefined, "Shared Folders")}
        description={tr(
          "shared_folders_description",
          undefined,
          "Folders you reach over the network: your NAS and servers, and Mesh Drives that stay the same on every device.",
        )}
      />
      <ServersSection />
      <MeshDriveSection />
    </div>
  );
}
