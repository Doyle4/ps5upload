import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Expand, Gamepad2, Play, Square } from "lucide-react";

import { Button, Callout, Select, Spinner } from "../../components";
import { useTr } from "../../state/lang";
import { useRosterStore } from "../../state/roster";
import {
  RemotePlayStream,
  canStream,
  mergePads,
  padFromGamepads,
  padFromKeys,
  touchAt,
  keysFor,
  loadKeymap,
  rebind,
  saveKeymap,
  DEFAULT_KEYMAP,
  PAD_ACTIONS,
  type KeyAction,
  type StreamError,
  type StreamPhase,
  type StreamStats,
} from "../../lib/remotePlayStream";

type Tr = ReturnType<typeof useTr>;

/** The plain-English line for an error from the engine or the decoder. */
export function streamErrorMessage(tr: Tr, e: StreamError): string {
  switch (e.code) {
    case "busy":
      return tr(
        "rp_err_busy",
        { s: e.retryS ?? 30 },
        `The PS5 is still finishing the last Remote Play session. Try again in ${e.retryS ?? 30} s.`,
      );
    case "asleep":
    case "wake_failed":
      return tr(
        "rp_err_wake",
        undefined,
        "The PS5 is in rest mode and did not wake. Check that it is plugged in and that Settings › System › Power Saving › Features Available in Rest Mode has Stay Connected to the Internet and Enable Turning On PS5 from Network on.",
      );
    case "unreachable":
      return tr(
        "rp_err_unreachable",
        undefined,
        "The PS5 does not answer on the network. Check that it is on, on the same network, and that Remote Play is enabled in its settings.",
      );
    case "keys":
      return tr(
        "rp_err_keys",
        undefined,
        "The PS5 did not accept this app's pairing. Set up Wake & sign in again for this console.",
      );
    case "passcode":
      return tr(
        "rp_err_passcode",
        undefined,
        "This PS5 user has a sign-in passcode. Remote Play from here cannot enter it; remove the passcode or sign in on the console first.",
      );
    case "video_refused":
      return tr("rp_err_video", undefined, "The PS5 refused that picture size. Try 720p.");
    case "decode":
      return tr("rp_err_decode", undefined, "This device could not decode the picture.");
    case "socket":
      return tr("rp_err_socket", undefined, "The connection to the engine dropped.");
    default:
      return tr("rp_err_other", undefined, "The stream stopped.");
  }
}

function phaseText(tr: Tr, p: StreamPhase): string {
  switch (p) {
    case "connecting":
      return tr("rp_phase_connecting", undefined, "Connecting…");
    case "waking":
      return tr("rp_phase_waking", undefined, "Waking the PS5 (about 20 s)…");
    case "starting":
      return tr("rp_phase_starting", undefined, "Starting the stream…");
    default:
      return "";
  }
}

/** A key code as people say it: KeyQ → Q, Digit1 → 1, ArrowUp → ↑. */
export function keyLabel(code: string): string {
  const arrows: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  return arrows[code] ?? code.replace(/^Key/, "").replace(/^Digit/, "").replace("Backquote", "`");
}

/** Change which key does what, saved on this device. */
function KeyRemap({
  keymap,
  onChange,
}: {
  keymap: Record<string, KeyAction>;
  onChange: (k: Record<string, KeyAction> | null) => void;
}) {
  const tr = useTr();
  const [listening, setListening] = useState<string | null>(null);

  useEffect(() => {
    if (!listening) return;
    const action = PAD_ACTIONS.find((a) => a.id === listening)?.action;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setListening(null);
      // Esc only cancels: the browser keeps it for leaving pointer lock and full screen.
      if (e.code === "Escape" || !action) return;
      onChange(rebind(keymap, action, e.code));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, keymap, onChange]);

  return (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {PAD_ACTIONS.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2">
            <span>{tr(`rp_action_${a.id}`, undefined, a.label)}</span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[var(--color-text)]">
                {keysFor(keymap, a.action).map(keyLabel).join(", ") || "—"}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setListening(a.id)}>
                {listening === a.id ? tr("rp_press_a_key", undefined, "Press a key…") : tr("rp_set_key", undefined, "Set key")}
              </Button>
            </span>
          </div>
        ))}
      </div>
      <Button size="sm" onClick={() => onChange(null)}>
        {tr("rp_keys_reset", undefined, "Reset to defaults")}
      </Button>
    </div>
  );
}

