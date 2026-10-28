// Remote Play in the app: one stream from the engine's /api/ps5/rp/ws, decoded with WebCodecs.
//
// The engine runs the session with the console (ps5upload_core::rp_stream, a port of chiaki-ng)
// and relays it over a WebSocket: binary records out ([kind][payload]: 0 video header, 1 video
// access unit, 3 audio header, 4 audio frame), JSON status lines out, pad state in. This file
// turns that into pixels on a canvas, sound, and input; the screen only drives it.

import { getEngineUrl } from "../state/engine";
import { safeGetItem, safeRemoveItem, safeSetItem } from "./safeStorage";

/** Button bits, as the console (and chiaki) number them. */
export const PadButton = {
  CROSS: 1,
  CIRCLE: 2,
  SQUARE: 4,
  TRIANGLE: 8,
  LEFT: 16,
  RIGHT: 32,
  UP: 64,
  DOWN: 128,
  L1: 256,
  R1: 512,
  L3: 1024,
  R3: 2048,
  OPTIONS: 4096,
  SHARE: 8192,
  TOUCHPAD: 16384,
  PS: 32768,
} as const;

export interface PadState {
  buttons: number;
  l2: number;
  r2: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  /** One finger on the touchpad, in its 1920×942 space, or none. */
  touch?: [number, number] | null;
}

export const IDLE_PAD: PadState = { buttons: 0, l2: 0, r2: 0, lx: 0, ly: 0, rx: 0, ry: 0 };

/** The touchpad point for a position on the picture (fractions 0-1 across and down). */
export function touchAt(fx: number, fy: number): [number, number] {
  const c = (v: number) => Math.max(0, Math.min(1, v));
  return [Math.round(c(fx) * 1919), Math.round(c(fy) * 941)];
}

/** What a key does: a button, a stick direction, or a trigger. */
export type KeyAction =
  | { button: number }
  | { stick: "lx" | "ly" | "rx" | "ry"; dir: -1 | 1 }
  | { trigger: "l2" | "r2" };

/** The default keyboard map (KeyboardEvent.code → action). */
export const DEFAULT_KEYMAP: Record<string, KeyAction> = {
  ArrowUp: { button: PadButton.UP },
  ArrowDown: { button: PadButton.DOWN },
  ArrowLeft: { button: PadButton.LEFT },
  ArrowRight: { button: PadButton.RIGHT },
  Enter: { button: PadButton.CROSS },
  Space: { button: PadButton.CROSS },
  Backspace: { button: PadButton.CIRCLE },
  Escape: { button: PadButton.CIRCLE },
  KeyQ: { button: PadButton.SQUARE },
  KeyE: { button: PadButton.TRIANGLE },
  KeyZ: { button: PadButton.L1 },
  KeyC: { button: PadButton.R1 },
  Digit1: { trigger: "l2" },
  Digit3: { trigger: "r2" },
  KeyF: { button: PadButton.L3 },
  KeyG: { button: PadButton.R3 },
  Tab: { button: PadButton.OPTIONS },
  Backquote: { button: PadButton.SHARE },
  KeyH: { button: PadButton.PS },
  KeyT: { button: PadButton.TOUCHPAD },
  KeyW: { stick: "ly", dir: -1 },
  KeyS: { stick: "ly", dir: 1 },
  KeyA: { stick: "lx", dir: -1 },
  KeyD: { stick: "lx", dir: 1 },
  KeyI: { stick: "ry", dir: -1 },
  KeyK: { stick: "ry", dir: 1 },
  KeyJ: { stick: "rx", dir: -1 },
  KeyL: { stick: "rx", dir: 1 },
};

