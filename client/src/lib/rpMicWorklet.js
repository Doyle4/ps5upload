// The Remote Play mic's audio worklet (see remotePlayMic.ts): hands each block of the mic's
// samples to the page. A file of the app's own, not a blob: URL, because the desktop and phone
// apps' Content-Security-Policy allows scripts only from the app itself, and a worklet made from
// a blob was refused there: the mic never started (amber dot) in every app.
/* global AudioWorkletProcessor, registerProcessor */
class RpMic extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0];
    if (ch && ch.length) this.port.postMessage(ch.map((c) => c.slice()));
    return true;
  }
}
registerProcessor("rp-mic", RpMic);