/**
 * Play: stream a console's screen into the app and play it with a controller or the
 * keyboard. Uses the Wake & sign in keys stored for the console (never shown); a console
 * without them is pointed at that setup instead.
 */
export function StreamPanel() {
  const tr = useTr();
  const navigate = useNavigate();
  const profiles = useRosterStore((s) => s.profiles);
  const activeId = useRosterStore((s) => s.active_id);
  const [profileId, setProfileId] = useState<string>(activeId ?? profiles[0]?.id ?? "");
  const [res, setRes] = useState("1920x1080");
  const [phase, setPhase] = useState<StreamPhase | null>(null);
  const [error, setError] = useState<StreamError | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<RemotePlayStream | null>(null);
  const held = useRef(new Set<string>());
  const [keymap, setKeymap] = useState<Record<string, KeyAction>>(loadKeymap);
  // The stream reads the map from outside React (key events, the frame loop).
  const keymapRef = useRef(keymap);
  useEffect(() => {
    keymapRef.current = keymap;
  }, [keymap]);
  const changeKeymap = useCallback((k: Record<string, KeyAction> | null) => {
    saveKeymap(k);
    setKeymap(k ?? DEFAULT_KEYMAP);
  }, []);
  const touch = useRef<[number, number] | null>(null);
  const [light, setLight] = useState<[number, number, number] | null>(null);

  const profile = useMemo(() => profiles.find((p) => p.id === profileId) ?? null, [profiles, profileId]);
  const paired = !!(profile?.wake_regist_key && profile?.wake_rp_key);
  const running = phase !== null && phase !== "ended";

  const stop = useCallback(() => {
    stream.current?.stop();
  }, []);

  // Leaving the screen ends the stream (and so the console's session).
  useEffect(() => () => stream.current?.stop(), []);

  const start = useCallback(async () => {
    if (!profile?.wake_regist_key || !profile.wake_rp_key || !canvas.current) return;
    const [width, height] = res.split("x").map(Number);
    setError(null);
    setStats(null);
    const s = new RemotePlayStream({
      host: profile.host,
      registKey: profile.wake_regist_key,
      rpKey: profile.wake_rp_key,
      width,
      height,
      canvas: canvas.current,
      onPhase: (p) => {
        setPhase(p);
        if (p === "ended") stream.current = null;
      },
      onStats: setStats,
      onError: setError,
      onLight: setLight,
      readPad: () => ({
        ...mergePads(padFromKeys(held.current, keymapRef.current), padFromGamepads(navigator.getGamepads?.() ?? [])),
        touch: touch.current,
      }),
    });
    stream.current = s;
    setPhase("connecting");
    await s.start();
    stage.current?.focus();
  }, [profile, res]);

  const onKey = useCallback((e: React.KeyboardEvent, down: boolean) => {
    if (!keymapRef.current[e.code]) return;
    e.preventDefault();
    if (down) held.current.add(e.code);
    else held.current.delete(e.code);
    stream.current?.sendPad();
  }, []);

  // Shift + drag on the picture is a finger on the touchpad (for games that use it, like
  // maps and menus); the position on the picture is the position on the pad.
  const onPointer = useCallback((e: React.PointerEvent, kind: "down" | "move" | "up") => {
    if (kind === "up") {
      if (!touch.current) return;
      touch.current = null;
    } else {
      if (kind === "down" && !e.shiftKey) return;
      if (kind === "move" && !touch.current) return;
      const r = e.currentTarget.getBoundingClientRect();
      touch.current = touchAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    }
    stream.current?.sendPad();
  }, []);

  const fullscreen = useCallback(() => {
    void stage.current?.requestFullscreen?.();
  }, []);

  // Clicking the picture captures the keyboard and hides the pointer; the browser keeps Esc
  // for giving them back, so Circle is Backspace while captured.
  const capture = useCallback(() => {
    stage.current?.focus();
    void stage.current?.requestPointerLock?.();
  }, []);

  if (!canStream()) {
    return (
      <Callout tone="warn" title={tr("rp_no_webcodecs", undefined, "This browser cannot play a stream")}>
        {tr(
          "rp_no_webcodecs_body",
          undefined,
          "Remote Play here decodes video with WebCodecs, which this browser does not have. Use a current Chrome, Edge or Safari, or the desktop app on Windows or macOS.",
        )}
      </Callout>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Select
          label={tr("rp_console", undefined, "Console")}
          block={false}
          className="w-full sm:w-72"
          value={profileId}
          disabled={running}
          onChange={(e) => setProfileId(e.target.value)}
          options={profiles.map((p) => ({ value: p.id, label: `${p.name} (${p.host})` }))}
        />
        <Select
          label={tr("rp_quality", undefined, "Picture")}
          block={false}
          className="w-32"
          value={res}
          disabled={running}
          onChange={(e) => setRes(e.target.value)}
          options={[
            { value: "1920x1080", label: "1080p" },
            { value: "1280x720", label: "720p" },
          ]}
        />
        {running ? (
          <Button variant="danger" size="md" onClick={stop}>
            <Square size={14} />
            {tr("rp_stop", undefined, "Stop")}
          </Button>
        ) : (
          <Button variant="primary" size="md" onClick={() => void start()} disabled={!paired}>
            <Play size={14} />
            {tr("rp_start", undefined, "Start")}
          </Button>
        )}
        <Button variant="ghost" size="md" onClick={fullscreen} disabled={!running}>
          <Expand size={14} />
          {tr("rp_fullscreen", undefined, "Full screen")}
        </Button>
      </div>

      {profile && !paired && (
        <Callout
          tone="info"
          title={tr("rp_not_paired", undefined, "Set up Wake & sign in for this console first")}
          action={
            <Button size="sm" onClick={() => navigate("/connection")}>
              {tr("rp_open_connection", undefined, "Open Connection")}
            </Button>
          }
        >
          {tr(
            "rp_not_paired_body",
            undefined,
            "That pairs this app with the PS5 once. The same keys then start a stream; nothing else is needed.",
          )}
        </Callout>
      )}

      {error && <Callout tone="error" title={streamErrorMessage(tr, error)}>{error.detail}</Callout>}

      <div
        ref={stage}
        tabIndex={0}
        onKeyDown={(e) => onKey(e, true)}
        onKeyUp={(e) => onKey(e, false)}
        onBlur={() => {
          held.current.clear();
          stream.current?.sendPad();
        }}
        onClick={running ? (e) => !e.shiftKey && capture() : undefined}
        onPointerDown={(e) => onPointer(e, "down")}
        onPointerMove={(e) => onPointer(e, "move")}
        onPointerUp={(e) => onPointer(e, "up")}
        onPointerLeave={(e) => onPointer(e, "up")}
        className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-card)] bg-black outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        data-testid="rp-stage"
      >
        <canvas ref={canvas} className="h-full w-full object-contain" />
        {running && phase !== "playing" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
            <Spinner size={16} tone="inherit" />
            {phaseText(tr, phase)}
          </div>
        )}
        {!running && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/60">
            <Gamepad2 size={28} />
            {tr("rp_idle", undefined, "Press Start to play this PS5 here.")}
          </div>
        )}
        {phase === "playing" && stats && (
          <div
            className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-2 py-1 font-mono text-[11px] leading-4 text-white/85"
            data-testid="rp-stats"
          >
            {light && (
              <span
                className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                style={{ background: `rgb(${light[0]},${light[1]},${light[2]})` }}
                title={tr("rp_light_bar", undefined, "Light bar")}
              />
            )}
            {(() => {
              const v = {
                fps: stats.fps,
                mbps: stats.mbps.toFixed(1),
                ms: stats.decodeMs.toFixed(1),
                codec: stats.codec.startsWith("hev") || stats.codec.startsWith("hvc") ? "HEVC" : "H.264",
                loss: stats.lossPct.toFixed(2),
              };
              return tr(
                "rp_stats_line",
                v,
                `${v.fps} fps · ${v.mbps} Mbit/s · ${v.ms} ms · ${v.codec} · loss ${v.loss}%`,
              );
            })()}
          </div>
        )}
      </div>

      <details className="text-xs text-[var(--color-muted)]">
        <summary className="cursor-pointer">{tr("rp_keys_title", undefined, "Keyboard controls")}</summary>
        <p className="mt-1">
          {tr(
            "rp_keys_body",
            undefined,
            "Click the picture to capture the keyboard and hide the pointer; Esc gives them back. Shift + drag on the picture is a finger on the touchpad. A controller works too: plug it in or pair it with this device.",
          )}
        </p>
        <KeyRemap keymap={keymap} onChange={changeKeymap} />
      </details>
    </div>
  );
}
