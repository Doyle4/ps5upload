import { useMemo } from "react";
import { HardDriveUpload } from "lucide-react";

import { Card, Spinner } from "../../components";
import {
  entryTitleId,
  libraryForHost,
  useLibraryStore,
} from "../../state/library";
import { useTr } from "../../state/lang";
import { DriveRows, FpkgKstuffTip } from "./DriveRow";

/**
 * This game's files on the connected PS5's drives: its game folders and the disk images it
 * comes from (a registered image, or one mounted with the game inside), one row each with
 * every action a row offers. Hidden when the drives hold none of it.
 */
export function Ps5DrivesCard({ host, titleId }: { host: string; titleId: string }) {
  const tr = useTr();
  const slot = useLibraryStore((s) => libraryForHost(s, host));
  const rows = useMemo(() => {
    const want = titleId.toUpperCase();
    return (slot.entries ?? [])
      .filter((e) => entryTitleId(e, slot)?.toUpperCase() === want)
      .sort((a, b) => Number(a.kind === "game") - Number(b.kind === "game"));
  }, [slot, titleId]);
  if (rows.length === 0) return null;
  const images = rows.some((e) => e.kind === "image");
  return (
    <Card>
      <h2 className="mb-4 flex items-center gap-3 text-[1.0625rem] font-semibold tracking-[-0.01em]">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent-bright)]">
          <HardDriveUpload size={15} aria-hidden />
        </span>
        {tr("game_ps5_drives_title", { n: rows.length }, "On the PS5's drives ({n})")}
        {slot.loading && <Spinner size={14} />}
      </h2>
      {images && (
        <>
          <p className="mb-2 text-xs text-[var(--color-muted)]">
            {tr(
              "library_images_capabilities",
              undefined,
              "Mount to play a game, or Edit files to change what's inside it — adding DLC, swapping assets, or applying a backport patch. Edits are written straight into the image.",
            )}
          </p>
          <FpkgKstuffTip />
        </>
      )}
      <div data-testid="game-ps5-drives">
        <DriveRows entries={rows} host={host} />
      </div>
    </Card>
  );
}
