import { useCallback, useState } from "react";
import { PackagePlus } from "lucide-react";

import { useWebviewDropAll } from "../../../lib/useWebviewDrop";
import { isTauriEnv } from "../../../lib/tauriEnv";
import { useTr } from "../../../state/lang";
import { useStreamDrops } from "./streamDrops";

const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Drop a package on the picture to install it on the streamed console: a drop zone while a
 *  drag is over the window, then the choice (when the stream ends, by default, or now). The
 *  desktop app gets paths from the window; the web UI gets files from the page (`webProps`). */
export function useStreamDropZone(host: string | null, on: boolean) {
  const drop = useStreamDrops((s) => s.drop);
  const desktopActive = useWebviewDropAll(
    (paths) => {
      if (host) drop(paths.map((path) => ({ path, name: nameOf(path), host })));
    },
    on && !!host,
  );
  const [webActive, setWebActive] = useState(false);
  const web = on && !!host && !isTauriEnv();
  const webProps = web
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault();
          setWebActive(true);
        },
        onDragLeave: () => setWebActive(false),
        onDrop: (e: React.DragEvent) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          e.stopPropagation();
          setWebActive(false);
          drop(Array.from(e.dataTransfer.files).map((file) => ({ file, name: file.name, host: host! })));
        },
      }
    : {};
  return { active: desktopActive || webActive, webProps };
}

/** The drop zone over the picture while something is dragged over it. */
export function DropZone({ active }: { active: boolean }) {
  const tr = useTr();
  if (!active) return null;
  return (
    <div
      className="pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/60 bg-black/60 text-white"
      data-testid="rp-drop-zone"
    >
      <PackagePlus size={32} aria-hidden />
      <span className="text-sm font-medium">
        {tr("rp_drop_here", undefined, "Drop a package to install it on this PS5")}
      </span>
    </div>
  );
}

/** What to do with packages dropped on the stream: install when the stream ends (an install
 *  shares the network with the stream and can make it stutter), now, or not at all. */
export function DropChoice({ consoleName }: { consoleName: string }) {
  const tr = useTr();
  const asking = useStreamDrops((s) => s.asking);
  const decide = useStreamDrops((s) => s.decide);
  const keep = useCallback((e: { stopPropagation(): void }) => e.stopPropagation(), []);
  if (!asking.length) return null;
  const names = asking.map((p) => p.name).join(", ");
  return (
    <div
      role="dialog"
      aria-label={tr("rp_drop_title", undefined, "Install on this PS5")}
      className="pointer-events-auto absolute left-1/2 top-1/2 z-40 w-[min(26rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-3 rounded-2xl bg-neutral-900/95 p-4 text-sm text-white shadow-2xl ring-1 ring-white/10"
      data-testid="rp-drop-choice"
      onClick={keep}
      onDoubleClick={keep}
      onPointerDown={keep}
      onKeyDown={keep}
      onKeyUp={keep}
    >
      <div className="font-semibold">
        {tr("rp_drop_question", { console: consoleName }, `Install on ${consoleName}?`)}
      </div>
      <div className="break-all text-xs text-white/70">{names}</div>
      <p className="text-xs text-white/70">
        {tr(
          "rp_drop_explain",
          undefined,
          "An install shares the network with the stream and can make it stutter. When you stop playing, it starts by itself.",
        )}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => decide("cancel")}
          className="h-8 rounded-full px-3 text-xs hover:bg-white/10"
          data-testid="rp-drop-cancel"
        >
          {tr("rp_drop_cancel", undefined, "Cancel")}
        </button>
        <button
          type="button"
          onClick={() => decide("now")}
          className="h-8 rounded-full bg-white/10 px-3 text-xs hover:bg-white/20"
          data-testid="rp-drop-now"
        >
          {tr("rp_drop_now", undefined, "Install now")}
        </button>
        <button
          type="button"
          autoFocus
          onClick={() => decide("later")}
          className="h-8 rounded-full bg-[var(--color-accent)] px-3 text-xs font-medium text-white hover:brightness-110"
          data-testid="rp-drop-later"
        >
          {tr("rp_drop_later", undefined, "When I stop playing")}
        </button>
      </div>
    </div>
  );
}
