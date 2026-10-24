// Ready to play ↔ Collection: what this computer has of an installed game (a newer update,
// missing DLC, or just a copy), and the actions that follow from it. Read straight from the
// Collection store per title, so the memoised cards need no new props.

import { useEffect } from "react";
import { Download, HardDrive, HardDriveDownload } from "lucide-react";

import type { InstalledTitle } from "../../api/ps5";
import type { OverflowMenuItem } from "../../components/OverflowMenu";
import { CoverTag } from "../../components/GameIconFrame";
import { copyToCollection } from "../../lib/collectionActions";
import { smpMountImageBasename } from "../../lib/mountPaths";
import {
  loadCollection,
  loadConsoleStates,
  useCollectionStore,
} from "../../state/collection";
import { useTr } from "../../state/lang";
import { pushNotification } from "../../state/notifications";
import { installOffers } from "../GameHub/collectionInstall";

/** Reads the Collection and what it holds for `host` once the screen has a console. */
export function useCollectionForConsole(host: string, up: boolean): void {
  useEffect(() => {
    void (async () => {
      if (!useCollectionStore.getState().library) await loadCollection();
      if (host && up && useCollectionStore.getState().library)
        await loadConsoleStates(host);
    })();
  }, [host, up]);
}

function useLink(host: string, titleId: string) {
  const id = titleId.toUpperCase();
  const state = useCollectionStore((s) => s.consoleByHost[host]?.states[id]);
  const game = useCollectionStore((s) => s.library?.games[id]);
  return { state, game };
}

/** "Update 1.05 here" / "In Collection": on the card's cover. */
export function CollectionTag({
  host,
  titleId,
}: {
  host: string;
  titleId: string;
}) {
  const tr = useTr();
  const { state, game } = useLink(host, titleId);
  if (state?.installed && state.update) {
    return (
      <CoverTag
        tone="accent"
        icon={<HardDriveDownload size={11} aria-hidden />}
        title={tr(
          "installed_coll_update_hint",
          { v: state.update.version },
          "Update {v} is in your Collection on this computer. Install it from ⋯.",
        )}
      >
        {tr("installed_coll_update", { v: state.update.version }, "Update {v}")}
      </CoverTag>
    );
  }
  if (!game) return null;
  return (
    <CoverTag
      tone="neutral"
      icon={<HardDrive size={11} aria-hidden />}
      title={tr(
        "installed_coll_have_hint",
        undefined,
        "A copy of this game is in your Collection on this computer.",
      )}
    >
      {tr("installed_coll_have", undefined, "In Collection")}
    </CoverTag>
  );
}

/** The card menu's Collection items: install a newer update or missing DLC from this computer,
 *  or copy a game the console runs from a folder or image into the Collection. A game installed
 *  from a package has no such item: its installed files are encrypted, so a copy of them would
 *  not install or convert anywhere. */
export function useCollectionItems(
  host: string,
  title: InstalledTitle,
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
        link: "/install-package",
      },
    );
  };
  if (state?.installed && state.update) {
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
  if (state?.installed && state.dlc_missing.length > 0) {
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
              { link: "/collection" },
            );
        }),
    });
  }
  return items;
}
