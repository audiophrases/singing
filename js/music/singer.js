/*
 * The robot singer: a glottal buzz through moving formants (a Klatt-style
 * cascade) with real consonants, tuned so that learners can make out the
 * words. The first version is kept in synth.js as "roboClassic" so the voice
 * lab (views/voicelab.js) can play both on the very same notes.
 *
 * What this version does differently, and why:
 *  - Hand-over. A note stops where the next syllable's consonants start.
 *    Before, the vowel kept sounding under them and filled the silence that
 *    makes a "t", "p" or "k" a stop.
 *  - Consonants. Sharper bursts coloured by where the tongue is (a "k"
 *    takes its colour from the vowel), aspiration after a stressed p, t, k
 *    (what tells "pin" from "bin"), louder hiss, released final stops.
 *  - Word stress. Small words and unstressed syllables are a little softer
 *    and quicker, so each word keeps its shape.
 *  - Less robotic. A slow pitch drift, a delayed vibrato, a scoop only into
 *    stressed syllables, a breath of air in the vowels, glides in melismas.
 *  - The mix. Its own EQ (presence, no rumble) and less reverb, and the band
 *    makes room around 3 kHz (Synth.setVoiceRoom).
 *
 * Two profiles: "sing" (the robot singer) and "clear" (Clear English): longer
 * and stronger consonants, wider vowels, no vibrato or scoops, fully released
 * final consonants, a short break before a word that starts with a vowel.
 * The melody, rhythm and timing are the same in all of them.
 *
 * A note also gets (from band.js melodyEvents, in seconds by fireEvent):
 *   stress 0|1|2, nextIn / nextOn / nextWord (the next note, when one follows
 *   straight on), prevIn / prevMidi (the note before).
 */
import { midiToFreq } from './notes.js';
import { syllablePhones, isVowelPhone } from '../lyrics/phonemes.js';

const VOWELS = {
  i: { f: [280, 2250, 2900] }, I: { f: [400, 1920, 2560] }, E: { f: [550, 1770, 2490] }, '@': { f: [690, 1660, 2430] },
  a: { f: [730, 1100, 2440] }, c: { f: [570, 840, 2410] }, '^': { f: [620, 1200, 2550] }, U: { f: [450, 1030, 2380] },
  u: { f: [310, 870, 2250] }, R: { f: [470, 1350, 1690] },
  e: { f: [480, 2000, 2600], to: [330, 2200, 2850] }, o: { f: [540, 920, 2400], to: [400, 800, 2300] },
  Y: { f: [730, 1150, 2440], to: [400, 1900, 2550] }, W: { f: [730, 1150, 2440], to: [420, 900, 2300] },
  O: { f: [570, 840, 2410], to: [400, 1900, 2550] },
};
// Unstressed "uh" is a schwa: the tongue at rest.
const SCHWA = { f: [520, 1400, 2480] };
const CENTRE = [500, 1500];

/*
 * Consonants. len: seconds (before the profile's scaling). Stops: closure,
 * then a burst of `burst` loudness, nf/nq its colour, blen its length.
 * Fricatives: hiss `n` through a band-pass at nf (Q nq).
 */