/** The actions a key can be set to, in the order the remap list shows them. */
export const PAD_ACTIONS: ReadonlyArray<{ id: string; label: string; action: KeyAction }> = [
  { id: "up", label: "D-pad up", action: { button: PadButton.UP } },
  { id: "down", label: "D-pad down", action: { button: PadButton.DOWN } },
  { id: "left", label: "D-pad left", action: { button: PadButton.LEFT } },
  { id: "right", label: "D-pad right", action: { button: PadButton.RIGHT } },
  { id: "cross", label: "✕", action: { button: PadButton.CROSS } },
  { id: "circle", label: "○", action: { button: PadButton.CIRCLE } },
  { id: "square", label: "□", action: { button: PadButton.SQUARE } },
  { id: "triangle", label: "△", action: { button: PadButton.TRIANGLE } },
  { id: "l1", label: "L1", action: { button: PadButton.L1 } },
  { id: "r1", label: "R1", action: { button: PadButton.R1 } },
  { id: "l2", label: "L2", action: { trigger: "l2" } },
  { id: "r2", label: "R2", action: { trigger: "r2" } },
  { id: "l3", label: "L3", action: { button: PadButton.L3 } },
  { id: "r3", label: "R3", action: { button: PadButton.R3 } },
  { id: "options", label: "Options", action: { button: PadButton.OPTIONS } },
  { id: "create", label: "Create", action: { button: PadButton.SHARE } },
  { id: "ps", label: "PS button", action: { button: PadButton.PS } },
  { id: "touchpad", label: "Touchpad press", action: { button: PadButton.TOUCHPAD } },
  { id: "ls_up", label: "Left stick up", action: { stick: "ly", dir: -1 } },
  { id: "ls_down", label: "Left stick down", action: { stick: "ly", dir: 1 } },
  { id: "ls_left", label: "Left stick left", action: { stick: "lx", dir: -1 } },
  { id: "ls_right", label: "Left stick right", action: { stick: "lx", dir: 1 } },
  { id: "rs_up", label: "Right stick up", action: { stick: "ry", dir: -1 } },
  { id: "rs_down", label: "Right stick down", action: { stick: "ry", dir: 1 } },
  { id: "rs_left", label: "Right stick left", action: { stick: "rx", dir: -1 } },
  { id: "rs_right", label: "Right stick right", action: { stick: "rx", dir: 1 } },
];

const sameAction = (a: KeyAction, b: KeyAction) => JSON.stringify(a) === JSON.stringify(b);

/** The keys bound to an action. */
export function keysFor(keymap: Record<string, KeyAction>, action: KeyAction): string[] {
  return Object.entries(keymap)
    .filter(([, a]) => sameAction(a, action))
    .map(([k]) => k);
}

/** `keymap` with `code` as the one key for `action` (taken off whatever it did before). */
export function rebind(keymap: Record<string, KeyAction>, action: KeyAction, code: string): Record<string, KeyAction> {
  const next: Record<string, KeyAction> = {};
  for (const [k, a] of Object.entries(keymap)) {
    if (k !== code && !sameAction(a, action)) next[k] = a;
  }
  next[code] = action;
  return next;
}

const KEYMAP_KEY = "ps5upload.rp_keymap.v1";

/** The keyboard map in use on this device (the default until changed). */
export function loadKeymap(): Record<string, KeyAction> {
  try {
    const raw = safeGetItem(KEYMAP_KEY);
    const v = raw ? (JSON.parse(raw) as Record<string, KeyAction>) : null;
    return v && typeof v === "object" && Object.keys(v).length ? v : DEFAULT_KEYMAP;
  } catch {
    return DEFAULT_KEYMAP;
  }
}

export function saveKeymap(keymap: Record<string, KeyAction> | null): void {
  if (keymap) safeSetItem(KEYMAP_KEY, JSON.stringify(keymap));
  else safeRemoveItem(KEYMAP_KEY);
}

const clampAxis = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));

/** The pad the held keys amount to. */
export function padFromKeys(held: Iterable<string>, keymap: Record<string, KeyAction> = DEFAULT_KEYMAP): PadState {
  const p = { ...IDLE_PAD };
  for (const code of held) {
    const a = keymap[code];
    if (!a) continue;
    if ("button" in a) p.buttons |= a.button;
    else if ("stick" in a) p[a.stick] = clampAxis(p[a.stick] + a.dir * 32767);
    else p[a.trigger] = 255;
  }
  return p;
}

