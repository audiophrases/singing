/*
 * The Singing band: every instrument is synthesized live with Web Audio, so
 * songs need no audio files, any tempo sounds clean, and any key works.
 *
 *   const synth = getSynth();          // one per page
 *   synth.note('epiano', { midi, time, dur, vel, bus: 'comp' });
 *   synth.drum('snare', time, vel);
 *   synth.stopAll();                   // pause: everything off now
 *
 * Buses (comp, bass, drums, lead, fx) each have their own volume so a screen
 * can mute the guide melody for karaoke or solo the drums for a chant.
 */
import { midiToFreq } from './notes.js';
import { syllablePhones, isVowelPhone } from '../lyrics/phonemes.js';
import { singRobo, PROFILES } from './singer.js';

let shared = null;

export function getSynth() {
  if (!shared) shared = new Synth();
  return shared;
}

export function audioContext() {
  return getSynth().ctx;
}

// Call from a click/keypress: browsers start audio only after a gesture.
export async function unlockAudio() {
  const s = getSynth();
  if (s.ctx.state !== 'running') {
    try { await s.ctx.resume(); } catch { /* still locked */ }
  }
  return s.ctx.state === 'running';
}

const BUSES = ['comp', 'bass', 'drums', 'lead', 'pad', 'fx'];

export class Synth {
  // ctx: an OfflineAudioContext to render into a buffer (see render.js).
  constructor(ctx = null) {
    this.offline = !!ctx && typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    this.ctx = ctx || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.2;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;
    // The compressor adds make-up gain, so the odd peak went past full scale
    // and clipped. A soft ceiling instead: untouched below -0.9 dBFS.
    this.ceiling = ctx.createWaveShaper();
    this.ceiling.curve = makeCeilingCurve();
    const toCeiling = ctx.createGain();
    toCeiling.gain.value = 1 / CEILING_RANGE;
    this.master.connect(this.comp);
    this.comp.connect(toCeiling);
    toCeiling.connect(this.ceiling);
    this.ceiling.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.2, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.22;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    this.bus = {};
    this.busSend = {};
    // The band can make room for the singer (setVoiceRoom): a dip around
    // 3 kHz where consonants live, and a little less band. Flat (and so
    // silent) until asked.
    this.room = [];
    this.bandOut = ctx.createGain();
    this.bandOut.connect(this.master);
    for (const name of BUSES) {
      const g = ctx.createGain();
      const send = ctx.createGain();
      send.gain.value = name === 'drums' ? 0.08 : name === 'bass' ? 0.04 : 0.3;
      const out = name === 'lead' || name === 'fx' ? this.master : this.bandOut;
      if (name === 'comp' || name === 'pad' || name === 'drums') {
        const dip = this.filter('peaking', 2800, 0.8);
        dip.gain.value = 0;
        g.connect(dip);
        dip.connect(out);
        this.room.push(dip);
      } else {
        g.connect(out);
      }
      g.connect(send);
      send.connect(this.reverb);
      this.bus[name] = g;
      this.busSend[name] = send;
    }
    this.bus.lead.gain.value = 0.9;
    this.bus.comp.gain.value = 0.55;
    this.bus.pad.gain.value = 0.35;
    this.bus.bass.gain.value = 0.75;
    this.bus.drums.gain.value = 0.7;

    // Rock style runs the comp bus through a gentle overdrive.
    this.drive = ctx.createWaveShaper();
    this.drive.curve = makeDriveCurve(2.2);
    this.drive.oversample = '2x';
    this.driveOut = ctx.createGain();
    this.driveOut.gain.value = 0.55;
    this.drive.connect(this.driveOut);
    this.driveOut.connect(this.bandOut);
    this.driveOut.connect(this.busSend.comp);

    this.noise = this.makeNoise(2);
    this.ksCache = new Map();
    this.voices = new Set();
    this.vox = new Map();
  }

  get now() {
    return this.ctx.currentTime;
  }

  setBusVolume(name, v, ramp = 0.05) {
    const g = this.bus[name];
    if (!g) return;
    const t = this.ctx.currentTime;
    const params = [g.gain, ...(name === 'lead' ? [...this.vox.values()].map((c) => c.out.gain) : [])];
    for (const p of params) {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(Math.max(0, v), t, ramp);
    }
  }

  // Room for the singer: { dip, duck } dB the band dips around 3 kHz, and
  // plays quieter (a number: the dip alone).
  setVoiceRoom(room = 0) {
    const { dip = 0, duck = 0 } = typeof room === 'number' ? { dip: room } : room || {};
    const t = this.ctx.currentTime;
    for (const f of this.room) f.gain.setTargetAtTime(-Math.max(0, dip), t, 0.05);
    this.bandOut.gain.setTargetAtTime(10 ** (-Math.max(0, duck) / 20), t, 0.05);
  }

  /*
   * A singer's own channel: high-pass, presence boost and its own reverb
   * send, then the lead bus volume (so muting the lead mutes it too).
   * cfg: { hp, at, db, q, send } (see PROFILES in singer.js).
   */
  voxChain(cfg) {
    let c = this.vox.get(cfg);
    if (!c) {
      const hp = this.filter('highpass', cfg.hp, 0.7);
      const presence = this.filter('peaking', cfg.at, cfg.q);
      presence.gain.value = cfg.db;
      const out = this.gain(this.bus.lead.gain.value);
      const send = this.gain(cfg.send);
      hp.connect(presence);
      presence.connect(out);
      out.connect(this.master);
      out.connect(send);
      send.connect(this.reverb);
      c = { input: hp, out };
      this.vox.set(cfg, c);
    }
    return c.input;
  }

  setReverb(v) {
    this.reverbGain.gain.setTargetAtTime(Math.max(0, v), this.ctx.currentTime, 0.1);
  }

  makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch += 1) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i += 1) {
        const t = i / len;
        // Early reflections then a smooth tail.
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < rate * 0.01 ? 0.4 : 1);
      }
    }
    return buf;
  }

  track(voice, endTime) {
    // Rendering into a buffer never needs to stop notes early.
    if (this.offline) return voice;
    this.voices.add(voice);
    const ms = Math.max(0, (endTime - this.ctx.currentTime) * 1000) + 200;
    voice.timer = setTimeout(() => this.voices.delete(voice), ms);
    return voice;
  }

  stopAll(fade = 0.04) {
    const t = this.ctx.currentTime;
    for (const v of this.voices) {
      clearTimeout(v.timer);
      try {
        v.out.gain.cancelScheduledValues(t);
        v.out.gain.setValueAtTime(v.out.gain.value, t);
        v.out.gain.linearRampToValueAtTime(0, t + fade);
      } catch { /* already gone */ }
      for (const s of v.srcs) {
        try { s.stop(t + fade + 0.02); } catch { /* not started or stopped */ }
      }
    }
    this.voices.clear();
  }

  destFor(bus, inst) {
    if (bus === 'comp' && inst && inst.drive) return this.drive;
    if (bus === 'lead' && inst && inst.vox) return this.voxChain(inst.vox);
    return this.bus[bus] || this.bus.comp;
  }

  // ---------------------------------------------------------------- notes

  // Anything else in the options (the robot singer's stress, next note...)
  // goes through to the instrument.
  note(inst, { midi, time, dur, vel = 0.8, bus = 'comp', text = '', first = true, last = true, ph = null, pan = 0, ...more }) {
    const def = INSTRUMENTS[inst] || INSTRUMENTS.piano;
    const t = Math.max(time, this.ctx.currentTime);
    const out = this.ctx.createGain();
    out.gain.value = 0;
    let node = out;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      node = p;
    }
    node.connect(this.destFor(bus, def));
    const voice = { out, srcs: [] };
    const end = def.play(this, { ...more, voice, out, midi, freq: midiToFreq(midi), t, dur: Math.max(0.03, dur), vel, text, first, last, ph });
    return this.track(voice, end);
  }

  drum(kind, time, vel = 0.9, bus = 'drums') {
    const fn = DRUMS[kind];
    if (!fn) return null;
    const t = Math.max(time, this.ctx.currentTime);
    const out = this.ctx.createGain();
    out.gain.value = vel;
    out.connect(this.bus[bus] || this.bus.drums);
    const voice = { out, srcs: [] };
    const end = fn(this, voice, out, t, vel);
    return this.track(voice, end);
  }

  osc(voice, type, freq, t, end, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(end);
    voice.srcs.push(o);
    return o;
  }

  noiseSrc(voice, t, end, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    s.connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(end);
    voice.srcs.push(s);
    return s;
  }

  filter(type, freq, q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  gain(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  // Karplus-Strong plucked string, rendered once per pitch and cached.
  pluckBuffer(midi, kind) {
    const key = `${kind}:${midi}`;
    if (this.ksCache.has(key)) return this.ksCache.get(key);
    const rate = this.ctx.sampleRate;
    const f = midiToFreq(midi);
    const secs = kind === 'uke' ? 1.1 : kind === 'harp' ? 2.2 : 1.8;
    const len = Math.floor(rate * secs);
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    const N = Math.max(2, Math.round(rate / f - 0.5));
    const damp = kind === 'uke' ? 0.994 : kind === 'harp' ? 0.9985 : 0.996;
    const bright = kind === 'harp' ? 0.35 : kind === 'uke' ? 0.55 : 0.5;
    let last = 0;
    for (let i = 0; i < N; i += 1) {
      // Lowpassed noise burst: a softer pick.
      const r = Math.random() * 2 - 1;
      last = last + bright * (r - last);
      d[i] = last;
    }
    for (let i = N; i < len; i += 1) {
      d[i] = damp * 0.5 * (d[i - N] + d[i - N - 1 < 0 ? 0 : i - N - 1]);
    }
    // Remove DC and normalise.
    let mean = 0;
    for (let i = 0; i < len; i += 1) mean += d[i];
    mean /= len;
    let peak = 0;
    for (let i = 0; i < len; i += 1) { d[i] -= mean; peak = Math.max(peak, Math.abs(d[i])); }
    if (peak > 0) for (let i = 0; i < len; i += 1) d[i] /= peak;
    const rateFix = f / (rate / (N + 0.5));
    const out = { buf, rateFix };
    this.ksCache.set(key, out);
    return out;
  }
}

// The ceiling's curve covers inputs up to CEILING_RANGE (scaled into the
// shaper's -1..1): straight up to 0.9, then bending smoothly towards 1.
const CEILING_RANGE = 4;
export function makeCeilingCurve(n = 8193) {
  const curve = new Float32Array(n);
  const knee = 0.9;
  for (let i = 0; i < n; i += 1) {
    const x = ((i / (n - 1)) * 2 - 1) * CEILING_RANGE;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

function makeDriveCurve(amount) {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

// ADSR on a gain param. Returns the time the sound is fully gone.
function env(param, t, dur, { a = 0.005, d = 0.1, s = 0.7, r = 0.1, peak = 1 }) {
  const relStart = t + Math.max(dur, a);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(peak * s, t + a, Math.max(0.001, d / 3));
  param.setValueAtTime(peak * s, relStart);
  param.setTargetAtTime(0, relStart, Math.max(0.001, r / 4));
  return relStart + r + 0.05;
}

// Percussive: attack then exponential decay (ignores note length unless shorter).
function decayEnv(param, t, dur, { a = 0.003, decay = 1, peak = 1, cut = true, r = 0.08 }) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(0, t + a, decay / 4);
  if (cut && dur < decay) {
    param.setTargetAtTime(0, t + dur, r / 4);
    return t + dur + r + 0.05;
  }
  return t + decay + 0.1;
}

// ------------------------------------------------------------- phones (robo)

/*
 * The robot singer speaks in phones (see js/lyrics/phonemes.js). Each one is
 * a target for the voice: formants F1-F3 (and how damped), how much buzz
 * (voicing), hiss (frication noise and its filter) and breath (aspiration
 * through the formants). Consonants take their formants from the vowel next
 * to them, which is what makes "ba", "da" and "ga" sound different.
 */
const VOWELS = {
  i: { f: [280, 2250, 2900] }, I: { f: [400, 1920, 2560] }, E: { f: [550, 1770, 2490] }, '@': { f: [690, 1660, 2430] },
  a: { f: [730, 1100, 2440] }, c: { f: [570, 840, 2410] }, '^': { f: [620, 1200, 2550] }, U: { f: [450, 1030, 2380] },
  u: { f: [310, 870, 2250] }, R: { f: [470, 1350, 1690] },
  e: { f: [480, 2000, 2600], to: [330, 2200, 2850] }, o: { f: [540, 920, 2400], to: [400, 800, 2300] },
  Y: { f: [730, 1150, 2440], to: [400, 1900, 2550] }, W: { f: [730, 1150, 2440], to: [420, 900, 2300] },
  O: { f: [570, 840, 2410], to: [400, 1900, 2550] },
};
const vowelStart = (p) => (VOWELS[p] || VOWELS['^']).f;
const vowelEnd = (p) => (VOWELS[p] || VOWELS['^']).to || vowelStart(p);

const CONSONANTS = {
  l: { k: 'glide', f: [360, 1100, 2700], v: 0.7, damp: 1.5 },
  r: { k: 'glide', f: [420, 1250, 1600], v: 0.75, damp: 1 },
  w: { k: 'glide', f: [300, 700, 2200], v: 0.65, damp: 1.5 },
  y: { k: 'glide', f: [280, 2200, 3000], v: 0.65, damp: 1 },
  m: { k: 'nasal', at: 'lips' }, n: { k: 'nasal', at: 'gum' }, N: { k: 'nasal', at: 'soft' },
  p: { k: 'stop', at: 'lips', nf: 1100, nq: 0.7 }, b: { k: 'stop', at: 'lips', voiced: true, nf: 1100, nq: 0.7 },
  t: { k: 'stop', at: 'gum', nf: 4500, nq: 1 }, d: { k: 'stop', at: 'gum', voiced: true, nf: 4000, nq: 1 },
  k: { k: 'stop', at: 'soft', nf: 2300, nq: 2 }, g: { k: 'stop', at: 'soft', voiced: true, nf: 2200, nq: 2 },
  f: { k: 'fric', at: 'lips', n: 0.15, nf: 5000, nq: 0.6, len: 0.07 }, v: { k: 'fric', at: 'lips', voiced: true, n: 0.15, nf: 5000, nq: 0.6, len: 0.06 },
  T: { k: 'fric', at: 'teeth', n: 0.12, nf: 5500, nq: 0.6, len: 0.07 }, D: { k: 'fric', at: 'teeth', voiced: true, n: 0.12, nf: 5500, nq: 0.6, len: 0.05 },
  s: { k: 'fric', at: 'gum', n: 0.35, nf: 6500, nq: 1.5, len: 0.09 }, z: { k: 'fric', at: 'gum', voiced: true, n: 0.35, nf: 6500, nq: 1.5, len: 0.07 },
  S: { k: 'fric', at: 'roof', n: 0.4, nf: 2700, nq: 2, len: 0.09 }, Z: { k: 'fric', at: 'roof', voiced: true, n: 0.4, nf: 2700, nq: 2, len: 0.07 },
  h: { k: 'h' }, C: { k: 'affricate' }, J: { k: 'affricate', voiced: true },
};

// Where the tongue or lips close bends the next vowel's formants (locus).
function locus(at, vf) {
  if (at === 'lips') return [260, 0.7 * vf[1] + 150, 0.9 * vf[2]];
  if (at === 'teeth') return [280, 0.4 * vf[1] + 950, 2650];
  if (at === 'gum') return [260, 0.4 * vf[1] + 1050, 2700];
  if (at === 'roof') return [280, 0.3 * vf[1] + 1500, 2600];
  return [260, 0.9 * vf[1] + 250, Math.min(3000, 0.9 * vf[1] + 550)]; // soft palate (k, g, ng)
}

const SEG = { f: null, damp: 1, v: 0, n: 0, nf: 3000, nq: 1, a: 0, tr: 0.03 };
const seg = (o) => ({ ...SEG, ...o });

// One consonant as timed segments. vf: formants of the vowel it leans on.
function consonantSegs(p, coda, vf, prev) {
  const c = CONSONANTS[p];
  if (!c) return [];
  const voice = c.voiced ? 0.45 : 0;
  switch (c.k) {
    case 'glide': return [seg({ f: c.f, damp: c.damp, v: c.v, len: coda ? 0.08 : 0.05 })];
    case 'nasal': return [seg({ f: [250, ...locus(c.at, vf).slice(1)], damp: 3, v: 0.6, len: coda ? 0.09 : 0.06, tr: 0.02 })];
    case 'h': return [seg({ f: vf, a: 0.35, len: 0.06, tr: 0.01 })];
    case 'fric': return [seg({ f: locus(c.at, vf), damp: 2, v: voice, n: c.n * (c.voiced ? 0.6 : 1), nf: c.nf, nq: c.nq, len: c.len + (coda ? 0.02 : 0), tr: 0.02 })];
    case 'affricate': {
      const fr = CONSONANTS[c.voiced ? 'Z' : 'S'];
      const f = locus('roof', vf);
      return [
        seg({ f, damp: 3, v: c.voiced ? 0.2 : 0, len: 0.04, tr: 0.015 }),
        seg({ f, damp: 2, v: voice, n: fr.n * (c.voiced ? 0.6 : 1), nf: fr.nf, nq: fr.nq, len: 0.07, tr: 0.015 }),
      ];
    }
    case 'stop': {
      const f = locus(c.at, vf);
      const out = [
        seg({ f, damp: 3, v: c.voiced ? 0.2 : 0, len: c.voiced ? 0.035 : 0.05, tr: 0.015 }),
        seg({ f, v: c.voiced ? 0.3 : 0, n: (c.voiced ? 0.25 : 0.45) * (coda ? 0.6 : 1), nf: c.nf, nq: c.nq, len: 0.012, tr: 0.005 }),
      ];
      // "pin" breathes after the p; "spin" doesn't.
      if (!coda && !c.voiced && prev !== 's') out.push(seg({ f: vf, a: 0.35, len: 0.035, tr: 0.02 }));
      return out;
    }
    default: return [];
  }
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
  // Lips radiate the derivative of the airflow.
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

// Formant bandwidths (Hz) for F1-F3, and a lowpass biquad's Q (in dB) for a
// resonator of that bandwidth: its peak is about F / B above the 0 Hz level.
const BANDWIDTHS = [70, 90, 150];
const resonance = (f, bw) => Math.max(0, 20 * Math.log10(f / bw));

// The robot voice's balance: hiss and breath levels, consonant lengths and a
// formant scale. Tuned by rendering test lines and scoring them with a speech
// recognizer; exported so that can be done again.
export const ROBO = { hiss: 1.5, breath: 1.5, cons: 1, formants: 1 };

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

// ------------------------------------------------------------- instruments

const INSTRUMENTS = {
  piano: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const ctx = sy.ctx;
      const lp = sy.filter('lowpass', Math.min(9000, freq * 7), 0.4);
      lp.connect(out);
      const decay = Math.max(0.6, 3.2 - freq / 400);
      const end = Math.min(t + dur + 0.35, t + decay + 0.3);
      const car = sy.osc(voice, 'sine', freq, t, end, lp);
      const mod = ctx.createOscillator();
      mod.frequency.value = freq * 2;
      const mg = sy.gain(freq * 2.2);
      mg.gain.setValueAtTime(freq * 2.2, t);
      mg.gain.setTargetAtTime(freq * 0.3, t, 0.15);
      mod.connect(mg);
      mg.connect(car.frequency);
      mod.start(t);
      mod.stop(end);
      voice.srcs.push(mod);
      const tg = sy.gain(0.22);
      tg.connect(lp);
      sy.osc(voice, 'triangle', freq, t, end, tg);
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(0.32 * vel, t + 0.004);
      out.gain.setTargetAtTime(0, t + 0.004, decay / 4);
      out.gain.setTargetAtTime(0, t + dur, 0.06);
      return end;
    },
  },
  epiano: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const ctx = sy.ctx;
      const end = t + dur + 0.6;
      const car = sy.osc(voice, 'sine', freq, t, end, out);
      const mod = ctx.createOscillator();
      mod.frequency.value = freq;
      const mg = sy.gain(0);
      mg.gain.setValueAtTime(freq * 1.6 * vel, t);
      mg.gain.setTargetAtTime(freq * 0.15, t, 0.25);
      mod.connect(mg);
      mg.connect(car.frequency);
      mod.start(t);
      mod.stop(end);
      // Tine "ping".
      const tine = ctx.createOscillator();
      tine.frequency.value = freq * 14;
      const tg = sy.gain(0);
      tg.gain.setValueAtTime(freq * 0.8, t);
      tg.gain.setTargetAtTime(0, t, 0.03);
      tine.connect(tg);
      tg.connect(car.frequency);
      tine.start(t);
      tine.stop(end);
      voice.srcs.push(mod, tine);
      return decayEnv(out.gain, t, dur, { a: 0.003, decay: 2.2, peak: 0.3 * vel, r: 0.25 });
    },
  },
  organ: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + dur + 0.12;
      const vib = sy.ctx.createOscillator();
      vib.frequency.value = 5.8;
      const vg = sy.gain(freq * 0.004);
      vib.connect(vg);
      vib.start(t);
      vib.stop(end);
      voice.srcs.push(vib);
      [[1, 0.5], [2, 0.3], [3, 0.18], [4, 0.12], [0.5, 0.2]].forEach(([mult, amp]) => {
        const g = sy.gain(amp);
        g.connect(out);
        const o = sy.osc(voice, 'sine', freq * mult, t, end, g);
        vg.connect(o.frequency);
      });
      env(out.gain, t, dur, { a: 0.008, d: 0.05, s: 1, r: 0.08, peak: 0.22 * vel });
      return end + 0.1;
    },
  },
  accordion: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + dur + 0.15;
      const lp = sy.filter('lowpass', 2600, 0.8);
      const bp = sy.filter('peaking', 1200, 1.2);
      bp.gain.value = 5;
      lp.connect(bp);
      bp.connect(out);
      for (const det of [-7, 0, 6]) {
        const o = sy.osc(voice, 'sawtooth', freq, t, end, lp);
        o.detune.value = det;
      }
      env(out.gain, t, dur, { a: 0.04, d: 0.1, s: 0.85, r: 0.1, peak: 0.12 * vel });
      return end + 0.1;
    },
  },
  guitar: {
    play(sy, { voice, out, midi, freq, t, dur, vel }) {
      const { buf, rateFix } = sy.pluckBuffer(midi, 'guitar');
      const src = sy.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rateFix;
      const lp = sy.filter('lowpass', Math.min(8000, freq * 9), 0.5);
      src.connect(lp);
      lp.connect(out);
      const end = t + Math.min(dur + 0.25, buf.duration);
      src.start(t);
      src.stop(end + 0.05);
      voice.srcs.push(src);
      out.gain.setValueAtTime(0.42 * vel, t);
      out.gain.setValueAtTime(0.42 * vel, Math.max(t, end - 0.2));
      out.gain.linearRampToValueAtTime(0, end);
      return end + 0.05;
    },
    drive: false,
  },
  uke: {
    play(sy, { voice, out, midi, t, dur, vel }) {
      const { buf, rateFix } = sy.pluckBuffer(midi, 'uke');
      const src = sy.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rateFix;
      src.connect(out);
      const end = t + Math.min(dur + 0.2, buf.duration);
      src.start(t);
      src.stop(end + 0.05);
      voice.srcs.push(src);
      out.gain.setValueAtTime(0.38 * vel, t);
      out.gain.setValueAtTime(0.38 * vel, Math.max(t, end - 0.15));
      out.gain.linearRampToValueAtTime(0, end);
      return end + 0.05;
    },
  },
  harp: {
    play(sy, { voice, out, midi, t, dur, vel }) {
      const { buf, rateFix } = sy.pluckBuffer(midi, 'harp');
      const src = sy.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rateFix;
      src.connect(out);
      const end = t + Math.min(Math.max(dur, 1.2), buf.duration);
      src.start(t);
      src.stop(end + 0.05);
      voice.srcs.push(src);
      out.gain.setValueAtTime(0.3 * vel, t);
      out.gain.setValueAtTime(0.3 * vel, Math.max(t, end - 0.3));
      out.gain.linearRampToValueAtTime(0, end);
      return end + 0.05;
    },
  },
  bells: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + Math.max(1.4, dur);
      [[1, 0.6, 1.4], [2.76, 0.25, 0.5], [5.4, 0.12, 0.25], [8.93, 0.06, 0.12]].forEach(([mult, amp, dec]) => {
        const g = sy.gain(0);
        g.connect(out);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp, t + 0.002);
        g.gain.setTargetAtTime(0, t + 0.002, dec / 3);
        sy.osc(voice, 'sine', freq * mult, t, end, g);
      });
      out.gain.setValueAtTime(0.35 * vel, t);
      return end;
    },
  },
  marimba: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + 0.8;
      [[1, 0.7, 0.5], [4, 0.2, 0.08], [9.2, 0.05, 0.03]].forEach(([mult, amp, dec]) => {
        const g = sy.gain(0);
        g.connect(out);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp, t + 0.002);
        g.gain.setTargetAtTime(0, t + 0.002, dec / 3);
        sy.osc(voice, 'sine', freq * mult, t, end, g);
      });
      out.gain.setValueAtTime(0.45 * vel, t);
      return end;
    },
  },
  pad: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + dur + 0.8;
      const lp = sy.filter('lowpass', 1400, 0.7);
      lp.connect(out);
      for (const det of [-12, -4, 5, 11]) {
        const o = sy.osc(voice, 'sawtooth', freq, t, end, lp);
        o.detune.value = det;
      }
      env(out.gain, t, dur, { a: 0.35, d: 0.3, s: 0.8, r: 0.7, peak: 0.07 * vel });
      return end + 0.2;
    },
  },
  strings: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + dur + 0.5;
      const lp = sy.filter('lowpass', 3200, 0.6);
      lp.connect(out);
      const vib = sy.ctx.createOscillator();
      vib.frequency.value = 5.2;
      const vg = sy.gain(freq * 0.006);
      vib.connect(vg);
      vib.start(t + 0.2);
      vib.stop(end);
      voice.srcs.push(vib);
      for (const det of [-6, 0, 7]) {
        const o = sy.osc(voice, 'sawtooth', freq, t, end, lp);
        o.detune.value = det;
        vg.connect(o.frequency);
      }
      env(out.gain, t, dur, { a: 0.15, d: 0.2, s: 0.85, r: 0.4, peak: 0.08 * vel });
      return end + 0.1;
    },
  },
  brass: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + dur + 0.12;
      const lp = sy.filter('lowpass', 600, 1.5);
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.linearRampToValueAtTime(Math.min(6000, freq * 8), t + 0.06);
      lp.frequency.setTargetAtTime(freq * 4, t + 0.06, 0.15);
      lp.connect(out);
      sy.osc(voice, 'sawtooth', freq, t, end, lp);
      const o2 = sy.osc(voice, 'sawtooth', freq, t, end, lp);
      o2.detune.value = 8;
      env(out.gain, t, dur, { a: 0.03, d: 0.1, s: 0.75, r: 0.08, peak: 0.16 * vel });
      return end + 0.1;
    },
  },
  bass: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + dur + 0.08;
      const lp = sy.filter('lowpass', 900, 2);
      lp.frequency.setValueAtTime(1100, t);
      lp.frequency.setTargetAtTime(300, t, 0.12);
      lp.connect(out);
      sy.osc(voice, 'sawtooth', freq, t, end, lp);
      const sub = sy.gain(0.9);
      sub.connect(out);
      sy.osc(voice, 'sine', freq, t, end, sub);
      env(out.gain, t, dur * 0.95, { a: 0.006, d: 0.25, s: 0.6, r: 0.06, peak: 0.42 * vel });
      return end + 0.05;
    },
  },
  upright: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + dur + 0.1;
      const lp = sy.filter('lowpass', 700, 1);
      lp.connect(out);
      sy.osc(voice, 'triangle', freq, t, end, lp);
      const s2 = sy.gain(0.6);
      s2.connect(out);
      sy.osc(voice, 'sine', freq, t, end, s2);
      decayEnv(out.gain, t, dur, { a: 0.01, decay: 0.9, peak: 0.6 * vel, r: 0.08 });
      return end + 0.1;
    },
  },
  tuba: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + dur + 0.1;
      const lp = sy.filter('lowpass', 500, 1);
      lp.connect(out);
      sy.osc(voice, 'sawtooth', freq, t, end, lp);
      const s2 = sy.gain(0.7);
      s2.connect(out);
      sy.osc(voice, 'sine', freq, t, end, s2);
      env(out.gain, t, dur * 0.85, { a: 0.035, d: 0.1, s: 0.8, r: 0.07, peak: 0.38 * vel });
      return end + 0.05;
    },
  },
  synthbass: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + dur + 0.06;
      const lp = sy.filter('lowpass', 400, 6);
      lp.frequency.setValueAtTime(1800, t);
      lp.frequency.setTargetAtTime(220, t, 0.08);
      lp.connect(out);
      sy.osc(voice, 'square', freq, t, end, lp);
      const sub = sy.gain(1);
      sub.connect(out);
      sy.osc(voice, 'sine', freq / 2, t, end, sub);
      env(out.gain, t, dur * 0.9, { a: 0.004, d: 0.2, s: 0.7, r: 0.05, peak: 0.35 * vel });
      return end + 0.05;
    },
  },
  chip: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + dur + 0.03;
      sy.osc(voice, 'square', freq, t, end, out);
      env(out.gain, t, dur * 0.9, { a: 0.002, d: 0.05, s: 0.6, r: 0.02, peak: 0.09 * vel });
      return end + 0.05;
    },
  },
  chipbass: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + dur + 0.03;
      sy.osc(voice, 'triangle', freq, t, end, out);
      env(out.gain, t, dur * 0.9, { a: 0.002, d: 0.05, s: 0.9, r: 0.02, peak: 0.45 * vel });
      return end + 0.05;
    },
  },
  flute: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + dur + 0.12;
      const vib = sy.ctx.createOscillator();
      vib.frequency.value = 5;
      const vg = sy.gain(0);
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(freq * 0.012, t + Math.min(0.4, dur));
      vib.connect(vg);
      vib.start(t);
      vib.stop(end);
      voice.srcs.push(vib);
      const o = sy.osc(voice, 'sine', freq, t, end, out);
      vg.connect(o.frequency);
      const h = sy.gain(0.12);
      h.connect(out);
      const o2 = sy.osc(voice, 'triangle', freq * 2, t, end, h);
      vg.connect(o2.frequency);
      const bp = sy.filter('bandpass', freq * 2, 2);
      const ng = sy.gain(0.05);
      bp.connect(ng);
      ng.connect(out);
      sy.noiseSrc(voice, t, end, bp);
      env(out.gain, t, dur, { a: 0.04, d: 0.1, s: 0.85, r: 0.1, peak: 0.32 * vel });
      return end + 0.05;
    },
  },
  whistle: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + dur + 0.08;
      const o = sy.osc(voice, 'sine', freq * 2, t, end, out);
      o.frequency.setValueAtTime(freq * 2 * 0.97, t);
      o.frequency.linearRampToValueAtTime(freq * 2, t + 0.04);
      env(out.gain, t, dur, { a: 0.02, d: 0.05, s: 0.9, r: 0.06, peak: 0.22 * vel });
      return end + 0.05;
    },
  },
  synthlead: {
    play(sy, { voice, out, freq, t, dur, vel }) {
      const end = t + dur + 0.1;
      const lp = sy.filter('lowpass', freq * 6, 3);
      lp.connect(out);
      const a = sy.osc(voice, 'sawtooth', freq, t, end, lp);
      const b = sy.osc(voice, 'square', freq, t, end, lp);
      a.detune.value = -6;
      b.detune.value = 6;
      env(out.gain, t, dur, { a: 0.01, d: 0.1, s: 0.7, r: 0.08, peak: 0.12 * vel });
      return end + 0.05;
    },
  },
  // The robot singer (singer.js), and its Clear English profile. Each has its
  // own EQ and reverb on the lead bus.
  robo: {
    vox: PROFILES.sing.vox,
    play: (sy, args) => singRobo(sy, args, PROFILES.sing),
  },
  roboClear: {
    vox: PROFILES.clear.vox,
    play: (sy, args) => singRobo(sy, args, PROFILES.clear),
  },
  // The original robot singer, unchanged, so the voice lab can compare: a
  // glottal buzz through moving formants, with real consonants (see "phones"
  // above). A note sings its share of a syllable: the first note brings the
  // onset ("tw" of "twin"), the last the coda.
  roboClassic: {
    play(sy, { voice, out: voiceOut, freq, t, dur, vel, text, first, last, ph }) {
      const ctx = sy.ctx;
      const p = ph || syllablePhones(text || 'la', [text || 'la'])[0];
      const nu = [...(p.nu || '^')];
      const vowels = nu.filter(isVowelPhone);
      const v0 = vowels[0] || '^';
      const vN = vowels[vowels.length - 1] || v0;
      const on = [];
      const co = [];
      if (first) [...p.on].forEach((c, i, all) => on.push(...consonantSegs(c, false, vowelStart(v0), all[i - 1])));
      if (last) [...p.co].forEach((c, i, all) => co.push(...consonantSegs(c, true, vowelEnd(vN), all[i - 1])));
      // Inside a melisma, notes before the last hold the first vowel; the last
      // one finishes the nucleus (the glide of "my", the "r" of "fire").
      const nuc = [];
      const seq = last ? nu : [v0];
      seq.forEach((x, i) => {
        if (!isVowelPhone(x)) {
          const next = seq.slice(i + 1).find(isVowelPhone) || vN;
          nuc.push(...consonantSegs(x, false, vowelStart(next), seq[i - 1]));
          return;
        }
        const w = i === 0 ? 1.5 : 1;
        const vw = VOWELS[x] || VOWELS['^'];
        if (vw.to && last) {
          nuc.push(seg({ f: vw.f, v: 1, w: w * 0.55, tr: 0.045 }), seg({ f: vw.to, v: 1, w: w * 0.45, glide: true }));
        } else {
          nuc.push(seg({ f: vw.f, v: 1, w, tr: 0.045 }));
        }
      });

      // Timing: the onset starts a little before the beat so the vowel lands
      // on it, as singers do; consonants never take more than half the note.
      const lenOf = (list) => list.reduce((a, s) => a + (s.len || 0) * ROBO.cons, 0);
      const onLen = lenOf(on);
      const pre = on.length ? Math.min(onLen * 0.6, 0.07, Math.max(0, t - ctx.currentTime - 0.01)) : 0;
      const start = t - pre;
      const span = dur + pre;
      const consLen = onLen + lenOf(co) + lenOf(nuc);
      const k = consLen > span * 0.55 ? (span * 0.55) / consLen : 1;
      const vowelTime = span - consLen * k;
      const weights = nuc.reduce((a, s) => a + (s.w || 0), 0) || 1;
      const segs = [...on, ...nuc, ...co];
      let at = start;
      for (const s of segs) {
        s.s = at;
        at += s.w ? vowelTime * (s.w / weights) : s.len * ROBO.cons * k;
        s.e = at;
      }

      // Sources: the buzz (with a scoop and vibrato) and one noise for hiss and breath.
      const src = ctx.createOscillator();
      src.setPeriodicWave(glottalWave(ctx));
      src.frequency.setValueAtTime(freq, start);
      if (first) {
        src.frequency.setValueAtTime(freq * 0.97, t);
        src.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
      }
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vibDepth = sy.gain(0);
      vibDepth.gain.setValueAtTime(0, t);
      vibDepth.gain.linearRampToValueAtTime(freq * 0.01, t + Math.min(0.5, dur));
      vib.connect(vibDepth);
      vibDepth.connect(src.frequency);
      const end = t + dur + 0.1;

      // The vocal tract: resonators in series, like a Klatt synthesizer. A
      // resonant lowpass biquad is a resonator with unity gain at 0 Hz, so the
      // vowel's spectrum comes out balanced by itself. F4 and F5 stay put.
      const voicing = sy.gain(0);
      src.connect(voicing);
      const tractIn = sy.gain(1);
      voicing.connect(tractIn);
      const tract = [0, 1, 2, 3, 4].map((j) => sy.filter('lowpass', [500, 1500, 2500, 3300, 3850][j], 0));
      tract.reduce((a, b) => { a.connect(b); return b; }, tractIn);
      tract[3].Q.value = resonance(3300, 250);
      tract[4].Q.value = resonance(3850, 300);
      const sum = sy.gain(1);
      tract[4].connect(sum);

      const noisy = segs.some((s) => s.n > 0 || s.a > 0);
      let breath = null;
      let hiss = null;
      let hissGain = null;
      if (noisy) {
        const noiseIn = sy.gain(1);
        sy.noiseSrc(voice, start, end, noiseIn);
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
      const levelKeys = { v: [], n: [], a: [], nf: [], nq: [] };
      segs.forEach((s, i) => {
        const reachF = i === 0 ? s.s : s.glide ? s.e : s.s + Math.min(s.tr, (s.e - s.s) * 0.6);
        const reachL = i === 0 ? s.s : s.s + Math.min(0.008, (s.e - s.s) / 2);
        for (let j = 0; j < 3; j += 1) {
          const f = s.f[j] * ROBO.formants;
          const q = resonance(f, BANDWIDTHS[j] * s.damp);
          formantKeys[j].push([reachF, f], [s.e, f]);
          qKeys[j].push([reachF, q], [s.e, q]);
        }
        const lv = { v: s.v, n: s.n * ROBO.hiss, a: s.a * ROBO.breath, nf: s.nf, nq: s.nq };
        for (const key of Object.keys(lv)) levelKeys[key].push([reachL, lv[key]], [s.e, lv[key]]);
      });
      for (let j = 0; j < 3; j += 1) {
        follow(tract[j].frequency, formantKeys[j]);
        follow(tract[j].Q, qKeys[j]);
      }
      follow(voicing.gain, levelKeys.v);
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
      const peak = 0.32 * vel; // as loud as the old robot voice
      follow(out.gain, [[start, 0], [start + (first ? 0.006 : 0.02), peak], [t + dur, peak], [t + dur + 0.05, 0]]);

      src.start(start);
      src.stop(end);
      vib.start(start);
      vib.stop(end);
      voice.srcs.push(src, vib);
      return end + 0.05;
    },
  },
  click: {
    play(sy, { voice, out, freq, t, vel }) {
      const end = t + 0.08;
      const o = sy.osc(voice, 'sine', freq, t, end, out);
      o.frequency.setValueAtTime(freq, t);
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(0.5 * vel, t + 0.001);
      out.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      return end;
    },
  },
};

