/*
 * MP3 encoding off the main thread (lamejs, LGPL, js/vendor/lamejs).
 * In: { left, right, rate, kbps } (Float32Array channels). Out: progress
 * messages, then { type: 'done', parts } (Uint8Array MP3 frames).
 */
/* global lamejs */
importScripts('../vendor/lamejs/lame.all.js');

const BLOCK = 1152 * 20;

function toInt16(x) {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i += 1) {
    const v = Math.max(-1, Math.min(1, x[i]));
    out[i] = v < 0 ? v * 32768 : v * 32767;
  }
  return out;
}

self.onmessage = ({ data }) => {
  try {
    const { left, right, rate, kbps } = data;
    const l = toInt16(left);
    const r = toInt16(right);
    const enc = new lamejs.Mp3Encoder(2, rate, kbps);
    const parts = [];
    let lastPct = -1;
    for (let i = 0; i < l.length; i += BLOCK) {
      const buf = enc.encodeBuffer(l.subarray(i, i + BLOCK), r.subarray(i, i + BLOCK));
      if (buf.length) parts.push(new Uint8Array(buf));
      const pct = Math.floor((i / l.length) * 100);
      if (pct !== lastPct) { lastPct = pct; self.postMessage({ type: 'progress', done: i, total: l.length }); }
    }
    const tail = enc.flush();
    if (tail.length) parts.push(new Uint8Array(tail));
    self.postMessage({ type: 'done', parts }, parts.map((p) => p.buffer));
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message || String(e) });
  }
};