/** Gamepad API "standard" mapping, button index → pad bit (6/7 are the analog triggers). */
const STANDARD_BUTTONS = [
  PadButton.CROSS, PadButton.CIRCLE, PadButton.SQUARE, PadButton.TRIANGLE, PadButton.L1, PadButton.R1, 0, 0,
  PadButton.SHARE, PadButton.OPTIONS, PadButton.L3, PadButton.R3, PadButton.UP, PadButton.DOWN, PadButton.LEFT,
  PadButton.RIGHT, PadButton.PS, PadButton.TOUCHPAD,
];

/** The pad the connected controllers amount to (all of them, merged). */
export function padFromGamepads(pads: ReadonlyArray<Gamepad | null>): PadState {
  const p = { ...IDLE_PAD };
  const axis = (v: number) => (Math.abs(v) < 0.08 ? 0 : clampAxis(v * 32767));
  for (const g of pads) {
    if (!g || g.mapping !== "standard") continue;
    g.buttons.forEach((b, i) => {
      if (b.pressed && STANDARD_BUTTONS[i]) p.buttons |= STANDARD_BUTTONS[i];
    });
    p.l2 = Math.max(p.l2, Math.round((g.buttons[6]?.value ?? 0) * 255));
    p.r2 = Math.max(p.r2, Math.round((g.buttons[7]?.value ?? 0) * 255));
    p.lx = axis(g.axes[0] ?? 0);
    p.ly = axis(g.axes[1] ?? 0);
    p.rx = axis(g.axes[2] ?? 0);
    p.ry = axis(g.axes[3] ?? 0);
  }
  return p;
}

export function mergePads(a: PadState, b: PadState): PadState {
  return {
    buttons: a.buttons | b.buttons,
    l2: Math.max(a.l2, b.l2),
    r2: Math.max(a.r2, b.r2),
    lx: clampAxis(a.lx + b.lx),
    ly: clampAxis(a.ly + b.ly),
    rx: clampAxis(a.rx + b.rx),
    ry: clampAxis(a.ry + b.ry),
    touch: a.touch ?? b.touch ?? null,
  };
}

/** Play the console's rumble on every controller that can (Gamepad API "dual-rumble").
 *  Each message is the current level, so it is played for a while and replaced by the next;
 *  zero stops it. */
export function playRumble(pads: ReadonlyArray<Gamepad | null>, strong: number, weak: number): void {
  for (const g of pads) {
    const act = (g as (Gamepad & { vibrationActuator?: GamepadHapticActuator | null }) | null)?.vibrationActuator;
    if (!act) continue;
    if (strong === 0 && weak === 0) {
      void act.reset?.();
      continue;
    }
    void act.playEffect?.("dual-rumble", {
      duration: 1000,
      strongMagnitude: strong / 255,
      weakMagnitude: weak / 255,
    });
  }
}

/** True when an Annex-B access unit starts a picture the decoder can begin at. */
export function isKeyframe(au: Uint8Array, hevc: boolean): boolean {
  for (let i = 0; i + 3 < au.length; i++) {
    if (au[i] !== 0 || au[i + 1] !== 0 || au[i + 2] !== 1) continue;
    if (hevc) {
      const t = (au[i + 3] >> 1) & 0x3f;
      if (t >= 16 && t <= 21) return true; // IRAP: BLA, IDR, CRA
      if (t < 16) return false;
    } else {
      const t = au[i + 3] & 0x1f;
      if (t === 5) return true;
      if (t === 1) return false;
    }
  }
  return false;
}