const CONS = {
  l: { k: 'glide', f: [360, 1100, 2700], v: 0.8, damp: 1.2, len: 0.06 },
  r: { k: 'glide', f: [420, 1250, 1600], v: 0.85, damp: 1, len: 0.06 },
  w: { k: 'glide', f: [300, 650, 2200], v: 0.85, damp: 1, len: 0.06 },
  y: { k: 'glide', f: [280, 2250, 3000], v: 0.85, damp: 1, len: 0.055 },
  // zero: the nasal's anti-resonance (where the closed mouth swallows sound).
  m: { k: 'nasal', at: 'lips', zero: 1000 }, n: { k: 'nasal', at: 'gum', zero: 1800 }, N: { k: 'nasal', at: 'soft', zero: 2800 },
  p: { k: 'stop', at: 'lips', burst: 0.45, nf: 1300, nq: 0.7, blen: 0.01 },
  b: { k: 'stop', at: 'lips', voiced: true, burst: 0.45, nf: 1300, nq: 0.7, blen: 0.008 },
  t: { k: 'stop', at: 'gum', burst: 0.65, nf: 4500, nq: 1.2, blen: 0.014 },
  d: { k: 'stop', at: 'gum', voiced: true, burst: 0.6, nf: 4000, nq: 1.2, blen: 0.01 },
  k: { k: 'stop', at: 'soft', burst: 0.8, nq: 2, blen: 0.025 },
  g: { k: 'stop', at: 'soft', voiced: true, burst: 0.6, nq: 2, blen: 0.018 },
  f: { k: 'fric', at: 'lips', n: 0.17, nf: 5000, nq: 0.6, len: 0.08 }, v: { k: 'fric', at: 'lips', voiced: true, n: 0.17, nf: 5000, nq: 0.6, len: 0.06 },
  T: { k: 'fric', at: 'teeth', n: 0.14, nf: 6000, nq: 0.5, len: 0.08 }, D: { k: 'fric', at: 'teeth', voiced: true, n: 0.14, nf: 6000, nq: 0.5, len: 0.05 },
  s: { k: 'fric', at: 'gum', n: 0.35, nf: 6500, nq: 1.5, len: 0.1 }, z: { k: 'fric', at: 'gum', voiced: true, n: 0.35, nf: 6500, nq: 1.5, len: 0.08 },
  S: { k: 'fric', at: 'roof', n: 0.4, nf: 3200, nq: 1.2, len: 0.1 }, Z: { k: 'fric', at: 'roof', voiced: true, n: 0.4, nf: 3200, nq: 1.2, len: 0.08 },
  h: { k: 'h' }, C: { k: 'affricate' }, J: { k: 'affricate', voiced: true },
};
// How quickly the vowel's formants arrive after each kind of consonant: a
// glide moves slowly into the vowel (that is what makes it a "w", not a "b"),
// a nasal opens suddenly.
const INTO_VOWEL = { glide: 0.09, nasal: 0.025, stop: 0.04, fric: 0.035, h: 0.02 };
const STOPS = new Set('pbtdkgCJ');

/*
 * hiss/burst/breath: consonant noise levels. vot: aspiration after p, t, k
 * in a stressed syllable (weak: unstressed). coda: how much a final stop is
 * released, codaAsp its puff of air. cons: consonant lengths; share: most of
 * a note they may take; lead/leadMax: how far before the beat they start.
 * stressGain/stressCons: loudness and consonant length by stress (0, 1, 2).
 * spread: vowels pushed away from the centre (clearer, less relaxed).
 * vib, vibDelay, scoop, glide, drift: pitch life. air: breath in the vowels.
 * gap: a break before a word that starts with a vowel. vox: the voice's EQ
 * and reverb (Synth.voxChain). level: matches the classic voice's loudness.
 */
export const PROFILES = {
  sing: {
    hiss: 2.1, burst: 2.4, breath: 1.6, vot: 0.05, votWeak: 0.02, coda: 0.85, codaAsp: 0.02,
    cons: 1, share: 0.6, lead: 0.8, leadMax: 0.11,
    stressGain: [0.8, 0.9, 1], stressCons: [0.85, 0.95, 1], spread: 1.04,
    vib: 0.009, vibDelay: 0.25, scoop: 0.02, glide: 0.05, drift: 0.003, air: 0.025,
    gap: 0, release: 0.07, xfade: 0.015, level: 0.36, bright: 8, brightAt: 2400,
    vox: { hp: 90, at: 3000, db: 3, q: 0.9, send: 0.15 },
  },
  clear: {
    hiss: 2.8, burst: 3, breath: 1.9, vot: 0.065, votWeak: 0.045, coda: 1, codaAsp: 0.03,
    cons: 1.2, share: 0.66, lead: 0.85, leadMax: 0.14,
    stressGain: [0.74, 0.85, 1], stressCons: [1, 1, 1], spread: 1.12,
    vib: 0, vibDelay: 0, scoop: 0, glide: 0.04, drift: 0.002, air: 0,
    gap: 0.035, release: 0.06, xfade: 0.012, level: 0.4, bright: 10, brightAt: 2200,
    vox: { hp: 110, at: 2800, db: 5, q: 0.8, send: 0.05 },
  },
};

