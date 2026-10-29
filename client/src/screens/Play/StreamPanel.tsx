import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  BarChart3,
  Expand,
  Gamepad2,
  Minimize,
  MonitorPlay,
  Play,
  Settings2,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button, Callout, Select, Spinner, Toggle } from "../../components";
import { useTr } from "../../state/lang";
import { useRosterStore } from "../../state/roster";
import { isTauriEnv } from "../../lib/tauriEnv";
import {
  canStream,
  keysFor,
  rebind,
  stopEngineSession,
  touchAt,
  PAD_ACTIONS,
  type KeyAction,
  type StreamError,
  type StreamPhase,
  type StreamStats,
} from "../../lib/remotePlayStream";
import {
  fetchRunningSession,
  rpInput,
  useRemotePlayStore,
  type RpPrefs,
} from "../../state/remotePlay";
import { TouchControls, useTouchFirst } from "./TouchControls";

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
    case "busy_other":
      return tr(
        "rp_err_busy_other",
        { host: e.host ?? "" },
        `Remote Play is already streaming ${e.host ?? "another console"}. Stop that stream first.`,
      );
    case "socket":
      return tr(
        "rp_err_socket_lost",
        undefined,
        "Lost the connection to the engine and could not get it back within 30 s.",
      );
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
    case "reconnecting":
      return tr("rp_phase_reconnecting", undefined, "Reconnecting…");
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
    <div className="space-y-2">
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

/** The window (desktop app) or the screen (browser) given to the picture. */
async function setWindowFullscreen(on: boolean): Promise<void> {
  try {
    if (isTauriEnv()) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setFullscreen(on);
    } else if (on) {
      await document.documentElement.requestFullscreen?.();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch {
    // Not allowed here: the picture still fills the window.
  }
}

function StatsLine({ stats, light }: { stats: StreamStats; light: [number, number, number] | null }) {
  const tr = useTr();
  const v = {
    fps: stats.fps,
    mbps: stats.mbps.toFixed(1),
    ms: stats.decodeMs.toFixed(1),
    codec: stats.codec.startsWith("hev") || stats.codec.startsWith("hvc") ? "HEVC" : "H.264",
    loss: stats.lossPct.toFixed(2),
    audio: Math.round(stats.audioMs),
  };
  return (
    <div
      className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] leading-4 text-white/85"
      data-testid="rp-stats"
    >
      {light && (
        <span
          className="me-1.5 inline-block h-2 w-2 rounded-full align-middle"
          style={{ background: `rgb(${light[0]},${light[1]},${light[2]})` }}
          title={tr("rp_light_bar", undefined, "Light bar")}
        />
      )}
      {tr(
        "rp_stats_line",
        v,
        `${v.fps} fps · ${v.mbps} Mbit/s · ${v.ms} ms · ${v.codec} · loss ${v.loss}%`,
      )}
      {" · "}
      {tr("rp_stats_audio", { ms: v.audio }, `sound ${v.audio} ms`)}
    </div>
  );
}