export const INSTRUMENT_NAMES = Object.keys(INSTRUMENTS);

// ------------------------------------------------------------------ drums

const DRUMS = {
  kick(sy, voice, out, t) {
    const o = sy.osc(voice, 'sine', 150, t, t + 0.5, out);
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    out.gain.setValueAtTime(out.gain.value * 1.1, t);
    out.gain.setTargetAtTime(0, t + 0.02, 0.09);
    const click = sy.filter('highpass', 2000, 0.7);
    const cg = sy.gain(0);
    cg.gain.setValueAtTime(0.25, t);
    cg.gain.linearRampToValueAtTime(0, t + 0.012);
    click.connect(cg);
    cg.connect(out);
    sy.noiseSrc(voice, t, t + 0.02, click);
    return t + 0.5;
  },
  snare(sy, voice, out, t, vel) {
    const hp = sy.filter('highpass', 1200, 0.7);
    const ng = sy.gain(0);
    ng.gain.setValueAtTime(0.55 * vel, t);
    ng.gain.setTargetAtTime(0, t, 0.05);
    hp.connect(ng);
    ng.connect(out);
    sy.noiseSrc(voice, t, t + 0.3, hp);
    const body = sy.gain(0);
    body.gain.setValueAtTime(0.5 * vel, t);
    body.gain.setTargetAtTime(0, t, 0.03);
    body.connect(out);
    const o = sy.osc(voice, 'triangle', 190, t, t + 0.15, body);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    out.gain.value = 1;
    return t + 0.35;
  },
  hat(sy, voice, out, t, vel) {
    const hp = sy.filter('highpass', 7500, 0.8);
    hp.connect(out);
    sy.noiseSrc(voice, t, t + 0.08, hp);
    out.gain.setValueAtTime(0.32 * vel, t);
    out.gain.setTargetAtTime(0, t, 0.015);
    return t + 0.1;
  },
  openhat(sy, voice, out, t, vel) {
    const hp = sy.filter('highpass', 7000, 0.8);
    hp.connect(out);
    sy.noiseSrc(voice, t, t + 0.4, hp);
    out.gain.setValueAtTime(0.28 * vel, t);
    out.gain.setTargetAtTime(0, t, 0.09);
    return t + 0.45;
  },
  clap(sy, voice, out, t, vel) {
    const bp = sy.filter('bandpass', 1150, 0.9);
    bp.connect(out);
    sy.noiseSrc(voice, t, t + 0.3, bp);
    const g = out.gain;
    g.setValueAtTime(0, t);
    for (let i = 0; i < 3; i += 1) {
      g.setValueAtTime(0.9 * vel, t + i * 0.011);
      g.setTargetAtTime(0, t + i * 0.011 + 0.001, 0.004);
    }
    g.setValueAtTime(0.8 * vel, t + 0.034);
    g.setTargetAtTime(0, t + 0.034, 0.05);
    return t + 0.32;
  },
  snap(sy, voice, out, t, vel) {
    const bp = sy.filter('bandpass', 2800, 3);
    bp.connect(out);
    sy.noiseSrc(voice, t, t + 0.06, bp);
    out.gain.setValueAtTime(1.2 * vel, t);
    out.gain.setTargetAtTime(0, t, 0.012);
    return t + 0.08;
  },
  rim(sy, voice, out, t, vel) {
    const bp = sy.filter('bandpass', 1700, 6);
    bp.connect(out);
    sy.osc(voice, 'square', 820, t, t + 0.04, bp);
    sy.noiseSrc(voice, t, t + 0.03, bp);
    out.gain.setValueAtTime(0.7 * vel, t);
    out.gain.setTargetAtTime(0, t, 0.01);
    return t + 0.06;
  },
  shaker(sy, voice, out, t, vel) {
    const hp = sy.filter('highpass', 5500, 0.7);
    hp.connect(out);
    sy.noiseSrc(voice, t, t + 0.12, hp);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.22 * vel, t + 0.03);
    out.gain.setTargetAtTime(0, t + 0.03, 0.02);
    return t + 0.14;
  },
  tamb(sy, voice, out, t, vel) {
    const bp = sy.filter('bandpass', 9000, 1.5);
    bp.connect(out);
    sy.noiseSrc(voice, t, t + 0.25, bp);
    out.gain.setValueAtTime(0.5 * vel, t);
    out.gain.setTargetAtTime(0, t, 0.05);
    return t + 0.3;
  },
  crash(sy, voice, out, t, vel) {
    const hp = sy.filter('highpass', 3500, 0.6);
    hp.connect(out);
    sy.noiseSrc(voice, t, t + 2, hp);
    out.gain.setValueAtTime(0.3 * vel, t);
    out.gain.setTargetAtTime(0, t, 0.45);
    return t + 2;
  },
  tom(sy, voice, out, t, vel) {
    const o = sy.osc(voice, 'sine', 180, t, t + 0.4, out);
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(95, t + 0.25);
    out.gain.setValueAtTime(0.75 * vel, t);
    out.gain.setTargetAtTime(0, t, 0.08);
    return t + 0.4;
  },
  stomp(sy, voice, out, t, vel) {
    const o = sy.osc(voice, 'sine', 90, t, t + 0.3, out);
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.1);
    const lp = sy.filter('lowpass', 700, 0.7);
    const ng = sy.gain(0.5);
    lp.connect(ng);
    ng.connect(out);
    sy.noiseSrc(voice, t, t + 0.12, lp);
    out.gain.setValueAtTime(1.0 * vel, t);
    out.gain.setTargetAtTime(0, t, 0.06);
    return t + 0.3;
  },
  cowbell(sy, voice, out, t, vel) {
    const bp = sy.filter('bandpass', 800, 3);
    bp.connect(out);
    sy.osc(voice, 'square', 562, t, t + 0.3, bp);
    sy.osc(voice, 'square', 845, t, t + 0.3, bp);
    out.gain.setValueAtTime(0.4 * vel, t);
    out.gain.setTargetAtTime(0, t, 0.06);
    return t + 0.3;
  },
  block(sy, voice, out, t, vel) {
    const o = sy.osc(voice, 'sine', 1250, t, t + 0.08, out);
    o.frequency.setValueAtTime(1250, t);
    out.gain.setValueAtTime(0.6 * vel, t);
    out.gain.setTargetAtTime(0, t, 0.015);
    return t + 0.1;
  },
  blockHi(sy, voice, out, t, vel) {
    sy.osc(voice, 'sine', 1800, t, t + 0.08, out);
    out.gain.setValueAtTime(0.7 * vel, t);
    out.gain.setTargetAtTime(0, t, 0.015);
    return t + 0.1;
  },
  chipnoise(sy, voice, out, t, vel) {
    const hp = sy.filter('highpass', 3000, 0.5);
    hp.connect(out);
    sy.noiseSrc(voice, t, t + 0.06, hp);
    out.gain.setValueAtTime(0.25 * vel, t);
    out.gain.setTargetAtTime(0, t, 0.02);
    return t + 0.08;
  },
};

export const DRUM_NAMES = Object.keys(DRUMS);
