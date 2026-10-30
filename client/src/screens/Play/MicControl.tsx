import { useEffect, useState, useSyncExternalStore } from "react";
import { Mic, MicOff } from "lucide-react";

import { Toggle } from "../../components";
import { micSupported, rpMic, type MicState } from "../../lib/remotePlayMic";
import { useTr } from "../../state/lang";
import { useRemotePlayStore } from "../../state/remotePlay";

// The mic belongs to one stream: it goes off when that stream ends, moves to another window,
// or another stream replaces it (the engine turns the console's mic off then as well).
useRemotePlayStore.subscribe((s, prev) => {
  if (rpMic.state === "off") return;
  if (s.stream !== prev.stream || s.phase === "ended" || s.phase === "moved" || s.phase === "error") {
    rpMic.stop();
  }
});

function useMic() {
  const tr = useTr();
  const stream = useRemotePlayStore((s) => s.stream);
  const state = useSyncExternalStore(rpMic.subscribe, rpMic.getState);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    void micSupported().then((v) => alive && setOk(v));
    return () => {
      alive = false;
    };
  }, []);
  const on = state === "live" || state === "starting";
  const toggle = () => {
    if (on) rpMic.stop();
    else if (stream) void rpMic.start(stream);
  };
  const label = micLabel(tr, state);
  // Only for a session started with Settings › Microphone on.
  return { ok: ok && !!stream?.micEnabled, state, on, toggle, label };
}

function micLabel(tr: ReturnType<typeof useTr>, s: MicState): string {
  if (s === "live" || s === "starting") return tr("rp_mic_turn_off", undefined, "Turn the microphone off");
  if (s === "denied")
    return tr(
      "rp_mic_denied",
      undefined,
      "Microphone blocked. Allow it in the browser or system settings, then try again.",
    );
  if (s === "error") return tr("rp_mic_failed", undefined, "The microphone could not start. Press to try again.");
  return tr("rp_mic_turn_on", undefined, "Microphone (experimental)");
}

/** Settings › Microphone (experimental). Off by default; a session started with it on is
 *  set up for the mic and shows the button. */
export function MicSetting() {
  const tr = useTr();
  const on = useRemotePlayStore((s) => s.prefs.mic);
  const setPrefs = useRemotePlayStore((s) => s.setPrefs);
  return (
    <Toggle
      checked={on}
      onChange={(v) => {
        if (!v) rpMic.stop();
        setPrefs({ mic: v });
      }}
      label={tr("rp_mic_setting", undefined, "Microphone (experimental)")}
      hint={tr(
        "rp_mic_setting_hint",
        undefined,
        "Adds a mic button for voice chat. Not yet tested on a PS5. Applies from the next start.",
      )}
    />
  );
}

/** Live: a red dot on the icon; blocked or failed: an amber one. */
function MicIcon({ state, size }: { state: MicState; size: number }) {
  const on = state === "live" || state === "starting";
  const dot =
    state === "live"
      ? "bg-[var(--color-danger,#dc2626)] animate-pulse"
      : state === "starting"
        ? "bg-white/60"
        : state === "denied" || state === "error"
          ? "bg-amber-400"
          : null;
  return (
    <span className="relative inline-flex">
      {on ? <Mic size={size} /> : <MicOff size={size} />}
      {dot && <span className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ${dot}`} aria-hidden />}
    </span>
  );
}

/** The microphone on the picture's bar (windowed and full screen). Hidden where the browser
 *  cannot encode Opus the console's way. */
export function MicBarButton() {
  const { ok, state, on, toggle, label } = useMic();
  if (!ok) return null;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      data-testid="rp-mic"
      data-state={state}
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20 ${on ? "bg-white/25" : "bg-black/40"}`}
    >
      <MicIcon state={state} size={16} />
    </button>
  );
}

/** The microphone as a tile in the touch player's menu. */
export function MicTile() {
  const tr = useTr();
  const { ok, state, on, toggle, label } = useMic();
  if (!ok) return null;
  const short =
    state === "live"
      ? tr("rp_mic_live", undefined, "Mic live")
      : state === "denied" || state === "error"
        ? tr("rp_mic_blocked_short", undefined, "Mic off")
        : tr("rp_mic_short", undefined, "Mic (experimental)");
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      data-testid="rp-mic"
      data-state={state}
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-xs font-medium leading-tight text-white transition-colors ${
        on ? "bg-white/25 hover:bg-white/30" : "bg-white/10 hover:bg-white/20"
      }`}
    >
      <MicIcon state={state} size={18} />
      <span className="line-clamp-2 break-words">{short}</span>
    </button>
  );
}
