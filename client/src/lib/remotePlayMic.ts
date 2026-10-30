// Remote Play microphone (experimental): the player's voice to the console.
//
// The engine sends it the way chiaki-ng does (engine `rp_stream/mic.rs`): Opus at 48 kHz,
// 2 channels, 10 ms frames of exactly 40 bytes (32 kbit/s, constant bitrate; chiaki drops any
// other size). Here: the mic (with the browser's echo cancellation, noise suppression and gain
// control) → an AudioWorklet that hands over the samples → 480-sample frames → WebCodecs
// AudioEncoder → `[5][Opus packet]` binary messages on the stream's socket. `{"mic": true}` /
// `{"mic": false}` turns the console's mic on and off. Nothing is stored.

export const MIC_KIND = 5;
export const MIC_SAMPLE_RATE = 48000;
export const MIC_CHANNELS = 2;
export const MIC_FRAME_SAMPLES = 480;
/** The only packet size the console path takes (chiaki `buf_size_per_unit`). */
export const MIC_PACKET_BYTES = 40;

export const MIC_ENCODER_CONFIG: AudioEncoderConfig = {
  codec: "opus",
  sampleRate: MIC_SAMPLE_RATE,
  numberOfChannels: MIC_CHANNELS,
  // 40 bytes every 10 ms.
  bitrate: (MIC_PACKET_BYTES * 8 * MIC_SAMPLE_RATE) / MIC_FRAME_SAMPLES,
  bitrateMode: "constant",
  opus: {
    frameDuration: (MIC_FRAME_SAMPLES * 1e6) / MIC_SAMPLE_RATE,
    // chiaki: OPUS_APPLICATION_RESTRICTED_LOWDELAY. Not in every browser's dictionary; an
    // unknown member is ignored.
    application: "lowdelay",
  } as OpusEncoderConfig,
};

/** One mic frame as the engine takes it: the kind byte, then the Opus packet. */
export function micFrameMessage(opus: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(1 + opus.length);
  out[0] = MIC_KIND;
  out.set(opus, 1);
  return out;
}

/**
 * Cuts the mic's samples (128 at a time from the worklet, 1 or 2 channels) into 480-sample
 * stereo frames; a mono mic goes to both channels.
 */
export class FrameChunker {
  private left = new Float32Array(MIC_FRAME_SAMPLES);
  private right = new Float32Array(MIC_FRAME_SAMPLES);
  private fill = 0;

  push(channels: ReadonlyArray<Float32Array>): Float32Array<ArrayBuffer>[] {
    const out: Float32Array<ArrayBuffer>[] = [];
    const l = channels[0];
    if (!l) return out;
    const r = channels[1] ?? l;
    let i = 0;
    while (i < l.length) {
      const n = Math.min(MIC_FRAME_SAMPLES - this.fill, l.length - i);
      this.left.set(l.subarray(i, i + n), this.fill);
      this.right.set(r.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === MIC_FRAME_SAMPLES) {
        // Planar: all of the left channel, then all of the right.
        const f = new Float32Array(MIC_FRAME_SAMPLES * 2);
        f.set(this.left, 0);
        f.set(this.right, MIC_FRAME_SAMPLES);
        out.push(f);
        this.fill = 0;
      }
    }
    return out;
  }
}

let supported: Promise<boolean> | null = null;

/** Can this browser capture and encode the mic the console's way? Asked once. */
export function micSupported(): Promise<boolean> {
  if (supported) return supported;
  supported = (async () => {
    try {
      if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return false;
      if (typeof AudioWorkletNode === "undefined") return false;
      if (!navigator.mediaDevices?.getUserMedia) return false;
      const r = await AudioEncoder.isConfigSupported(MIC_ENCODER_CONFIG);
      return !!r.supported;
    } catch {
      return false;
    }
  })();
  return supported;
}

/** Only for tests. */
export function resetMicSupportedForTest(): void {
  supported = null;
}

const MIC_WORKLET = `
class RpMic extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0];
    if (ch && ch.length) this.port.postMessage(ch.map((c) => c.slice()));
    return true;
  }
}
registerProcessor("rp-mic", RpMic);
`;

