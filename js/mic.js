/*
 * The microphone: loudness (for the "sing louder!" meter) and pitch (for
 * Pitch Pal). Pitch uses the YIN method on short frames - good enough for
 * one voice, or a class singing in unison.
 */
import { getSynth } from './music/synth.js';

let shared = null;

export async function openMic() {
  if (shared) return shared;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot use a microphone.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
  const ctx = getSynth().ctx;
  if (ctx.state !== 'running') await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  shared = {
    stream,
    analyser,
    rate: ctx.sampleRate,
    // 0..1, roughly perceptual.
    level() {
      analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i += 1) s += buf[i] * buf[i];
      const rms = Math.sqrt(s / buf.length);
      const db = 20 * Math.log10(rms + 1e-9);
      return Math.max(0, Math.min(1, (db + 55) / 45));
    },
    // { freq, clarity } or null when nothing pitched is heard.
    pitch() {
      analyser.getFloatTimeDomainData(buf);
      return yin(buf, ctx.sampleRate);
    },
    close() {
      stream.getTracks().forEach((t) => t.stop());
      src.disconnect();
      shared = null;
    },
  };
  return shared;
}

export function closeMic() {
  if (shared) shared.close();
}

/*
 * YIN pitch detection (de Cheveigné & Kawahara, 2002), trimmed for voices
 * between ~70 Hz and ~1100 Hz.
 */
export function yin(buf, rate, threshold = 0.15) {
  let rms = 0;
  for (let i = 0; i < buf.length; i += 1) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.01) return null;
  const minTau = Math.floor(rate / 1100);
  const maxTau = Math.min(Math.floor(rate / 70), Math.floor(buf.length / 2));
  const size = maxTau + 1;
  const d = new Float32Array(size);
  const W = buf.length - maxTau;
  for (let tau = 1; tau < size; tau += 1) {
    let s = 0;
    for (let i = 0; i < W; i += 1) {
      const diff = buf[i] - buf[i + tau];
      s += diff * diff;
    }
    d[tau] = s;
  }
  // Cumulative mean normalised difference.
  let running = 0;
  d[0] = 1;
  for (let tau = 1; tau < size; tau += 1) {
    running += d[tau];
    d[tau] = running ? (d[tau] * tau) / running : 1;
  }
  let tau = -1;
  for (let t = minTau; t < size; t += 1) {
    if (d[t] < threshold) {
      while (t + 1 < size && d[t + 1] < d[t]) t += 1;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // Parabolic interpolation for sub-sample accuracy.
  const x0 = tau > 1 ? d[tau - 1] : d[tau];
  const x2 = tau + 1 < size ? d[tau + 1] : d[tau];
  const denom = x0 + x2 - 2 * d[tau];
  const better = denom ? tau + (x0 - x2) / (2 * denom) : tau;
  return { freq: rate / better, clarity: 1 - d[tau], rms };
}
