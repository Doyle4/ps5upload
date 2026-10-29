import { Send as SendIcon } from "lucide-react";

import { ConsoleChip, PageHeader } from "../../components";
import { useConnectionStore } from "../../state/connection";
import { useTr } from "../../state/lang";
import InstallPackageScreen from "../InstallPackage";
import UploadScreen from "../Upload";
import { SendIntro } from "./SendIntro";

/**
 * Send to PS5: every way something gets onto the console, on one page, top to bottom. It
 * opens with the three jobs it does (SendIntro): install a package, copy a game or files,
 * install from a link or a drive.
 *
 * 1. From this computer or a saved server: pick or drop anything (a game folder, an image, an
 *    archive, a package, any file); the app works out what it is and offers what fits it, a
 *    package's Stream & install included.
 * 2. From a link, or an archive of packages.
 * 3. The one queue, for this console.
 * 4. Already on the PS5: packages on a USB drive and package copies put there before.
 *
 * Upload and Install Package were two screens that both installed packages (both offered
 * Stream & install and Upload & install), so people had to know which one their file
 * belonged to. Old /upload and /install-package links land here.
 */
export default function SendScreen() {
  const tr = useTr();
  const host = useConnectionStore((s) => s.host);
  return (
    <div className="app-page">
      <PageHeader
        icon={SendIcon}
        title={tr("send_title", undefined, "Send to PS5")}
        description={tr(
          "send_description2",
          undefined,
          "Install packages on the PS5, and copy games and files to it.",
        )}
        right={<ConsoleChip addr={host} />}
      />
      <SendIntro />
      <UploadScreen embedded />
      <InstallPackageScreen embedded />
    </div>
  );
}
