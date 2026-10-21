/*
 * How loud a recording sounds, in LUFS (ITU-R BS.1770: K-weighting, 400 ms
 * blocks, absolute and relative gates). Used to play two versions of a voice
 * at the same loudness, so the louder one does not win just by being louder.
 *
 *   loudness([left, right], 44100) -> -23.4
 */

// The K-weighting filter (a high shelf, then a high-pass) for any sample rate.
function kFilters(rate) {
  let K = Math.tan(Math.PI * 1681.974450955533 / rate);
  const Q = 0.7071752369554196;
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0],
    a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0],
  };
  K = Math.tan(Math.PI * 38.13547087602444 / rate);
  const Q2 = 0.5003270373238773;
  a0 = 1 + K / Q2 + K * K;
  const hp = { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q2 + K * K) / a0] };
  return [shelf, hp];
}

function biquad(x, { b, a }) {
  const y = new Float32Array(x.length);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

export function loudness(channels, rate) {
  const filters = kFilters(rate);
  const weighted = channels.map((ch) => filters.reduce((x, f) => biquad(x, f), ch));
  const n = weighted[0].length;
  const block = Math.round(0.4 * rate);
  const step = Math.round(0.1 * rate);
  const power = (from, to) => {
    let z = 0;
    for (const w of weighted) {
      let s = 0;
      for (let i = from; i < to; i += 1) s += w[i] * w[i];
      z += s / Math.max(1, to - from);
    }
    return z;
  };
  const blocks = [];
  if (n < block) blocks.push(power(0, n));
  for (let i = 0; i + block <= n; i += step) blocks.push(power(i, i + block));
  const lufs = (z) => -0.691 + 10 * Math.log10(z);
  const loud = blocks.filter((z) => z > 0 && lufs(z) > -70);
  if (!loud.length) return -Infinity;
  const mean = (list) => list.reduce((a, z) => a + z, 0) / list.length;
  const gate = lufs(mean(loud)) - 10;
  const kept = loud.filter((z) => lufs(z) > gate);
  return lufs(mean(kept.length ? kept : loud));
}

export function peak(channels) {
  let p = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i += 1) p = Math.max(p, Math.abs(ch[i]));
  return p;
}

/*
 * Gains that bring every version to the same loudness, as loud as possible
 * without any of them clipping (and never above `target` LUFS).
 *   matchGains([{ lufs, peak }, ...]) -> [gain, ...]
 */
export function matchGains(list, target = -16) {
  let level = target;
  for (const { lufs, peak: p } of list) {
    if (!Number.isFinite(lufs) || !p) continue;
    level = Math.min(level, lufs + 20 * Math.log10(0.95 / p));
  }
  return list.map(({ lufs }) => (Number.isFinite(lufs) ? 10 ** ((level - lufs) / 20) : 1));
}