function vowelOf(p, stress, P) {
  const vw = p === '^' && stress === 0 ? SCHWA : (VOWELS[p] || VOWELS['^']);
  const spread = (f) => f && f.map((x, j) => (j < 2 ? CENTRE[j] + (x - CENTRE[j]) * P.spread : x));
  return { f: spread(vw.f), to: spread(vw.to) };
}

// Where the tongue or lips close bends the next vowel's formants (locus).
function locus(at, vf) {
  if (at === 'lips') return [260, 0.7 * vf[1] + 150, 0.9 * vf[2]];
  if (at === 'teeth') return [280, 0.4 * vf[1] + 950, 2650];
  if (at === 'gum') return [260, 0.4 * vf[1] + 1050, 2700];
  if (at === 'roof') return [280, 0.3 * vf[1] + 1500, 2600];
  return [260, 0.9 * vf[1] + 250, Math.min(3000, 0.9 * vf[1] + 550)]; // soft palate (k, g, ng)
}

/*
 * A segment: a target for the voice. f: formants F1-F3; damp: how much wider
 * than usual their bandwidths are (one number, or one per formant); v, n, a:
 * buzz, hiss and breath levels; nf/nq: the hiss filter; zero: a nasal
 * anti-resonance (Hz); tr: how fast the formants get there; rise: how fast
 * the levels do (a burst is sudden); kind: what made it.
 */
const SEG = { f: null, damp: 1, v: 0, n: 0, nf: 3000, nq: 1, a: 0, zero: 0, tr: 0.03, rise: 0.008, kind: 'vowel' };
const seg = (o) => ({ ...SEG, ...o });

// The low hum of a closed mouth: F1 only, everything above it muffled.
const VOICE_BAR = [6, 10, 10];

