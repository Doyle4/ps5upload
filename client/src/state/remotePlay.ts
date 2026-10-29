import { create } from "zustand";

import { getEngineUrl } from "./engine";
import {
  DEFAULT_KEYMAP,
  IDLE_PAD,
  RemotePlayStream,
  loadKeymap,
  mergePads,
  padFromGamepads,
  padFromKeys,
  saveKeymap,
  type KeyAction,
  type PadState,
  type StreamError,
  type StreamPhase,
  type StreamStats,
} from "../lib/remotePlayStream";
import { safeGetItem, safeSetItem } from "../lib/safeStorage";

/** How Remote Play looks and behaves on this device. */
export interface RpPrefs {
  res: "1920x1080" | "1280x720";
  fps: 60 | 30;
  /** fps, bitrate and delay over the picture. */
  showStats: boolean;
  volume: number;
  muted: boolean;
  /** Sound kept ready, ms: lower is less delay, higher rides out a busy network. */
  audioBufferMs: number;
  /** How long a session waits for the app to come back after it left, s. */
  keepAliveS: number;
  /** Clicking the picture takes the keyboard and hides the pointer. */
  capturePointer: boolean;
  rumble: boolean;
  /** The controller drawn over the picture: on touch screens (auto), always, or never. */
  touchControls: "auto" | "on" | "off";
}

export const DEFAULT_RP_PREFS: RpPrefs = {
  res: "1920x1080",
  fps: 60,
  showStats: false,
  volume: 1,
  muted: false,
  audioBufferMs: 60,
  keepAliveS: 60,
  capturePointer: true,
  rumble: true,
  touchControls: "auto",
};

const PREFS_KEY = "ps5upload.rp_prefs.v1";

export function loadRpPrefs(): RpPrefs {
  try {
    const raw = safeGetItem(PREFS_KEY);
    return { ...DEFAULT_RP_PREFS, ...(raw ? (JSON.parse(raw) as Partial<RpPrefs>) : {}) };
  } catch {
    return DEFAULT_RP_PREFS;
  }
}

/** The console, with the Wake & sign in keys a stream starts with. */
export interface RpTarget {
  host: string;
  name: string;
  registKey: string;
  rpKey: string;
}

interface RpState {
  stream: RemotePlayStream | null;
  target: RpTarget | null;
  phase: StreamPhase | null;
  error: StreamError | null;
  stats: StreamStats | null;
  light: [number, number, number] | null;
  prefs: RpPrefs;
  keymap: Record<string, KeyAction>;
  /** The Remote Play screen is on show: only then do controllers drive the console. */
  onScreen: boolean;
  start: (t: RpTarget, opts?: { attach?: boolean }) => Promise<void>;
  stop: () => void;
  setPrefs: (p: Partial<RpPrefs>) => void;
  setKeymap: (k: Record<string, KeyAction> | null) => void;
  setOnScreen: (v: boolean) => void;
}

/** Keys held on the picture and a finger on the touchpad: read by the stream every frame. */
export const rpInput = {
  held: new Set<string>(),
  touch: null as [number, number] | null,
  /** The on-screen controller. */
  touchPad: IDLE_PAD as PadState,
};

function readPad(): PadState {
  const s = useRemotePlayStore.getState();
  const keys = padFromKeys(rpInput.held, s.keymap);
  // A controller drives the console while you are looking at the stream, not while you use
  // another screen or another app.
  const pads =
    s.onScreen && typeof document !== "undefined" && document.hasFocus()
      ? padFromGamepads(navigator.getGamepads?.() ?? [])
      : IDLE_PAD;
  return {
    ...mergePads(mergePads(keys, pads), rpInput.touchPad),
    touch: rpInput.touch ?? rpInput.touchPad.touch ?? null,
  };
}

export const useRemotePlayStore = create<RpState>((set, get) => ({
  stream: null,
  target: null,
  phase: null,
  error: null,
  stats: null,
  light: null,
  prefs: loadRpPrefs(),
  keymap: loadKeymap(),
  onScreen: false,

  async start(t, opts) {
    const cur = get().stream;
    if (cur && cur.currentPhase !== "ended") return;
    const { prefs } = get();
    const [width, height] = prefs.res.split("x").map(Number);
    const stream: RemotePlayStream = new RemotePlayStream({
      host: t.host,
      registKey: t.registKey,
      rpKey: t.rpKey,
      width,
      height,
      fps: prefs.fps,
      keepAliveS: prefs.keepAliveS,
      audioBufferMs: prefs.audioBufferMs,
      attach: opts?.attach,
      rumble: () => get().prefs.rumble,
      onPhase: (p) => {
        if (get().stream !== stream) return;
        set({ phase: p });
        if (p === "ended") {
          rpInput.held.clear();
          set({ stream: null, light: null });
        }
      },
      onStats: (st) => get().stream === stream && set({ stats: st }),
      onError: (e) => get().stream === stream && set({ error: e }),
      onLight: (rgb) => get().stream === stream && set({ light: rgb }),
      readPad,
    });
    stream.setVolume(prefs.muted ? 0 : prefs.volume);
    set({ stream, target: t, phase: "connecting", error: null, stats: null, light: null });
    await stream.start();
  },

  stop() {
    get().stream?.stop();
  },

  setPrefs(p) {
    const prefs = { ...get().prefs, ...p };
    safeSetItem(PREFS_KEY, JSON.stringify(prefs));
    set({ prefs });
    const s = get().stream;
    if (s) {
      s.setVolume(prefs.muted ? 0 : prefs.volume);
      s.setAudioBuffer(prefs.audioBufferMs);
    }
  },

  setKeymap(k) {
    saveKeymap(k);
    set({ keymap: k ?? DEFAULT_KEYMAP });
  },

  setOnScreen(v) {
    set({ onScreen: v });
  },
}));

/** The session the engine is running, if any (it outlives a reload of this page). */
export async function fetchRunningSession(): Promise<{ host: string | null; playing?: boolean; attached?: boolean }> {
  try {
    const r = await fetch(`${getEngineUrl()}/api/ps5/rp/session`);
    return r.ok ? await r.json() : { host: null };
  } catch {
    return { host: null };
  }
}
