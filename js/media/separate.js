/*
 * Karaoke maker: take the singer out of a recording with Demucs (htdemucs v4,
 * Meta AI, MIT licence), running in this browser. This file is the sound
 * maths around the model, written to match demucs exactly; the model itself
 * runs in separate-worker.js.
 *
 * The model hears 7.8 s at a time (SEG samples at 44.1 kHz), as a waveform
 * (mix) and as its spectrogram (mag), and answers four stems (drums, bass,
 * other, vocals) both ways: x (spectrograms) and xt (waveforms). Pieces
 * overlap by a quarter and are cross-faded with demucs's triangle weights.
 * The karaoke version is drums + bass + other.
 */
import { makeFft } from './fft.js';

export const SR = 44100;
export const NFFT = 4096;
export const HOP = 1024;
export const SEG = 343980;
export const BINS = 2048;
export const FRAMES = 336;
const PAD = (HOP / 2) * 3;
const SPEC_LEN = FRAMES * HOP + 2 * PAD; // the reflect-padded segment
const ALL_FRAMES = FRAMES + 4; // torch.stft(center=True) frames; demucs keeps 2..337
const OLA_LEN = (ALL_FRAMES - 1) * HOP + NFFT;

const fft = makeFft(NFFT);
const win = new Float64Array(NFFT);
for (let i = 0; i < NFFT; i += 1) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NFFT);
const norm = 1 / Math.sqrt(NFFT);

// torch's reflect padding (the edge sample is not repeated).
function reflect(x, i) {
  const n = x.length;
  let j = i;
  while (j < 0 || j >= n) j = j < 0 ? -j : 2 * (n - 1) - j;
  return x[j];
}

/*
 * The model's spectrogram input for one segment: [4, BINS, FRAMES], left
 * real, left imaginary, right real, right imaginary (demucs _spec + _magnitude).
 */
export function segmentSpec(left, right) {
  const out = new Float32Array(4 * BINS * FRAMES);
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  const plane = BINS * FRAMES;
  // demucs pads the segment (reflect) to SPEC_LEN, then torch.stft centres
  // each frame (reflect NFFT / 2 more); frame f of the model is stft frame f + 2.
  const at = (x, i) => {
    const k = i - NFFT / 2;
    const inner = k < 0 || k >= SPEC_LEN ? (k < 0 ? -k : 2 * (SPEC_LEN - 1) - k) : k;
    return reflect(x, inner - PAD);
  };
  for (let f = 0; f < FRAMES; f += 1) {
    const start = (f + 2) * HOP;
    for (let i = 0; i < NFFT; i += 1) {
      re[i] = at(left, start + i) * win[i];
      im[i] = at(right, start + i) * win[i];
    }
    fft(re, im);
    // Two real signals in one FFT: split them by symmetry.
    for (let b = 0; b < BINS; b += 1) {
      const c = b === 0 ? 0 : NFFT - b;
      const o = b * FRAMES + f;
      out[o] = ((re[b] + re[c]) / 2) * norm;
      out[plane + o] = ((im[b] - im[c]) / 2) * norm;
      out[2 * plane + o] = ((im[b] + im[c]) / 2) * norm;
      out[3 * plane + o] = ((re[c] - re[b]) / 2) * norm;
    }
  }
  return out;
}

// Where each sample of a segment comes from in the inverse STFT (demucs _ispec).
const envelope = (() => {
  const e = new Float64Array(OLA_LEN);
  for (let f = 0; f < ALL_FRAMES; f += 1) for (let i = 0; i < NFFT; i += 1) e[f * HOP + i] += win[i] * win[i];
  return e;
})();
const FIRST = NFFT / 2 + PAD;

/*
 * A stereo spectrogram back to SEG samples. spec(c, b, f) gives the complex
 * value [re, im] of audio channel c (0 left, 1 right), bin b, frame f.
 */
export function segmentWave(spec) {
  const ola = [new Float64Array(OLA_LEN), new Float64Array(OLA_LEN)];
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  for (let f = 0; f < FRAMES; f += 1) {
    // Both channels at once: Z = L + iR, both Hermitian, so ifft(Z) = l + i r.
    re.fill(0);
    im.fill(0);
    for (let b = 0; b < BINS; b += 1) {
      const [lr, li] = spec(0, b, f);
      const [rr, ri] = spec(1, b, f);
      re[b] = lr - ri; im[b] = li + rr;
      if (b > 0) { re[NFFT - b] = lr + ri; im[NFFT - b] = rr - li; }
    }
    fft(im, re); // inverse (times NFFT)
    const start = (f + 2) * HOP;
    const scale = 1 / (NFFT * norm);
    for (let i = 0; i < NFFT; i += 1) {
      ola[0][start + i] += re[i] * scale * win[i];
      ola[1][start + i] += im[i] * scale * win[i];
    }
  }
  const left = new Float32Array(SEG);
  const right = new Float32Array(SEG);
  for (let i = 0; i < SEG; i += 1) {
    const e = envelope[FIRST + i];
    left[i] = e > 1e-11 ? ola[0][FIRST + i] / e : 0;
    right[i] = e > 1e-11 ? ola[1][FIRST + i] / e : 0;
  }
  return { left, right };
}

