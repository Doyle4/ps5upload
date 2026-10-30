import { useEffect, useState } from "react";
import { Expand, RotateCw } from "lucide-react";

import { askMotion, motionAvailable, startMotion } from "../lib/motion";
import { PadClient, type PadLinkStage } from "../lib/padClient";
import { TouchControls } from "../screens/Play/TouchControls";
import { useTr } from "../state/lang";
import { rpInput } from "../state/remotePlay";

type Tr = ReturnType<typeof useTr>;

function stageText(tr: Tr, s: PadLinkStage, computer: string): string {
  switch (s.kind) {
    case "connecting":
      return tr("pad_connecting", undefined, "Connecting…");
    case "asking":
      return tr("pad_asking", { name: computer }, `Waiting for ${computer} to allow this phone…`);
    case "joined":
      return !s.host
        ? tr("pad_no_session", undefined, "Connected. Waiting for Remote Play to start on the computer.")
        : s.playing
          ? tr("pad_playing", { host: s.host }, `Controller for ${s.host}`)
          : tr("pad_starting", undefined, "Connected. The stream is starting…");
    case "refused":
      if (s.why === "denied") return tr("pad_denied", undefined, "The computer said no.");
      if (s.why === "key") return tr("pad_old_code", undefined, "This code has expired. Scan the new one on the computer.");
      if (s.why === "full") return tr("pad_full", undefined, "Four phones are playing already.");
      return tr("pad_refused", undefined, "The computer did not let this phone in.");
    case "lost":
      return tr("pad_lost", undefined, "Lost the connection to the computer.");
  }
}

/** Fill the screen and hold it sideways, where the browser allows (Android Chrome does). */
async function fillScreen(): Promise<void> {
  try {
    await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
  } catch {
    // Not here (iPhone Safari): the page still fills the window.
  }
}

/**
 * A phone as a controller for the Remote Play session another device runs: the on-screen
 * controller full screen and sideways, as when the phone plays itself, and any controller
 * attached to the phone (Backbone, Kishi, GameSir...) plays too.
 */
export function PadApp({ url, computer, onLeave }: { url: string; computer: string; onLeave?: () => void }) {
  const tr = useTr();
  const [stage, setStage] = useState<PadLinkStage>({ kind: "connecting" });
  const [attempt, setAttempt] = useState(0);
  const [portrait, setPortrait] = useState(() => typeof window !== "undefined" && window.innerHeight > window.innerWidth);
  const [light, setLight] = useState<[number, number, number] | null>(null);
  const [client, setClient] = useState<PadClient | null>(null);
  const [motionOn, setMotionOn] = useState(false);

  useEffect(() => {
    if (!motionOn) return;
    const stop = startMotion((m) => {
      rpInput.motion = m;
    });
    return () => {
      stop();
      rpInput.motion = null;
    };
  }, [motionOn]);

  useEffect(() => {
    const c = new PadClient({
      url,
      onStage: setStage,
      touchPad: () => rpInput.touchPad,
      onLight: setLight,
      motion: () => rpInput.motion,
    });
    setClient(c);
    c.start();
    return () => c.stop();
  }, [url, attempt]);

  useEffect(() => {
    const update = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const ended = stage.kind === "refused" || stage.kind === "lost";
  const live = stage.kind === "joined";
  return (
    <div
      className="fixed inset-0 select-none overflow-hidden bg-black text-white [-webkit-touch-callout:none]"
      style={{ touchAction: "none" }}
      data-testid="pad-app"
    >
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 px-3 pt-[max(6px,env(safe-area-inset-top))] text-xs text-white/80">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{
            background: live
              ? light
                ? `rgb(${light[0]},${light[1]},${light[2]})`
                : "var(--color-success,#22c55e)"
              : ended
                ? "var(--color-bad,#ef4444)"
                : "#eab308",
          }}
        />
        <span className="truncate" data-testid="pad-stage">
          {stageText(tr, stage, computer)}
        </span>
        {live && typeof document !== "undefined" && !!document.documentElement.requestFullscreen && !document.fullscreenElement && (
          <button
            type="button"
            onClick={() => void fillScreen()}
            className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-1"
            data-testid="pad-full"
          >
            <Expand size={12} />
            {tr("pad_fill", undefined, "Full screen")}
          </button>
        )}
        {live && motionAvailable() && (
          <button
            type="button"
            onClick={() => {
              if (motionOn) setMotionOn(false);
              else void askMotion().then(setMotionOn);
            }}
            aria-pressed={motionOn}
            className={`rounded-full px-2 py-1 ${motionOn ? "bg-white text-black" : "bg-white/15"}`}
            data-testid="pad-motion"
          >
            {tr("pad_motion", undefined, "Motion")}
          </button>
        )}
        {onLeave && (
          <button type="button" onClick={onLeave} className="rounded-full bg-white/15 px-2 py-1" data-testid="pad-leave">
            {tr("pad_leave", undefined, "Stop being a controller")}
          </button>
        )}
      </div>

      {live && <TouchControls stream={client} layout="overlay" />}

      {live && portrait && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center">
          <span className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white/85">
            <RotateCw size={14} />
            {tr("pad_turn", undefined, "Turn the phone sideways")}
          </span>
        </div>
      )}

      {ended && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm">
          <p className="max-w-sm text-white/85">{stageText(tr, stage, computer)}</p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black"
            data-testid="pad-retry"
          >
            {tr("pad_retry", undefined, "Try again")}
          </button>
        </div>
      )}
    </div>
  );
}