/** A round button on the picture's toolbar. */
function BarButton({
  label,
  onClick,
  active,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20 ${active ? "bg-white/25" : "bg-black/40"}`}
    >
      {children}
    </button>
  );
}

/** Everything that can be set, in one place: picture, sound, session, controls, keys. */
function SettingsPanel({ running }: { running: boolean }) {
  const tr = useTr();
  const prefs = useRemotePlayStore((s) => s.prefs);
  const setPrefs = useRemotePlayStore((s) => s.setPrefs);
  const keymap = useRemotePlayStore((s) => s.keymap);
  const setKeymap = useRemotePlayStore((s) => s.setKeymap);
  const num = (v: string) => Number(v);
  return (
    <div
      className="space-y-5 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4"
      data-testid="rp-settings"
    >
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{tr("rp_set_picture", undefined, "Picture")}</h3>
        <div className="flex flex-wrap gap-3">
          <Select
            label={tr("rp_quality", undefined, "Picture")}
            block={false}
            className="w-36"
            value={prefs.res}
            disabled={running}
            onChange={(e) => setPrefs({ res: e.target.value as RpPrefs["res"] })}
            options={[
              { value: "1920x1080", label: "1080p" },
              { value: "1280x720", label: "720p" },
            ]}
          />
          <Select
            label={tr("rp_fps", undefined, "Frame rate")}
            block={false}
            className="w-36"
            value={String(prefs.fps)}
            disabled={running}
            onChange={(e) => setPrefs({ fps: num(e.target.value) as RpPrefs["fps"] })}
            options={[
              { value: "60", label: tr("rp_fps_60", undefined, "60 fps (smooth)") },
              { value: "30", label: tr("rp_fps_30", undefined, "30 fps (light network)") },
            ]}
          />
        </div>
        {running && (
          <p className="text-xs text-[var(--color-muted)]">
            {tr("rp_set_next_start", undefined, "Picture changes apply the next time you start.")}
          </p>
        )}
        <Toggle
          checked={prefs.showStats}
          onChange={(v) => setPrefs({ showStats: v })}
          label={tr("rp_show_stats", undefined, "Show stats on the picture")}
          hint={tr("rp_show_stats_hint", undefined, "Frame rate, bitrate, decode time, loss and sound delay.")}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{tr("rp_set_sound", undefined, "Sound")}</h3>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={tr("rp_audio_buffer", undefined, "Sound buffer")}
            block={false}
            className="w-56"
            value={String(prefs.audioBufferMs)}
            onChange={(e) => setPrefs({ audioBufferMs: num(e.target.value) })}
            options={[
              { value: "40", label: tr("rp_audio_low", undefined, "Lowest delay (40 ms)") },
              { value: "60", label: tr("rp_audio_normal", undefined, "Balanced (60 ms)") },
              { value: "120", label: tr("rp_audio_stable", undefined, "Steady on Wi-Fi (120 ms)") },
            ]}
          />
          <label className="flex min-w-48 flex-col gap-1 text-xs text-[var(--color-muted)]">
            {tr("rp_volume", undefined, "Volume")}
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(prefs.volume * 100)}
              onChange={(e) => setPrefs({ volume: num(e.target.value) / 100, muted: false })}
              className="accent-[var(--color-accent)]"
            />
          </label>
        </div>
        <p className="text-xs text-[var(--color-muted)]">
          {tr(
            "rp_audio_hint",
            undefined,
            "Crackles or gaps on a busy network: choose Steady. On a wired network Lowest delay is best.",
          )}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{tr("rp_set_session", undefined, "Session")}</h3>
        <Select
          label={tr("rp_keep_alive", undefined, "Keep playing after you leave this screen or the app")}
          block={false}
          className="w-full sm:w-96"
          value={String(prefs.keepAliveS)}
          onChange={(e) => setPrefs({ keepAliveS: num(e.target.value) })}
          disabled={running}
          options={[
            { value: "30", label: tr("rp_keep_30s", undefined, "30 seconds") },
            { value: "60", label: tr("rp_keep_1m", undefined, "1 minute") },
            { value: "300", label: tr("rp_keep_5m", undefined, "5 minutes") },
            { value: "600", label: tr("rp_keep_10m", undefined, "10 minutes") },
          ]}
        />
        <p className="text-xs text-[var(--color-muted)]">
          {tr(
            "rp_keep_hint",
            undefined,
            "Other screens keep the stream running; this is how long it waits when no window shows it (closed or reloaded) before it ends.",
          )}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{tr("rp_set_controls", undefined, "Controls")}</h3>
        <Toggle
          checked={prefs.capturePointer}
          onChange={(v) => setPrefs({ capturePointer: v })}
          label={tr("rp_capture_pointer", undefined, "Clicking the picture hides the pointer")}
          hint={tr("rp_capture_pointer_hint", undefined, "Esc shows it again.")}
        />
        <Toggle
          checked={prefs.rumble}
          onChange={(v) => setPrefs({ rumble: v })}
          label={tr("rp_rumble", undefined, "Controller vibration")}
        />
        <Select
          label={tr("rp_touch_controls", undefined, "On-screen controller")}
          block={false}
          className="w-56"
          value={prefs.touchControls}
          onChange={(e) => setPrefs({ touchControls: e.target.value as RpPrefs["touchControls"] })}
          options={[
            { value: "auto", label: tr("rp_touch_auto", undefined, "On touch screens") },
            { value: "on", label: tr("rp_touch_on", undefined, "Always") },
            { value: "off", label: tr("rp_touch_off", undefined, "Never") },
          ]}
        />
        <p className="text-xs text-[var(--color-muted)]">
          {tr(
            "rp_controls_hint",
            undefined,
            "A controller works too: plug it in or pair it with this device. Shift + drag on the picture is a finger on the touchpad.",
          )}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{tr("rp_keys_title", undefined, "Keyboard controls")}</h3>
        <KeyRemap keymap={keymap} onChange={setKeymap} />
      </section>
    </div>
  );
}

/**
 * Remote Play: stream a console's screen into the app and play it with a controller, the
 * keyboard or touch. The session belongs to the app (state/remotePlay), not to this screen:
 * leaving it keeps the stream running and coming back shows it again. Uses the Wake & sign in
 * keys stored for the console (never shown); a console without them is pointed at that setup.
 */
export function StreamPanel() {
  const tr = useTr();
  const navigate = useNavigate();
  const profiles = useRosterStore((s) => s.profiles);
  const activeId = useRosterStore((s) => s.active_id);
  const stream = useRemotePlayStore((s) => s.stream);
  const target = useRemotePlayStore((s) => s.target);
  const phase = useRemotePlayStore((s) => s.phase);
  const error = useRemotePlayStore((s) => s.error);
  const stats = useRemotePlayStore((s) => s.stats);
  const light = useRemotePlayStore((s) => s.light);
  const prefs = useRemotePlayStore((s) => s.prefs);
  const setPrefs = useRemotePlayStore((s) => s.setPrefs);
  const startStream = useRemotePlayStore((s) => s.start);
  const stopStream = useRemotePlayStore((s) => s.stop);
  const setOnScreen = useRemotePlayStore((s) => s.setOnScreen);
  const [profileId, setProfileId] = useState<string>(activeId ?? profiles[0]?.id ?? "");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [elsewhere, setElsewhere] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const hideTimer = useRef(0);
  const touchFirst = useTouchFirst(prefs.touchControls);

  const profile = useMemo(() => profiles.find((p) => p.id === profileId) ?? null, [profiles, profileId]);
  const paired = !!(profile?.wake_regist_key && profile?.wake_rp_key);
  const running = !!stream && phase !== null && phase !== "ended";
  const playing = phase === "playing";

  // On show: controllers drive the console. Off: they do not, but the stream keeps running.
  useEffect(() => {
    setOnScreen(true);
    return () => {
      setOnScreen(false);
      rpInput.held.clear();
      stream?.sendPad();
    };
  }, [setOnScreen, stream]);

  // The stream draws on its own canvas; it is shown here whenever this screen is.
  useEffect(() => {
    const host = canvasHost.current;
    if (!stream || !host) return;
    host.appendChild(stream.canvas);
    return () => {
      if (stream.canvas.parentElement === host) host.removeChild(stream.canvas);
    };
  }, [stream]);

  // A stream this page does not show (a reload, another window): offer it here.
  useEffect(() => {
    if (running) {
      setElsewhere(null);
      return;
    }
    let live = true;
    void fetchRunningSession().then((r) => live && setElsewhere(r.host ?? null));
    return () => {
      live = false;
    };
  }, [running]);

  // Two windows: the one you look at takes the stream.
  useEffect(() => {
    if (phase !== "moved") return;
    const onFocus = () => stream?.takeOver();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [phase, stream]);

  const exitFull = useCallback(() => {
    setFull(false);
    void setWindowFullscreen(false);
  }, []);
  const enterFull = useCallback(() => {
    setFull(true);
    void setWindowFullscreen(true);
    stage.current?.focus();
  }, []);
  const toggleFull = useCallback(() => (full ? exitFull() : enterFull()), [full, exitFull, enterFull]);
  // The browser left full screen on its own (Esc): the picture goes back in its place.
  useEffect(() => {
    if (!full || isTauriEnv()) return;
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [full]);
  // Leaving the screen leaves full screen.
  useEffect(() => () => void setWindowFullscreen(false), []);

  const showChrome = useCallback(() => {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setChrome(false), 2500);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const start = useCallback(
    async (attach = false, host?: string) => {
      const p = host ? profiles.find((x) => x.host === host) : profile;
      if (!p?.wake_regist_key || !p.wake_rp_key) return;
      await startStream(
        { host: p.host, name: p.name, registKey: p.wake_regist_key, rpKey: p.wake_rp_key },
        { attach },
      );
      stage.current?.focus();
    },
    [profile, profiles, startStream],
  );

  const onKey = useCallback(
    (e: React.KeyboardEvent, down: boolean) => {
      // Full screen without a hidden pointer: Esc leaves full screen, as everywhere else.
      if (down && e.code === "Escape" && full && !document.pointerLockElement) {
        e.preventDefault();
        exitFull();
        return;
      }
      if (!useRemotePlayStore.getState().keymap[e.code]) return;
      e.preventDefault();
      if (down) rpInput.held.add(e.code);
      else rpInput.held.delete(e.code);
      stream?.sendPad();
    },
    [full, exitFull, stream],
  );

  // Shift + drag on the picture is a finger on the touchpad (for games that use it, like
  // maps and menus); the position on the picture is the position on the pad.
  const onPointer = useCallback(
    (e: React.PointerEvent, kind: "down" | "move" | "up") => {
      if (e.pointerType === "mouse" && kind === "move") showChrome();
      if (kind === "up") {
        if (!rpInput.touch) return;
        rpInput.touch = null;
      } else {
        if (kind === "down" && !e.shiftKey) return;
        if (kind === "move" && !rpInput.touch) return;
        const r = e.currentTarget.getBoundingClientRect();
        rpInput.touch = touchAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      }
      stream?.sendPad();
    },
    [stream, showChrome],
  );

  // Clicking the picture takes the keyboard and (if set) hides the pointer; the browser keeps
  // Esc for giving it back, so Circle is Backspace too.
  const capture = useCallback(() => {
    const el = stage.current;
    if (!el) return;
    el.focus();
    if (!prefs.capturePointer || !document.hasFocus() || document.pointerLockElement === el) return;
    try {
      // A promise in current browsers: refused (window not focused, too soon after Esc) is fine.
      const r = el.requestPointerLock?.() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      // Older browsers throw instead.
    }
  }, [prefs.capturePointer]);

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

  const elsewhereProfile = elsewhere ? profiles.find((p) => p.host === elsewhere) : null;
  const showBar = !playing || chrome || settingsOpen;
  const muted = prefs.muted || prefs.volume === 0;

  return (
    <div className="space-y-3">
      {!running && (
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label={tr("rp_console", undefined, "Console")}
            block={false}
            className="w-full sm:w-72"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            options={profiles.map((p) => ({ value: p.id, label: `${p.name} (${p.host})` }))}
          />
          <Select
            label={tr("rp_quality", undefined, "Picture")}
            block={false}
            className="w-28"
            value={prefs.res}
            onChange={(e) => setPrefs({ res: e.target.value as RpPrefs["res"] })}
            options={[
              { value: "1920x1080", label: "1080p" },
              { value: "1280x720", label: "720p" },
            ]}
          />
          <Select
            label={tr("rp_fps", undefined, "Frame rate")}
            block={false}
            className="w-28"
            value={String(prefs.fps)}
            onChange={(e) => setPrefs({ fps: Number(e.target.value) as RpPrefs["fps"] })}
            options={[
              { value: "60", label: "60 fps" },
              { value: "30", label: "30 fps" },
            ]}
          />
          <Button variant="primary" size="md" onClick={() => void start()} disabled={!paired} data-testid="rp-start">
            <Play size={14} />
            {tr("rp_start", undefined, "Start")}
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
          >
            <Settings2 size={14} />
            {tr("rp_settings", undefined, "Settings")}
          </Button>
        </div>
      )}

      {!running && elsewhere && (
        <Callout
          tone="info"
          title={tr(
            "rp_running_elsewhere",
            { name: elsewhereProfile?.name ?? elsewhere },
            `Remote Play is running on ${elsewhereProfile?.name ?? elsewhere}`,
          )}
          action={
            <div className="flex gap-2">
              {elsewhereProfile?.wake_regist_key && (
                <Button size="sm" variant="primary" onClick={() => void start(true, elsewhere)}>
                  {tr("rp_show_here", undefined, "Show it here")}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  stopEngineSession(elsewhere);
                  setElsewhere(null);
                }}
              >
                {tr("rp_stop", undefined, "Stop")}
              </Button>
            </div>
          }
        >
          {tr(
            "rp_running_elsewhere_body",
            undefined,
            "It was started from another window or before this page reloaded, and is still going.",
          )}
        </Callout>
      )}

      {profile && !paired && !running && (
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
          rpInput.held.clear();
          stream?.sendPad();
        }}
        onClick={running ? (e) => !e.shiftKey && capture() : undefined}
        onDoubleClick={running ? toggleFull : undefined}
        onPointerDown={(e) => onPointer(e, "down")}
        onPointerMove={(e) => onPointer(e, "move")}
        onPointerUp={(e) => onPointer(e, "up")}
        onPointerLeave={(e) => onPointer(e, "up")}
        className={`group relative overflow-hidden bg-black outline-none ${
          full
            ? "fixed inset-0 z-[200] h-[100dvh] w-screen"
            : "aspect-video w-full rounded-[var(--radius-card)] shadow-[var(--shadow-2)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        } ${playing && !chrome ? "cursor-none" : ""}`}
        data-testid="rp-stage"
      >
        <div ref={canvasHost} className="absolute inset-0 flex items-center justify-center" />

        {running && phase !== "playing" && phase !== "moved" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 text-sm text-white/85">
            <Spinner size={16} tone="inherit" />
            {phaseText(tr, phase)}
          </div>
        )}
        {phase === "moved" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-sm text-white/85">
            <MonitorPlay size={28} />
            {tr("rp_moved", undefined, "Playing in another window.")}
            <Button size="sm" variant="primary" onClick={() => stream?.takeOver()}>
              {tr("rp_play_here", undefined, "Play here")}
            </Button>
          </div>
        )}
        {!running && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/60">
            <Gamepad2 size={28} />
            {tr("rp_idle", undefined, "Press Start to play this PS5 here.")}
          </div>
        )}
        {playing && prefs.showStats && stats && <StatsLine stats={stats} light={light} />}

        {running && (
          <div
            className={`absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 pb-6 pt-[max(0.75rem,env(safe-area-inset-top))] transition-opacity duration-200 ${
              showBar ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            data-testid="rp-toolbar"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
              <span className="me-2 inline-block h-2 w-2 rounded-full bg-[var(--color-success,#22c55e)] align-middle" />
              {target?.name}
            </span>
            <BarButton
              label={tr("rp_show_stats_short", undefined, "Stats")}
              active={prefs.showStats}
              onClick={() => setPrefs({ showStats: !prefs.showStats })}
              testId="rp-toggle-stats"
            >
              <BarChart3 size={16} />
            </BarButton>
            <BarButton
              label={muted ? tr("rp_unmute", undefined, "Sound on") : tr("rp_mute", undefined, "Mute")}
              active={muted}
              onClick={() => setPrefs({ muted: !prefs.muted, volume: prefs.volume || 1 })}
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </BarButton>
            <BarButton
              label={tr("rp_settings", undefined, "Settings")}
              active={settingsOpen}
              onClick={() => {
                if (full) exitFull();
                setSettingsOpen((v) => !v);
              }}
            >
              <Settings2 size={16} />
            </BarButton>
            <BarButton
              label={full ? tr("rp_exit_fullscreen", undefined, "Leave full screen") : tr("rp_fullscreen", undefined, "Full screen")}
              active={full}
              onClick={toggleFull}
              testId="rp-fullscreen"
            >
              {full ? <Minimize size={16} /> : <Expand size={16} />}
            </BarButton>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (full) exitFull();
                stopStream();
              }}
              className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-danger,#dc2626)] px-3 text-sm font-medium text-white hover:brightness-110"
              data-testid="rp-stop"
            >
              <Square size={13} />
              {tr("rp_stop", undefined, "Stop")}
            </button>
          </div>
        )}
        {running && touchFirst && <TouchControls stream={stream} />}
      </div>

      {settingsOpen && <SettingsPanel running={running} />}

      {!settingsOpen && (
        <p className="text-xs text-[var(--color-muted)]">
          {tr(
            "rp_keys_body2",
            undefined,
            "Click the picture to play with the keyboard; Esc gives the pointer back. Double-click for full screen. Keys, sound and more are in Settings.",
          )}
        </p>
      )}
    </div>
  );
}