/** Where mic frames go: the running stream. */
export interface MicTarget {
  setMic(on: boolean): void;
  sendMicFrame(msg: Uint8Array<ArrayBuffer>): void;
}

export type MicState = "off" | "starting" | "live" | "denied" | "error";

/** The one mic: its capture, encoder and state. */
export class MicController {
  private st: MicState = "off";
  private listeners = new Set<() => void>();
  private target: MicTarget | null = null;
  private media: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private encoder: AudioEncoder | null = null;
  private samples = 0;
  /** Bumped on every start/stop, so a start that finishes late knows it was cancelled. */
  private run = 0;

  get state(): MicState {
    return this.st;
  }

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  readonly getState = (): MicState => this.st;

  private set(s: MicState): void {
    this.st = s;
    for (const fn of this.listeners) fn();
  }

  /** Ask for the mic and start sending it to `target` (call from the press, for permission). */
  async start(target: MicTarget): Promise<void> {
    if (this.st === "live" || this.st === "starting") return;
    const run = ++this.run;
    this.set("starting");
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: { ideal: 1 },
          sampleRate: { ideal: MIC_SAMPLE_RATE },
        },
      });
    } catch (e) {
      if (run !== this.run) return;
      const name = (e as { name?: string })?.name ?? "";
      this.set(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
      return;
    }
    if (run !== this.run) {
      media.getTracks().forEach((t) => t.stop());
      return;
    }
    this.media = media;
    try {
      const ctx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE, latencyHint: "interactive" });
      this.ctx = ctx;
      const url = URL.createObjectURL(new Blob([MIC_WORKLET], { type: "application/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      if (run !== this.run) return;
      const encoder = new AudioEncoder({
        output: (chunk) => {
          // Silence and odd sizes are skipped by the engine too; no need to send them.
          if (chunk.byteLength !== MIC_PACKET_BYTES) return;
          const buf = new Uint8Array(chunk.byteLength);
          chunk.copyTo(buf);
          this.target?.sendMicFrame(micFrameMessage(buf));
        },
        error: () => {
          if (run === this.run) this.fail();
        },
      });
      encoder.configure(MIC_ENCODER_CONFIG);
      this.encoder = encoder;
      this.samples = 0;
      const chunker = new FrameChunker();
      const node = new AudioWorkletNode(ctx, "rp-mic", { numberOfOutputs: 1 });
      node.port.onmessage = (e: MessageEvent<Float32Array[]>) => {
        const enc = this.encoder;
        if (!enc || enc.state !== "configured") return;
        for (const frame of chunker.push(e.data)) {
          const data = new AudioData({
            format: "f32-planar",
            sampleRate: MIC_SAMPLE_RATE,
            numberOfFrames: MIC_FRAME_SAMPLES,
            numberOfChannels: MIC_CHANNELS,
            timestamp: Math.round((this.samples * 1e6) / MIC_SAMPLE_RATE),
            data: frame,
          });
          this.samples += MIC_FRAME_SAMPLES;
          enc.encode(data);
          data.close();
        }
      };
      // A silent path to the speakers keeps the worklet running everywhere.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      ctx.createMediaStreamSource(media).connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);
      await ctx.resume();
      if (run !== this.run) return;
      this.target = target;
      target.setMic(true);
      this.set("live");
    } catch {
      if (run === this.run) this.fail();
    }
  }

  private fail(): void {
    this.release();
    this.target?.setMic(false);
    this.target = null;
    this.set("error");
  }

  /** Stop the mic and tell the console. */
  stop(): void {
    this.run++;
    const t = this.target;
    this.target = null;
    this.release();
    t?.setMic(false);
    if (this.st !== "off") this.set("off");
  }

  private release(): void {
    this.media?.getTracks().forEach((t) => t.stop());
    this.media = null;
    try {
      if (this.encoder && this.encoder.state !== "closed") this.encoder.close();
    } catch {
      // Already closed.
    }
    this.encoder = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

export const rpMic = new MicController();
