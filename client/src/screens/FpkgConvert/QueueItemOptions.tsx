// A queued game's own choices (#518): what it becomes and what happens after, changeable while
// it waits, the queue running or not. Card ③ sets them for games as they are added; this is for
// one already in the queue.

import { SegmentedControl } from "../../components/SegmentedControl";
import { Toggle } from "../../components/Toggle";
import { thenFor, type ConvertBuild, type ConvertItem, type ConvertItemChange, type ConvertThen } from "../../state/convertQueue";
import { isArchiveSource, isFolderableSource } from "../../state/fpkgConversion";
import { useTr } from "../../state/lang";

type Kind = ConvertBuild["kind"];

/** What this source can become: a folder only from an image or package; an image from a game
 *  folder, image, package or archive (a file of any other kind cannot). */
export function kindsFor(source: string): Kind[] {
  const file = /\.[a-z0-9]{2,6}$/i.test(source.trim());
  const kinds: Kind[] = ["pkg"];
  if (!file || isFolderableSource(source) || isArchiveSource(source)) kinds.push("image");
  if (isFolderableSource(source)) kinds.push("folder");
  return kinds;
}

/** The change for choosing `kind`: an image keeps its own format choice when it was one. */
export function changeForKind(item: ConvertItem, kind: Kind, canInstall: boolean, host: string | null): ConvertItemChange {
  const build: ConvertBuild =
    kind === "image"
      ? item.build?.kind === "image"
        ? item.build
        : { kind: "image", format: "exfat", compress: false }
      : { kind };
  const then = thenFor(kind, item.then, canInstall);
  return { build, then, host: then !== "keep" ? (item.host ?? host) : null };
}

export function QueueItemOptions({
  item,
  canInstall,
  host,
  onChange,
}: {
  item: ConvertItem;
  canInstall: boolean;
  host: string | null;
  onChange: (change: ConvertItemChange) => void;
}) {
  const tr = useTr();
  const kind: Kind = item.build?.kind ?? "pkg";
  const kinds = kindsFor(item.source);
  const kindLabel: Record<Kind, string> = {
    pkg: tr("cq_opt_pkg", undefined, "Package"),
    image: tr("cq_opt_image", undefined, "Game image"),
    folder: tr("cq_opt_folder", undefined, "Folder"),
  };
  const thens: ConvertThen[] =
    kind === "folder" || !canInstall ? ["keep"] : kind === "image" ? ["keep", "upload"] : ["keep", "stream"];
  const thenLabel: Record<ConvertThen, string> = {
    keep: tr("cq_opt_keep", undefined, "Keep it"),
    stream: tr("cq_opt_install", undefined, "Install on the PS5"),
    upload: tr("cq_opt_upload", undefined, "Upload to the PS5"),
  };
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-sm">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-[var(--color-muted)]">{tr("cq_opt_make", undefined, "Make")}</span>
        <SegmentedControl
          value={kind}
          ariaLabel={tr("cq_opt_make", undefined, "Make")}
          segments={kinds.map((k) => ({ value: k, label: kindLabel[k] }))}
          onChange={(k) => onChange(changeForKind(item, k as Kind, canInstall, host))}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-[var(--color-muted)]">{tr("cq_opt_then", undefined, "Then")}</span>
        <SegmentedControl
          value={thens.includes(item.then) ? item.then : "keep"}
          ariaLabel={tr("cq_opt_then", undefined, "Then")}
          segments={thens.map((t) => ({ value: t, label: thenLabel[t] }))}
          onChange={(t) => {
            const then = t as ConvertThen;
            onChange({ then, host: then !== "keep" ? (item.host ?? host) : null });
          }}
        />
      </div>
      {kind === "pkg" && item.then === "stream" && (
        <Toggle
          checked={!!item.deleteAfterInstall}
          onChange={(checked) => onChange({ deleteAfterInstall: checked })}
          label={tr("cq_opt_delete_after", undefined, "Delete the package once it is installed")}
        />
      )}
    </div>
  );
}