/** `avc1.PPCCLL` from the SPS in an Annex-B header. */
export function avcCodecString(header: Uint8Array): string {
  for (let i = 0; i + 6 < header.length; i++) {
    if (header[i] === 0 && header[i + 1] === 0 && header[i + 2] === 1 && (header[i + 3] & 0x1f) === 7) {
      const h = (b: number) => b.toString(16).padStart(2, "0");
      return `avc1.${h(header[i + 4])}${h(header[i + 5])}${h(header[i + 6])}`;
    }
  }
  return "avc1.4d4028";
}

const HEVC_CANDIDATES = ["hev1.1.6.L153.B0", "hvc1.1.6.L153.B0", "hev1.2.4.L153.B0", "hvc1.2.4.L153.B0", "hev1.1.6.L150.90"];

/** The first HEVC codec string this device decodes, or null. */
export async function supportedHevc(width: number, height: number): Promise<string | null> {
  if (typeof VideoDecoder === "undefined") return null;
  for (const codec of HEVC_CANDIDATES) {
    try {
      if ((await VideoDecoder.isConfigSupported({ codec, codedWidth: width, codedHeight: height })).supported) {
        return codec;
      }
    } catch {
      // Not this one.
    }
  }
  return null;
}

/** HEVC whenever this device can decode it (same picture in fewer bits); else H.264. The PS5
 *  offers only these two. */
export async function chooseCodec(width: number, height: number): Promise<"h265" | "h264"> {
  return (await supportedHevc(width, height)) ? "h265" : "h264";
}

/** True when this device can play a stream at all. */
export function canStream(): boolean {
  return typeof VideoDecoder !== "undefined" && typeof WebSocket !== "undefined";
}

export interface StreamStats {
  fps: number;
  mbps: number;
  decodeMs: number;
  codec: string;
  lossPct: number;
  rebuilt: number;
  lost: number;
}

export type StreamPhase = "connecting" | "waking" | "starting" | "playing" | "ended" | "error";

export interface StreamError {
  /** Stable, from the engine: busy, asleep, unreachable, keys, wake_failed, passcode,
   *  video_refused, other — or client-side: decode, socket. */
  code: string;
  retryS?: number;
  detail: string;
}

export interface StreamOptions {
  host: string;
  registKey: string;
  rpKey: string;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
  onPhase: (p: StreamPhase) => void;
  onStats: (s: StreamStats) => void;
  onError: (e: StreamError) => void;
  /** The console's light-bar colour for this pad. Browsers cannot set a controller's light
   *  bar (the Gamepad API has no such control), so the screen shows it. */
  onLight?: (rgb: [number, number, number]) => void;
  /** The pad state to send; polled every animation frame and on key events. */
  readPad: () => PadState;
}

const AUDIO_TARGET_S = 0.06;
const AUDIO_MAX_S = 0.25;

/** One running stream. `stop()` ends it (the engine ends the console session cleanly). */
export class RemotePlayStream {
  private ws: WebSocket | null = null;
  private video: VideoDecoder | null = null;
  private header: Uint8Array | null = null;
  private hevc = false;
  private sawKey = false;
  private ts = 0;
  private queued: EncodedVideoChunk[] = [];
  private sentAt = new Map<number, number>();
  private audioCtx: AudioContext | null = null;
  private audio: AudioDecoder | null = null;
  private audioNext = 0;
  private audioLastIdx = -1;
  private audioRate = 48000;
  private audioFrame = 480;
  private lastPad = "";
  private raf = 0;
  private decoded = 0;
  private bytes = 0;
  private decodeMs = 0;
  private codec = "";
  private statsTimer = 0;
  private lastLoss = { lossPct: 0, rebuilt: 0, lost: 0 };
  private ended = false;

  constructor(private readonly o: StreamOptions) {}