// One consonant as timed segments. vf: formants of the vowel it leans on.
function consonantSegs(p, { coda, vf, prev, stress, P }) {
  const c = CONS[p];
  if (!c) return [];
  const kind = c.k === 'affricate' ? 'stop' : c.k;
  const scale = P.cons * P.stressCons[stress];
  const L = (x) => x * scale;
  const S = (o) => seg({ kind, ...o });
  switch (c.k) {
    case 'glide': return [S({ f: c.f, damp: c.damp, v: c.v, len: L(coda ? c.len + 0.02 : c.len) })];
    case 'nasal': return [S({ f: [260, ...locus(c.at, vf).slice(1)], damp: [1.2, 4, 4], v: 0.6, zero: c.zero, len: L(coda ? 0.1 : 0.065), tr: 0.015 })];
    case 'h': return [S({ f: vf, a: 0.4 * P.breath, len: L(0.065), tr: 0.01 })];
    case 'fric': {
      // Voiced fricatives buzz first and hiss second ("v" is mostly voice).
      const hiss = c.n * P.hiss * (c.voiced ? 0.5 : 1);
      return [S({ f: locus(c.at, vf), damp: 2, v: c.voiced ? 0.6 : 0, n: hiss, nf: c.nf, nq: c.nq, len: L(c.len + (coda ? 0.02 : 0)), tr: 0.02 })];
    }
    case 'affricate': {
      const fr = CONS[c.voiced ? 'Z' : 'S'];
      const f = locus('roof', vf);
      return [
        S({ f: [200, f[1], f[2]], damp: VOICE_BAR, v: c.voiced ? 0.15 : 0, len: L(0.05), tr: 0.012 }),
        S({ f, damp: 2, v: c.voiced ? 0.6 : 0, n: fr.n * P.hiss * (c.voiced ? 0.6 : 1.1), nf: fr.nf, nq: fr.nq, len: L(0.07), tr: 0.012, rise: 0.0015 }),
      ];
    }
    case 'stop': {
      const f = locus(c.at, vf);
      // A "k" bursts where the tongue meets the palate: high before "ee", lower before "oo".
      const nf = c.at === 'soft' ? Math.max(1500, Math.min(3300, vf[1] * 1.15 + 400)) : c.nf;
      const release = coda ? P.coda : 1;
      // The closure: silence, or for b, d, g only a low hum (a louder, brighter
      // one sounds like the tap in "butter").
      const out = [S({ f: [200, f[1], f[2]], damp: VOICE_BAR, v: c.voiced ? 0.15 : 0, len: L(c.voiced ? 0.065 : 0.07), tr: 0.012 })];
      if (release > 0) {
        out.push(S({ f, v: c.voiced ? 0.3 : 0, n: c.burst * P.burst * release * (c.voiced ? 0.7 : 1), nf, nq: c.nq, len: c.blen, tr: 0.004, rise: 0.0015 }));
      }
      // "pin" breathes after the p; "spin" doesn't, nor does an unstressed "-ter" much.
      const vot = c.voiced || prev === 's' ? 0 : coda ? P.codaAsp : stress ? P.vot : P.votWeak;
      if (vot > 0) out.push(S({ f: vf, a: 0.4 * P.breath, len: vot, tr: 0.02 }));
      return out;
    }
    default: return [];
  }
}

// How long before the beat a syllable's onset starts. Both a note and the one
// before it work this out (from nominal lengths) so the hand-over meets.
// room: how long the note before lasts; never take more than 40% of it.
export function onsetLead(on, room, P) {
  if (!on) return 0;
  const vf = VOWELS['^'].f;
  let len = 0;
  [...on].forEach((c, i, all) => {
    for (const s of consonantSegs(c, { coda: false, vf, prev: all[i - 1], stress: 2, P })) len += s.len;
  });
  return Math.min(len * P.lead, P.leadMax, room ? room * 0.4 : Infinity);
}

// The voice: a glottal pulse (Rosenberg), its harmonics cached per context.
const glottalWaves = new WeakMap();
function glottalWave(ctx) {
  if (glottalWaves.has(ctx)) return glottalWaves.get(ctx);
  const N = 1024;
  const H = 64;
  const open = 0.4;
  const close = 0.16;
  const flow = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    const x = i / N;
    if (x < open) flow[i] = 0.5 * (1 - Math.cos(Math.PI * x / open));
    else if (x < open + close) flow[i] = Math.cos(Math.PI * (x - open) / (2 * close));
  }
  const d = flow.map((v, i) => v - flow[(i + N - 1) % N]);
  const real = new Float32Array(H + 1);
  const imag = new Float32Array(H + 1);
  for (let h = 1; h <= H; h += 1) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < N; i += 1) {
      re += d[i] * Math.cos(2 * Math.PI * h * i / N);
      im += d[i] * Math.sin(2 * Math.PI * h * i / N);
    }
    real[h] = re;
    imag[h] = im;
  }
  const wave = ctx.createPeriodicWave(real, imag);
  glottalWaves.set(ctx, wave);
  return wave;
}

