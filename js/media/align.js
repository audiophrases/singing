/*
 * Auto-align: line up timing with a recording by listening to it.
 *
 *   alignNotes(features, notes)  an UltraStar melody against a song: where do
 *                                these pitches happen in this recording?
 *   alignRecordings(song, other) the karaoke version against the song: how
 *                                far apart are two copies of the same music?
 *
 * Both work on features(): per frame of ~23 ms, the strength of each of the 12
 * pitch classes (chroma, octave-proof like Pitch Pal) and how much new sound
 * starts (onsets). The audio is read at 11025 Hz, plenty for voices.
 */

import { makeFft } from './fft.js';

export const RATE = 11025;
const N = 2048;
const HOP = 256;
const FRAME = HOP / RATE;

// Decode an audio file (Blob) to mono samples at RATE. Browser only.
export async function decodeMono(blob) {
  const ctx = new OfflineAudioContext(1, 1, RATE);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  return toMono([...Array(buf.numberOfChannels).keys()].map((c) => buf.getChannelData(c)));
}

const rms = (a) => {
  let s = 0;
  for (let i = 0; i < a.length; i += 97) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, Math.ceil(a.length / 97)));
};

/*
 * The channels mixed to one. Old-style vocal removers leave the left channel
 * the exact opposite of the right, which mixes to silence: then one channel.
 */
export function toMono(channels) {
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i += 1) out[i] += ch[i] / channels.length;
  if (channels.length > 1 && rms(out) < 0.1 * rms(channels[0])) return Float32Array.from(channels[0]);
  return out;
}

/*
 * features(samples) -> { frames, chroma: Float32Array(frames * 12) (each frame
 * sums to 1), onset: Float32Array(frames) }
 */
export function features(samples, rate = RATE) {
  if (rate !== RATE) throw new Error(`features() needs ${RATE} Hz audio`);
  const frames = Math.max(0, 1 + Math.floor((samples.length - N) / HOP));
  const chroma = new Float32Array(frames * 12);
  const onset = new Float32Array(frames);
  const fft = makeFft(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i += 1) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  // Bins 150-2000 Hz feed the chroma (voices and their first harmonics).
  const pcOf = new Int8Array(N / 2).fill(-1);
  for (let k = 1; k < N / 2; k += 1) {
    const f = (k * RATE) / N;
    if (f > 150 && f < 2000) pcOf[k] = ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;
  }
  const hiBin = Math.floor((5000 * N) / RATE);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const pa = new Float64Array(N / 2);
  const pb = new Float64Array(N / 2);
  let prev = new Float64Array(N / 2);
  let cur = new Float64Array(N / 2);
  const pcs = new Float64Array(12);
  const take = (f, power) => {
    pcs.fill(0);
    let flux = 0;
    for (let k = 1; k < N / 2; k += 1) {
      const p = power[k];
      if (pcOf[k] >= 0) pcs[pcOf[k]] += p;
      const m = Math.log1p(Math.sqrt(p) * 10);
      cur[k] = m;
      if (k < hiBin && m > prev[k]) flux += m - prev[k];
    }
    let sum = 0;
    for (let c = 0; c < 12; c += 1) { pcs[c] = Math.sqrt(pcs[c]); sum += pcs[c]; }
    for (let c = 0; c < 12; c += 1) chroma[f * 12 + c] = sum > 0 ? pcs[c] / sum : 1 / 12;
    onset[f] = f ? flux : 0;
    const t = prev; prev = cur; cur = t;
  };
  // Two real frames per complex FFT: frame f in re, frame f + 1 in im.
  for (let f = 0; f < frames; f += 2) {
    const oa = f * HOP;
    const ob = (f + 1) * HOP;
    const second = f + 1 < frames;
    for (let i = 0; i < N; i += 1) {
      re[i] = samples[oa + i] * win[i];
      im[i] = second ? samples[ob + i] * win[i] : 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k += 1) {
      const zr = re[k]; const zi = im[k]; const wr = re[N - k]; const wi = im[N - k];
      pa[k] = ((zr + wr) ** 2 + (zi - wi) ** 2) / 4;
      pb[k] = ((zi + wi) ** 2 + (zr - wr) ** 2) / 4;
    }
    take(f, pa);
    if (second) take(f + 1, pb);
  }
  return { frames, chroma, onset };
}

const frameAt = (t) => Math.ceil((t * RATE - N / 2) / HOP);

/*
 * Where the melody of notes ([start, end, midi], seconds) sits in the
 * recording: the shift (seconds to add to every note) that puts the most
 * chroma on the notes' pitch classes. score is "times better than chance";
 * confident when the best shift clearly beats every other one.
 */
