import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FrameChunker,
  MIC_ENCODER_CONFIG,
  MIC_FRAME_SAMPLES,
  MIC_KIND,
  micFrameMessage,
  micSupported,
  resetMicSupportedForTest,
} from "./remotePlayMic";

describe("remote play mic", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetMicSupportedForTest();
  });

  it("encodes the way chiaki-ng sends: 48 kHz stereo, 10 ms, 40-byte CBR frames", () => {
    expect(MIC_ENCODER_CONFIG.codec).toBe("opus");
    expect(MIC_ENCODER_CONFIG.sampleRate).toBe(48000);
    expect(MIC_ENCODER_CONFIG.numberOfChannels).toBe(2);
    expect(MIC_ENCODER_CONFIG.bitrate).toBe(32000);
    expect(MIC_ENCODER_CONFIG.bitrateMode).toBe("constant");
    expect(MIC_ENCODER_CONFIG.opus?.frameDuration).toBe(10000);
  });

  it("prefixes a frame with the mic kind byte", () => {
    const m = micFrameMessage(new Uint8Array([1, 2, 3]));
    expect([...m]).toEqual([MIC_KIND, 1, 2, 3]);
  });

  it("cuts 128-sample pieces into 480-sample planar stereo frames", () => {
    const c = new FrameChunker();
    const frames: Float32Array[] = [];
    let n = 0;
    for (let i = 0; i < 8; i++) {
      const l = new Float32Array(128).map(() => n++);
      const r = l.map((v) => -v);
      frames.push(...c.push([l, r]));
    }
    // 1024 samples: two whole frames, 64 left over.
    expect(frames.length).toBe(2);
    expect(frames[0].length).toBe(MIC_FRAME_SAMPLES * 2);
    expect(frames[0][0]).toBe(0);
    expect(frames[0][479]).toBe(479);
    expect(frames[0][480]).toBe(-0);
    expect(frames[0][959]).toBe(-479);
    expect(frames[1][0]).toBe(480);
    // The rest finishes the next frame.
    const more = c.push([new Float32Array(416).fill(7)]);
    expect(more.length).toBe(1);
    expect(more[0][63]).toBe(1023);
    expect(more[0][64]).toBe(7);
  });

  it("puts a mono mic on both channels", () => {
    const c = new FrameChunker();
    const [f] = c.push([new Float32Array(480).fill(0.5)]);
    expect(f[0]).toBe(0.5);
    expect(f[480]).toBe(0.5);
  });

  it("is unsupported without WebCodecs audio or when Opus CBR is refused", async () => {
    vi.stubGlobal("AudioEncoder", undefined);
    expect(await micSupported()).toBe(false);
    resetMicSupportedForTest();
    vi.stubGlobal("AudioEncoder", { isConfigSupported: async () => ({ supported: false }) });
    vi.stubGlobal("AudioData", class {});
    vi.stubGlobal("AudioWorkletNode", class {});
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => {} } });
    expect(await micSupported()).toBe(false);
    resetMicSupportedForTest();
    vi.stubGlobal("AudioEncoder", { isConfigSupported: async () => ({ supported: true }) });
    expect(await micSupported()).toBe(true);
  });
});