  async start(): Promise<void> {
    const { width, height } = this.o;
    const codec = await chooseCodec(width, height);
    this.hevc = codec === "h265";
    // Created inside the user's click so the browser lets it play.
    this.audioCtx = new AudioContext({ latencyHint: "interactive" });
    void this.audioCtx.resume();
    const url = getEngineUrl().replace(/^http/, "ws") + "/api/ps5/rp/ws";
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.o.onPhase("connecting");
    ws.onopen = () => {
      ws.send(
        JSON.stringify({ host: this.o.host, regist_key: this.o.registKey, rp_key: this.o.rpKey, width, height, codec }),
      );
    };
    ws.onmessage = (m) => {
      if (typeof m.data === "string") return this.onStatus(m.data);
      const b = new Uint8Array(m.data as ArrayBuffer);
      const kind = b[0];
      const payload = b.subarray(1);
      if (kind <= 1) this.onVideo(kind, payload);
      else this.onAudio(kind, payload);
    };
    ws.onclose = () => this.finish();
    ws.onerror = () => {
      if (!this.ended) this.o.onError({ code: "socket", detail: "The connection to the engine dropped." });
    };
    const tick = () => {
      this.sendPad();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    let lastDecoded = 0;
    let lastBytes = 0;
    this.statsTimer = window.setInterval(() => {
      this.o.onStats({
        fps: this.decoded - lastDecoded,
        mbps: ((this.bytes - lastBytes) * 8) / 1e6,
        decodeMs: this.decodeMs,
        codec: this.codec,
        ...this.lastLoss,
      });
      lastDecoded = this.decoded;
      lastBytes = this.bytes;
    }, 1000);
  }

  /** Send the pad now if it changed (call on key events so short taps are not missed). */
  sendPad(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const p = this.o.readPad();
    const s = JSON.stringify(p);
    if (s === this.lastPad) return;
    this.lastPad = s;
    ws.send(JSON.stringify({ pad: p }));
  }

  /** Ask the engine to end the session; it reports and closes the socket itself. */
  stop(): void {
    const ws = this.ws;
    if (!ws) return;
    try {
      ws.send(JSON.stringify({ stop: true }));
    } catch {
      // Already closing.
    }
    window.setTimeout(() => ws.close(), 3000);
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.statsTimer);
    try {
      this.video?.close();
    } catch {
      // Already closed.
    }
    try {
      this.audio?.close();
    } catch {
      // Already closed.
    }
    void this.audioCtx?.close();
    this.ws = null;
    this.o.onPhase("ended");
  }

  private onStatus(text: string): void {
    let s: {
      stage?: string;
      code?: string;
      retry_s?: number;
      error?: string;
      stats?: Record<string, number>;
      rumble?: [number, number];
      light?: [number, number, number];
    };
    try {
      s = JSON.parse(text);
    } catch {
      return;
    }
    if (s.rumble) {
      playRumble(navigator.getGamepads?.() ?? [], s.rumble[0], s.rumble[1]);
      return;
    }
    if (s.light) {
      this.o.onLight?.(s.light);
      return;
    }
    switch (s.stage) {
      case "waking":
        this.o.onPhase("waking");
        break;
      case "nonce":
      case "session":
      case "takion":
      case "bang":
      case "streaminfo":
        this.o.onPhase("starting");
        break;
      case "first_frame":
        this.o.onPhase("playing");
        break;
      case "stats": {
        const st = s.stats ?? {};
        const units = st.units ?? 0;
        this.lastLoss = {
          lossPct: units ? ((st.units_lost ?? 0) * 100) / units : 0,
          rebuilt: st.frames_rebuilt ?? 0,
          lost: st.frames_lost ?? 0,
        };
        break;
      }
      case "error":
        this.o.onError({ code: s.code ?? "other", retryS: s.retry_s ?? undefined, detail: s.error ?? "" });
        break;
    }
  }

