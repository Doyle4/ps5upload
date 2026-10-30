// Remote Play microphone (experimental): the player's voice to the console.
//
// The engine sends it the way chiaki-ng does (engine `rp_stream/mic.rs`): Opus at 48 kHz,
// 2 channels, 10 ms frames of exactly 40 bytes (32 kbit/s, constant bitrate; chiaki drops any
// other size). Here: the mic (with the browser's echo cancellation, noise suppression and gain
// control) → an AudioWorklet that hands over the samples → 480-sample frames → WebCodecs
// AudioEncoder → `[5][Opus packet]` binary messages on the stream's socket. `{"mic": true}` /
// `{"mic": false}` turns the console's mic on and off. Nothing is stored.

import { log } from "../state/logs";
// no-inline: a small file would otherwise be a data: URL, which the apps' CSP refuses too.
import micWorkletUrl from "./rpMicWorklet.js?url&no-inline";

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
      if (typeof AudioWorkletNode === "undefined" && typeof ScriptProcessorNode === "undefined") return false;
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

/** Hands the mic's samples to `onSamples` (1 or 2 channels, any block size) until the returned
 *  stop is called. An audio worklet loaded from the app's own file; where a worklet cannot load,
 *  the older ScriptProcessorNode, which every WebView has. `via` says which one runs. */
async function attachCapture(
  ctx: AudioContext,
  source: AudioNode,
  onSamples: (channels: Float32Array[]) => void,
): Promise<{ via: string; stop: () => void }> {
  // Silent, but connected to the speakers: a node nothing listens to is not run everywhere.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  sink.connect(ctx.destination);
  let workletError = "";
  if (typeof AudioWorkletNode !== "undefined" && ctx.audioWorklet) {
    try {
      await ctx.audioWorklet.addModule(micWorkletUrl);
      const node = new AudioWorkletNode(ctx, "rp-mic", { numberOfOutputs: 1 });
      node.port.onmessage = (e: MessageEvent<Float32Array[]>) => onSamples(e.data);
      source.connect(node);
      node.connect(sink);
      return {
        via: "worklet",
        stop: () => {
          node.port.onmessage = null;
          node.disconnect();
          sink.disconnect();
        },
      };
    } catch (e) {
      workletError = errorText(e);
    }
  }
  // 512 samples: about 10 ms at 48 kHz, the console's frame.
  const proc = ctx.createScriptProcessor(512, 2, 2);
  proc.onaudioprocess = (e) => {
    const b = e.inputBuffer;
    const chans: Float32Array[] = [];
    for (let c = 0; c < b.numberOfChannels; c++) chans.push(b.getChannelData(c).slice());
    onSamples(chans);
  };
  source.connect(proc);
  proc.connect(sink);
  return {
    via: workletError ? `script processor (the worklet failed: ${workletError})` : "script processor",
    stop: () => {
      proc.onaudioprocess = null;
      proc.disconnect();
      sink.disconnect();
    },
  };
}

function errorText(e: unknown): string {
  const x = e as { name?: string; message?: string } | null;
  const name = x?.name ?? "";
  const msg = x?.message ?? String(e);
  return name && !msg.startsWith(name) ? `${name}: ${msg}` : msg;
}

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
  private capture: { via: string; stop: () => void } | null = null;
  private why = "";
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

  /** Why it is blocked or failed (the step and the browser's error), or "". */
  get detail(): string {
    return this.why;
  }

  private set(s: MicState, why = ""): void {
    this.st = s;
    this.why = why;
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
      const why = `asking for the microphone: ${errorText(e)}`;
      log.warn("remote-play", `mic: ${why}`);
      this.set(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error", why);
      return;
    }
    if (run !== this.run) {
      media.getTracks().forEach((t) => t.stop());
      return;
    }
    this.media = media;
    let step = "starting the audio";
    try {
      const ctx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE, latencyHint: "interactive" });
      this.ctx = ctx;
      step = "starting the encoder";
      const encoder = new AudioEncoder({
        output: (chunk) => {
          // Silence and odd sizes are skipped by the engine too; no need to send them.
          if (chunk.byteLength !== MIC_PACKET_BYTES) return;
          const buf = new Uint8Array(chunk.byteLength);
          chunk.copyTo(buf);
          this.target?.sendMicFrame(micFrameMessage(buf));
        },
        error: (e) => {
          if (run === this.run) this.fail(`encoding: ${errorText(e)}`);
        },
      });
      encoder.configure(MIC_ENCODER_CONFIG);
      this.encoder = encoder;
      this.samples = 0;
      const chunker = new FrameChunker();
      step = "capturing the microphone";
      this.capture = await attachCapture(ctx, ctx.createMediaStreamSource(media), (channels) => {
        const enc = this.encoder;
        if (!enc || enc.state !== "configured") return;
        for (const frame of chunker.push(channels)) {
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
      });
      if (run !== this.run) return;
      step = "starting the audio";
      await ctx.resume();
      if (run !== this.run) return;
      log.info("remote-play", `mic: live (${this.capture.via})`);
      this.target = target;
      target.setMic(true);
      this.set("live");
    } catch (e) {
      if (run === this.run) this.fail(`${step}: ${errorText(e)}`);
    }
  }

  private fail(why: string): void {
    log.warn("remote-play", `mic: ${why}`);
    this.release();
    this.target?.setMic(false);
    this.target = null;
    this.set("error", why);
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
    this.capture?.stop();
    this.capture = null;
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