/*
 * The model's answer for one segment as two stereo signals: the karaoke
 * version (tracks 0-2 summed) and the vocals (track 3). x: [4, 4, BINS,
 * FRAMES] (track, left re / left im / right re / right im), xt: [4, 2, SEG].
 */
export function segmentStems(x, xt) {
  const at =(t, k, b, f) => x[((t * 4 + k) * BINS + b) * FRAMES + f];
  const stem = (tracks) => {
    const wave = segmentWave((c, b, f) => {
      let r = 0;
      let i = 0;
      for (const t of tracks) { r += at(t, 2 * c, b, f); i += at(t, 2 * c + 1, b, f); }
      return [r, i];
    });
    for (const t of tracks) {
      for (let s = 0; s < SEG; s += 1) {
        wave.left[s] += xt[(t * 2) * SEG + s];
        wave.right[s] += xt[(t * 2 + 1) * SEG + s];
      }
    }
    return wave;
  };
  return { karaoke: stem([0, 1, 2]), vocals: stem([3]) };
}

// demucs apply_model's cross-fade: a triangle, 1 at the edges, peak in the middle.
export function segmentWeights() {
  const w = new Float32Array(SEG);
  const half = Math.floor(SEG / 2);
  for (let i = 0; i < SEG; i += 1) w[i] = (i < half ? i + 1 : SEG - i) / half;
  return w;
}

export const STRIDE = Math.floor(SEG * 0.75);
export const segmentCount = (length) => Math.max(1, Math.ceil(length / STRIDE));

/*
 * Separate a whole song. run(mix, mag) runs the model on one segment and
 * resolves { x, xt }. Resolves { karaoke: [left, right], vocals: [left, right] }.
 */
export async function separateSong(left, right, run, { onProgress = () => {}, cancelled = () => false } = {}) {
  const n = left.length;
  // demucs normalises the whole song first (and undoes it at the end).
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += (left[i] + right[i]) / 2;
  mean /= n || 1;
  let v = 0;
  for (let i = 0; i < n; i += 1) v += ((left[i] + right[i]) / 2 - mean) ** 2;
  const std = Math.sqrt(v / Math.max(1, n - 1)) || 1;
  const out = { karaoke: [new Float32Array(n), new Float32Array(n)], vocals: [new Float32Array(n), new Float32Array(n)] };
  const sum = new Float32Array(n);
  const w = segmentWeights();
  const total = segmentCount(n);
  let done = 0;
  for (let offset = 0; offset < n; offset += STRIDE) {
    if (cancelled()) throw new Error('cancelled');
    const len = Math.min(SEG, n - offset);
    const segL = new Float32Array(SEG);
    const segR = new Float32Array(SEG);
    for (let i = 0; i < len; i += 1) {
      segL[i] = (left[offset + i] - mean) / std;
      segR[i] = (right[offset + i] - mean) / std;
    }
    const mix = new Float32Array(2 * SEG);
    mix.set(segL, 0);
    mix.set(segR, SEG);
    const { x, xt } = await run(mix, segmentSpec(segL, segR));
    const stems = segmentStems(x, xt);
    for (const name of ['karaoke', 'vocals']) {
      const [ol, or] = out[name];
      const { left: sl, right: sr } = stems[name];
      for (let i = 0; i < len; i += 1) {
        ol[offset + i] += sl[i] * w[i];
        or[offset + i] += sr[i] * w[i];
      }
    }
    for (let i = 0; i < len; i += 1) sum[offset + i] += w[i];
    done += 1;
    onProgress(done, total);
  }
  for (const [name, stems] of [['karaoke', 3], ['vocals', 1]]) {
    for (const ch of out[name]) for (let i = 0; i < n; i += 1) ch[i] = (ch[i] / sum[i]) * std + mean * stems;
  }
  return out;
}

// 16-bit WAV of a stereo signal.
export function wavBlob([left, right], rate = SR) {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0, o = 44; i < n; i += 1, o += 4) {
    v.setInt16(o, Math.max(-1, Math.min(1, left[i])) * 32767, true);
    v.setInt16(o + 2, Math.max(-1, Math.min(1, right[i])) * 32767, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
