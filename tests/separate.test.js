import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEG, BINS, FRAMES, NFFT, segmentSpec, segmentWave, segmentStems, segmentWeights, separateSong, segmentCount, STRIDE } from '../js/media/separate.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 - 0.5; };
}
// Tones below 10 kHz (demucs drops the very top bin, so no white noise).
const signal = (n, seed, f = 330) => {
  const r = rng(seed);
  const parts = [[f, 0.3, 0], ...Array.from({ length: 8 }, () => [200 + (r() + 0.5) * 9000, 0.03, r() * 6])];
  return Float32Array.from({ length: n }, (_, i) => parts.reduce((a, [hz, amp, ph]) => a + amp * Math.sin((2 * Math.PI * hz * i) / 44100 + ph), 0));
};
const maxDiff = (a, b, from, to) => {
  let m = 0;
  for (let i = from; i < to; i += 1) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

// A stand-in for the model: the vocals are the whole spectrogram, the rest is silence.
function echoModel(mix, mag) {
  const x = new Float32Array(4 * 4 * BINS * FRAMES);
  x.set(mag, 3 * 4 * BINS * FRAMES);
  return { x, xt: new Float32Array(4 * 2 * SEG) };
}

test('spectrogram and back give the segment again', () => {
  const l = signal(SEG, 1);
  const r = signal(SEG, 2, 523);
  const mag = segmentSpec(l, r);
  assert.equal(mag.length, 4 * BINS * FRAMES);
  const plane = BINS * FRAMES;
  const back = segmentWave((c, b, f) => [mag[2 * c * plane + b * FRAMES + f], mag[(2 * c + 1) * plane + b * FRAMES + f]]);
  // The first frames of a segment are not kept by demucs, so its very start is approximate.
  assert.ok(maxDiff(back.left, l, NFFT, SEG - NFFT) < 1e-4, `left ${maxDiff(back.left, l, NFFT, SEG - NFFT)}`);
  assert.ok(maxDiff(back.right, r, NFFT, SEG - NFFT) < 1e-4);
});

test('the left and right spectra are not mixed up', () => {
  const l = signal(SEG, 1, 300);
  const silent = new Float32Array(SEG);
  const mag = segmentSpec(l, silent);
  const plane = BINS * FRAMES;
  let left = 0;
  let right = 0;
  for (let i = 0; i < plane; i += 1) { left += Math.abs(mag[i]) + Math.abs(mag[plane + i]); right += Math.abs(mag[2 * plane + i]) + Math.abs(mag[3 * plane + i]); }
  assert.ok(right < left * 1e-6, `${right} vs ${left}`);
});

test('stems: time and spectrogram parts add up, karaoke is tracks 0-2', () => {
  const x = new Float32Array(4 * 4 * BINS * FRAMES);
  const xt = new Float32Array(4 * 2 * SEG);
  for (let t = 0; t < 4; t += 1) xt.fill(t + 1, (t * 2) * SEG, (t * 2) * SEG + SEG); // left channel = t + 1
  const s = segmentStems(x, xt);
  assert.equal(s.karaoke.left[1000], 1 + 2 + 3);
  assert.equal(s.vocals.left[1000], 4);
  assert.equal(s.vocals.right[1000], 0);
});

test('cross-fade weights are demucs triangles', () => {
  const w = segmentWeights();
  assert.equal(w.length, SEG);
  assert.ok(w[0] > 0 && w[SEG - 1] > 0, 'never zero, so the song edges are not lost');
  assert.equal(Math.max(...w.subarray(SEG / 2 - 2, SEG / 2 + 2)), 1);
  assert.equal(segmentCount(SEG * 3), Math.ceil((SEG * 3) / STRIDE));
});

test('a whole song through the stand-in model comes back as the vocals', async () => {
  const n = Math.floor(44100 * 20.5);
  const l = signal(n, 3);
  const r = signal(n, 4, 440);
  const seen = [];
  const out = await separateSong(l, r, async (mix, mag) => echoModel(mix, mag), { onProgress: (d, t) => seen.push([d, t]) });
  assert.equal(seen.length, segmentCount(n));
  assert.deepEqual(seen.at(-1), [segmentCount(n), segmentCount(n)]);
  assert.ok(maxDiff(out.vocals[0], l, NFFT, n - NFFT) < 2e-3, `vocals ${maxDiff(out.vocals[0], l, NFFT, n - NFFT)}`);
  assert.ok(maxDiff(out.vocals[1], r, NFFT, n - NFFT) < 2e-3);
  assert.ok(maxDiff(out.karaoke[0], new Float32Array(n), 0, n) < 1e-3, 'karaoke silent');
});