export function alignNotes(feat, notes, { range = 45, step = 0.05 } = {}) {
  const { frames, chroma } = feat;
  const pitched = notes.filter((n) => Number.isFinite(n[2]) && n[1] > n[0]);
  if (!frames || !pitched.length) return { offset: 0, score: 0, confident: false };
  // Running sums per pitch class: any span is two lookups.
  const cs = Array.from({ length: 12 }, () => new Float64Array(frames + 1));
  for (let c = 0; c < 12; c += 1) {
    const s = cs[c];
    for (let f = 0; f < frames; f += 1) s[f + 1] = s[f] + chroma[f * 12 + c];
  }
  const totalLen = pitched.reduce((a, n) => a + Math.max(1, frameAt(n[1]) - frameAt(n[0])), 0);
  const score = (off) => {
    let hit = 0;
    let len = 0;
    for (const n of pitched) {
      const a = frameAt(n[0] + off);
      const b = Math.max(a + 1, frameAt(n[1] + off));
      if (a < 0 || b > frames) continue;
      const s = cs[((n[2] % 12) + 12) % 12];
      hit += s[b] - s[a];
      len += b - a;
    }
    // Shifts that push most of the song off the recording do not count.
    return len >= totalLen * 0.6 ? (hit / len) * 12 : 0;
  };
  const coarse = [];
  for (let off = -range; off <= range + 1e-9; off += step) coarse.push([off, score(off)]);
  let [best, bestScore] = coarse.reduce((m, x) => (x[1] > m[1] ? x : m), [0, -1]);
  for (let off = best - step; off <= best + step + 1e-9; off += 0.01) {
    const s = score(off);
    if (s > bestScore) { best = off; bestScore = s; }
  }
  // The runner-up must be somewhere else (not just the same peak).
  const second = coarse.filter(([o]) => Math.abs(o - best) > 0.6).reduce((m, x) => Math.max(m, x[1]), 0);
  const offset = Math.round(best * 100) / 100;
  return { offset, score: bestScore, second, confident: bestScore >= 1.5 && bestScore >= second * 1.15 };
}

function zscore(a, from = 0, to = a.length) {
  let mean = 0;
  for (let i = from; i < to; i += 1) mean += a[i];
  mean /= Math.max(1, to - from);
  let v = 0;
  for (let i = from; i < to; i += 1) v += (a[i] - mean) ** 2;
  const sd = Math.sqrt(v / Math.max(1, to - from)) || 1;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = (a[i] - mean) / sd;
  return out;
}

// Correlation of x[i] with y[i + lag] over [from, to) of x.
function corrAt(x, y, lag, from = 0, to = x.length) {
  let s = 0;
  let n = 0;
  const lo = Math.max(from, -lag);
  const hi = Math.min(to, y.length - lag);
  for (let i = lo; i < hi; i += 1) { s += x[i] * y[i + lag]; n += 1; }
  return n > 50 ? s / n : 0;
}

/*
 * How much later (seconds) the same music happens in `other` than in `song`:
 * otherTime = songTime + offset. drift is how much that shift changes between
 * the first and second half (a different recording or tempo if large).
 */
export function alignRecordings(songFeat, otherFeat, { range = 30 } = {}) {
  const x = zscore(songFeat.onset);
  const y = zscore(otherFeat.onset);
  const maxLag = Math.round(range / FRAME);
  let best = 0;
  let bestC = -Infinity;
  const all = [];
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const c = corrAt(x, y, lag);
    all.push([lag, c]);
    if (c > bestC) { bestC = c; best = lag; }
  }
  // Between frames: the top of a parabola through the best three.
  const c0 = corrAt(x, y, best - 1);
  const c2 = corrAt(x, y, best + 1);
  const den = c0 - 2 * bestC + c2;
  const frac = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (c0 - c2)) / den)) : 0;
  const offset = Math.round((best + frac) * FRAME * 100) / 100;
  const away = Math.round(0.5 / FRAME);
  const second = all.filter(([lag]) => Math.abs(lag - best) > away).reduce((m, [, c]) => Math.max(m, c), 0);
  // Each half on its own, near the best shift.
  const half = Math.floor(x.length / 2);
  const local = (from, to) => {
    let bl = best;
    let bc = -Infinity;
    for (let lag = best - away; lag <= best + away; lag += 1) {
      const c = corrAt(x, y, lag, from, to);
      if (c > bc) { bc = c; bl = lag; }
    }
    return bl * FRAME;
  };
  const drift = Math.abs(local(half, x.length) - local(0, half));
  // Music that repeats every beat scores almost as well one beat off, so a
  // strong match counts even when the runner-up is close.
  const clear = bestC >= second * 1.2 || bestC >= 0.5;
  return { offset, corr: bestC, second, drift, confident: bestC >= 0.2 && clear && drift <= 0.12 };
}
