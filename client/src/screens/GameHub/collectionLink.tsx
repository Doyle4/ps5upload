// An installed game ↔ the Collection: what this computer has of it (a newer update, missing DLC,
// or just a copy), and the actions that follow from it. Read straight from the Collection store.

import { useEffect } from "react";
import { Download, HardDriveDownload } from "lucide-react";

import type { InstalledTitle } from "../../api/ps5";
import type { OverflowMenuItem } from "../../components/OverflowMenu";
import { copyToCollection } from "../../lib/collectionActions";
import { smpMountImageBasename } from "../../lib/mountPaths";
import { loadCollection, useCollectionStore } from "../../state/collection";
import { useTr } from "../../state/lang";
import { pushNotification } from "../../state/notifications";
import { installOffers } from "./collectionInstall";

/** Reads the Collection once, when nothing has yet: whether it already has a game decides
 *  whether "Copy to Collection" is offered. */
export function useCollectionLoaded(): void {
  useEffect(() => {
    if (!useCollectionStore.getState().library) void loadCollection();
  }, []);
}

function useLink(host: string, titleId: string) {
  const id = titleId.toUpperCase();
  const state = useCollectionStore((s) => s.consoleByHost[host]?.states?.[id]);
  const game = useCollectionStore((s) => s.library?.games?.[id]);
  return { state, game };
}

/** The card menu's Collection items: install a newer update or missing DLC from this computer,
 *  or copy a game the console runs from a folder or image into the Collection. A game installed
 *  from a package has no such item: its installed files are encrypted, so a copy of them would
 *  not install or convert anywhere. */
export function useCollectionItems(
  host: string,
  title: InstalledTitle,
  /** Only "Copy to Collection": the game page offers the installs on its console rows. */
  { copyOnly = false }: { copyOnly?: boolean } = {},
): OverflowMenuItem[] {
  const tr = useTr();
  const { state, game } = useLink(host, title.titleId);
  const items: OverflowMenuItem[] = [];
  const queue = (offers: NonNullable<typeof state>["dlc_missing"]) => {
    const n = installOffers(
      host,
      offers.map((offer) => ({ game: { title: title.titleName }, offer })),
    );
    pushNotification(
      "info",
      tr("collection.queued", { n }, "{n} packages queued for install"),
      {
        link: "/send",
      },
    );
  };
  if (!copyOnly && state?.installed && state.update) {
    const update = state.update;
    items.push({
      label: tr(
        "collection.install_update",
        { v: update.version },
        "Install update {v}",
      ),
      icon: <Download size={12} />,
      onSelect: () => queue([update]),
    });
  }
  if (!copyOnly && state?.installed && state.dlc_missing.length > 0) {
    const dlc = state.dlc_missing;
    items.push({
      label: tr(
        "collection.install_dlc",
        { n: dlc.length },
        "Install missing DLC ({n})",
      ),
      icon: <Download size={12} />,
      onSelect: () => queue(dlc),
    });
  }
  // A ShadowMount+ mount point names only the image, not where it is: nothing to copy from.
  const source = title.source;
  if (
    !game &&
    source &&
    source.startsWith("/") &&
    !smpMountImageBasename(source)
  ) {
    items.push({
      label: tr(
        "installed_copy_to_collection",
        undefined,
        "Copy to Collection",
      ),
      icon: <HardDriveDownload size={12} />,
      title: tr(
        "installed_copy_to_collection_hint",
        undefined,
        "Download the folder or image this game runs from into your Collection on this computer.",
      ),
      onSelect: () =>
        void copyToCollection({
          host,
          path: source,
          kind: title.imageBacked ? "file" : "folder",
          label: title.titleName,
          doneTitle: tr(
            "collection.copied_title",
            { title: title.titleName },
            "{title} is in your Collection",
          ),
          failedTitle: tr(
            "collection.copy_failed",
            undefined,
            "Copy to Collection failed",
          ),
        }).then((ok) => {
          if (!ok)
            pushNotification(
              "warning",
              tr(
                "collection.no_local_root",
                undefined,
                "Add a folder on this computer to the Collection first.",
              ),
              { link: "/games?tab=all" },
            );
        }),
    });
  }
  return items;
}