// A slow, smooth wander (-1..1) for the pitch: no human holds a note dead still.
const drifts = new WeakMap();
function driftBuffer(ctx) {
  if (drifts.has(ctx)) return drifts.get(ctx);
  const secs = 6;
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * secs), ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Whole cycles of each part, so the loop joins up.
  const parts = [...Array(4)].map(() => ({ c: Math.round((0.8 + Math.random() * 4.5) * secs), ph: Math.random() * 6.3 }));
  for (let i = 0; i < d.length; i += 1) {
    const x = (2 * Math.PI * i) / d.length;
    d[i] = parts.reduce((a, p) => a + Math.sin(p.c * x + p.ph), 0) / parts.length;
  }
  drifts.set(ctx, buf);
  return buf;
}

const BANDWIDTHS = [70, 90, 150];
const resonance = (f, bw) => Math.max(0, 20 * Math.log10(f / bw));

// Automate a param through [time, value] keys (times ascending).
function follow(param, keys) {
  let last = -Infinity;
  keys.forEach(([t, v], i) => {
    const at = Math.max(t, last + 1e-4);
    if (i === 0) param.setValueAtTime(v, at);
    else param.linearRampToValueAtTime(v, at);
    last = at;
  });
}

export function singRobo(sy, args, P) {
  const { voice, out: voiceOut, freq, t, dur, vel, text, first, last, ph } = args;
  const stress = args.stress ?? 2;
  const ctx = sy.ctx;
  const p = ph || syllablePhones(text || 'la', [text || 'la'])[0];
  const nu = [...(p.nu || '^')];
  const vowels = nu.filter(isVowelPhone);
  const v0 = vowels[0] || '^';
  const vN = vowels[vowels.length - 1] || v0;
  const opts = (vf, coda) => ({ coda, vf, stress, P });
  const on = [];
  const co = [];
  if (first) [...p.on].forEach((c, i, all) => on.push(...consonantSegs(c, { ...opts(vowelOf(v0, stress, P).f, false), prev: all[i - 1] })));
  if (last) {
    const vf = vowelOf(vN, stress, P);
    [...p.co].forEach((c, i, all) => co.push(...consonantSegs(c, { ...opts(vf.to || vf.f, true), prev: all[i - 1] })));
  }
  // Inside a melisma, notes before the last hold the first vowel; the last
  // one finishes the nucleus (the glide of "my", the "r" of "fire").
  const nuc = [];
  const seq = last ? nu : [v0];
  seq.forEach((x, i) => {
    if (!isVowelPhone(x)) {
      const next = seq.slice(i + 1).find(isVowelPhone) || vN;
      nuc.push(...consonantSegs(x, { ...opts(vowelOf(next, stress, P).f, false), prev: seq[i - 1] }));
      return;
    }
    const w = i === 0 ? 1.5 : 1;
    const vw = vowelOf(x, stress, P);
    if (vw.to && last) {
      nuc.push(seg({ f: vw.f, v: 1, a: P.air, w: w * 0.55, tr: 0.045 }), seg({ f: vw.to, v: 1, a: P.air, w: w * 0.45, glide: true }));
    } else {
      nuc.push(seg({ f: vw.f, v: 1, a: P.air, w, tr: 0.045 }));
    }
  });

  // Timing. The onset starts before the beat so the vowel lands on it; the
  // note hands over to the next one where that one's onset starts: a stop
  // after silence (its closure), anything else cross-fades, so a "h" or an
  // "l" doesn't follow a gap (a gap then a sound is heard as a "t").
  const onStr = first ? p.on : '';
  const pre = Math.min(onsetLead(onStr, args.prevIn, P), Math.max(0, t - ctx.currentTime - 0.005));
  const start = t - pre;
  let end = t + dur;
  let release = P.release;
  if (args.nextIn) {
    const nextOn = args.nextOn || '';
    const gap = P.gap && args.nextWord && !nextOn;
    end = t + args.nextIn - onsetLead(nextOn, args.nextIn, P) - (gap ? P.gap : 0);
    release = STOPS.has(nextOn[0]) || gap ? 0.012 : P.xfade;
    if (release === P.xfade) end += P.xfade / 2;
  }
  // Stops start from their silent closure; other sounds cross-fade with the
  // note before, or start softly after a rest. Clear English starts a word
  // after its break with a firm (but not clicking) vowel.
  const afterGap = P.gap && first && args.wordStart && !onStr;
  const fadeIn = STOPS.has(onStr[0]) ? 0.004
    : args.prevIn && !afterGap ? P.xfade
      : afterGap ? 0.012
        : onStr && CONS[onStr[0]]?.k !== 'glide' && CONS[onStr[0]]?.k !== 'nasal' ? 0.01 : 0.025;
  const span = Math.max(0.03, end - start);
  const segs = [...on, ...nuc, ...co];
  const consLen = segs.reduce((a, s) => a + (s.w ? 0 : s.len), 0);
  const k = consLen > span * P.share ? (span * P.share) / consLen : 1;
  const vowelTime = Math.max(0.01, span - consLen * k);
  const weights = nuc.reduce((a, s) => a + (s.w || 0), 0) || 1;
  // Vowels move in at the pace of the consonant before them.
  segs.forEach((s, i) => { if (s.w && i > 0 && INTO_VOWEL[segs[i - 1].kind]) s.tr = INTO_VOWEL[segs[i - 1].kind]; });
  let at = start;
  for (const s of segs) {
    s.s = at;
    at += s.w ? vowelTime * (s.w / weights) : s.len * k;
    s.e = at;
  }

  // Sources: the buzz (scoop, glide, vibrato, drift) and one noise for hiss and breath.
  const src = ctx.createOscillator();
  src.setPeriodicWave(glottalWave(ctx));
  const fq = src.frequency;
  if (!first && args.prevMidi != null) {
    fq.setValueAtTime(midiToFreq(args.prevMidi), start);
    fq.exponentialRampToValueAtTime(freq, start + P.glide);
  } else if (first && P.scoop && stress === 2) {
    fq.setValueAtTime(freq * (1 - P.scoop), Math.max(start, t - 0.02));
    fq.exponentialRampToValueAtTime(freq, t + 0.06);
  } else {
    fq.setValueAtTime(freq, start);
  }
  const stopAt = end + release + 0.05;
  const mods = [];
  if (P.vib && end - t > P.vibDelay + 0.15) {
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2 + Math.random() * 0.6;
    const depth = sy.gain(0);
    depth.gain.setValueAtTime(0, t + P.vibDelay);
    depth.gain.linearRampToValueAtTime(freq * P.vib, t + P.vibDelay + 0.3);
    vib.connect(depth);
    depth.connect(fq);
    mods.push(vib);
  }
  if (P.drift) {
    const wander = ctx.createBufferSource();
    wander.buffer = driftBuffer(ctx);
    wander.loop = true;
    const depth = sy.gain(freq * P.drift);
    wander.connect(depth);
    depth.connect(fq);
    wander.start(start, Math.random() * wander.buffer.duration);
    wander.stop(stopAt);
    voice.srcs.push(wander);
  }

  // The vocal tract: resonators in series (lowpass biquads with unity gain at
  // 0 Hz, so the vowel's spectrum balances itself). F4 and F5 stay put.
  const voicing = sy.gain(0);
  src.connect(voicing);
  const tractIn = sy.gain(1);
  voicing.connect(tractIn);
  const tract = [0, 1, 2, 3, 4].map((j) => sy.filter('lowpass', [500, 1500, 2500, 3300, 3850][j], 0));
  tract.reduce((a, b) => { a.connect(b); return b; }, tractIn);
  tract[3].Q.value = resonance(3300, 250);
  tract[4].Q.value = resonance(3850, 300);
  const sum = sy.gain(1);
  // Klatt's higher-pole correction: a real voice has formants above F5 that
  // keep its top end alive. Without them the cascade sounds muffled and the
  // F2/F3 movements that tell "b", "d" and "g" apart are buried.
  let tractOut = tract[4];
  if (P.bright) {
    const shelf = sy.filter('highshelf', P.brightAt, 0);
    shelf.gain.value = P.bright;
    tractOut.connect(shelf);
    tractOut = shelf;
  }
  // A nasal's anti-resonance: a notch that is only there during m, n, ng.
  const nasal = segs.some((s) => s.zero);
  let zero = null;
  if (nasal) {
    zero = sy.filter('peaking', 1500, 1.4);
    tractOut.connect(zero);
    zero.connect(sum);
  } else {
    tractOut.connect(sum);
  }

  const noisy = segs.some((s) => s.n > 0 || s.a > 0);
  let breath = null;
  let hiss = null;
  let hissGain = null;
  if (noisy) {
    const noiseIn = sy.gain(1);
    sy.noiseSrc(voice, start, stopAt, noiseIn);
    breath = sy.gain(0);
    noiseIn.connect(breath);
    breath.connect(tractIn);
    hiss = sy.filter('bandpass', 3000, 1);
    hissGain = sy.gain(0);
    noiseIn.connect(hiss);
    hiss.connect(hissGain);
    hissGain.connect(sum);
  }

  // Every segment is a target: formants glide, levels move quickly.
  const formantKeys = [[], [], []];
  const qKeys = [[], [], []];
  const levelKeys = { v: [], n: [], a: [], nf: [], nq: [], zg: [], zf: [] };
  let zf = 1500;
  segs.forEach((s, i) => {
    const reachF = i === 0 ? s.s : s.glide ? s.e : s.s + Math.min(s.tr, (s.e - s.s) * 0.6);
    const reachL = i === 0 ? s.s : s.s + Math.min(s.rise, (s.e - s.s) / 2);
    for (let j = 0; j < 3; j += 1) {
      const q = resonance(s.f[j], BANDWIDTHS[j] * (Array.isArray(s.damp) ? s.damp[j] : s.damp));
      formantKeys[j].push([reachF, s.f[j]], [s.e, s.f[j]]);
      qKeys[j].push([reachF, q], [s.e, q]);
    }
    if (s.zero) zf = s.zero;
    const lv = { v: s.v, n: s.n, a: s.a, nf: s.nf, nq: s.nq, zg: s.zero ? -20 : 0, zf };
    for (const key of Object.keys(lv)) levelKeys[key].push([reachL, lv[key]], [s.e, lv[key]]);
  });
  // A final stop is over once released: its burst must not hiss on through
  // the note's fade-out.
  const tail = segs[segs.length - 1];
  if (tail.kind === 'stop') for (const key of ['v', 'n', 'a']) levelKeys[key].push([tail.e + 0.008, 0]);
  for (let j = 0; j < 3; j += 1) {
    follow(tract[j].frequency, formantKeys[j]);
    follow(tract[j].Q, qKeys[j]);
  }
  follow(voicing.gain, levelKeys.v);
  if (zero) {
    follow(zero.gain, levelKeys.zg);
    follow(zero.frequency, levelKeys.zf);
  }
  if (noisy) {
    follow(breath.gain, levelKeys.a);
    follow(hissGain.gain, levelKeys.n);
    follow(hiss.frequency, levelKeys.nf);
    follow(hiss.Q, levelKeys.nq);
  }

  voiceOut.gain.value = 1;
  const out = sy.gain(0);
  sum.connect(out);
  out.connect(voiceOut);
  const peak = P.level * vel * P.stressGain[stress];
  const hold = args.nextIn ? end - release : end;
  follow(out.gain, [[start, 0], [start + fadeIn, peak], [Math.max(start + fadeIn, hold), peak], [hold + release, 0]]);

  src.start(start);
  src.stop(stopAt);
  for (const m of mods) { m.start(start); m.stop(stopAt); }
  voice.srcs.push(src, ...mods);
  return stopAt;
}