  private onVideo(kind: number, payload: Uint8Array): void {
    if (kind === 0) {
      this.header = payload.slice();
      if (!this.video) this.openVideo();
      return;
    }
    this.bytes += payload.length;
    const key = isKeyframe(payload, this.hevc);
    if (!this.sawKey && !key) return;
    this.sawKey = true;
    let data = payload;
    if (key && this.header) {
      data = new Uint8Array(this.header.length + payload.length);
      data.set(this.header);
      data.set(payload, this.header.length);
    }
    this.ts += 16667;
    this.sentAt.set(this.ts, performance.now());
    const chunk = new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: this.ts, data });
    if (!this.video || this.video.state !== "configured") {
      this.queued.push(chunk); // the HEVC codec string is still being probed
      return;
    }
    this.video.decode(chunk);
  }

  private openVideo(): void {
    const ctx = this.o.canvas.getContext("2d");
    this.video = new VideoDecoder({
      output: (frame) => {
        const t = this.sentAt.get(frame.timestamp);
        if (t !== undefined) {
          this.decodeMs = performance.now() - t;
          this.sentAt.delete(frame.timestamp);
        }
        const c = this.o.canvas;
        if (c.width !== frame.displayWidth || c.height !== frame.displayHeight) {
          c.width = frame.displayWidth;
          c.height = frame.displayHeight;
        }
        ctx?.drawImage(frame, 0, 0, c.width, c.height);
        frame.close();
        this.decoded++;
      },
      error: (e) => this.o.onError({ code: "decode", detail: String(e) }),
    });
    const cfg = { optimizeForLatency: true, hardwareAcceleration: "prefer-hardware" as const };
    const configure = (codec: string) => {
      this.codec = codec;
      this.video?.configure({ codec, ...cfg });
      for (const q of this.queued) this.video?.decode(q);
      this.queued = [];
    };
    if (this.hevc) {
      void supportedHevc(this.o.width, this.o.height).then((c) => {
        if (c) configure(c);
        else this.o.onError({ code: "decode", detail: "This device cannot decode HEVC." });
      });
    } else if (this.header) {
      configure(avcCodecString(this.header));
    }
  }

  // Audio is played ~60 ms ahead: video draws the moment it decodes, so that keeps the two
  // within a few tens of milliseconds while riding out network jitter. Too far behind (an
  // underrun) or ahead (a stall piled frames up) and the schedule snaps back to the target.
  private onAudio(kind: number, payload: Uint8Array): void {
    const actx = this.audioCtx;
    if (!actx) return;
    if (kind === 3) {
      const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const channels = payload[0];
      this.audioRate = dv.getUint32(2);
      this.audioFrame = dv.getUint32(6);
      this.audio = new AudioDecoder({
        output: (data) => {
          const n = data.numberOfFrames;
          const buf = actx.createBuffer(data.numberOfChannels, n, data.sampleRate);
          for (let c = 0; c < data.numberOfChannels; c++) {
            const plane = new Float32Array(n);
            data.copyTo(plane, { planeIndex: c, format: "f32-planar" });
            buf.copyToChannel(plane, c);
          }
          data.close();
          const now = actx.currentTime;
          if (this.audioNext < now + 0.01 || this.audioNext > now + AUDIO_MAX_S) this.audioNext = now + AUDIO_TARGET_S;
          const src = actx.createBufferSource();
          src.buffer = buf;
          src.connect(actx.destination);
          src.start(this.audioNext);
          this.audioNext += n / data.sampleRate;
        },
        error: () => {
          // A bad audio frame is skipped; the picture carries on.
        },
      });
      this.audio.configure({ codec: "opus", sampleRate: this.audioRate, numberOfChannels: channels });
      return;
    }
    if (!this.audio || this.audio.state !== "configured") return;
    const idx = (payload[0] << 8) | payload[1];
    // In order; a late copy of a frame already played is dropped.
    if (this.audioLastIdx >= 0 && ((idx - this.audioLastIdx) & 0xffff) >= 0x8000) return;
    this.audioLastIdx = idx;
    this.audio.decode(
      new EncodedAudioChunk({
        type: "key",
        timestamp: idx * (this.audioFrame / this.audioRate) * 1e6,
        data: payload.subarray(2),
      }),
    );
  }
}
