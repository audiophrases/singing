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
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
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
    this.master.connect(this.comp);
    this.comp.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.2, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.22;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    this.bus = {};
    this.busSend = {};
    for (const name of BUSES) {
      const g = ctx.createGain();
      const send = ctx.createGain();
      send.gain.value = name === 'drums' ? 0.08 : name === 'bass' ? 0.04 : 0.3;
      g.connect(this.master);
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
    this.driveOut.connect(this.master);
    this.driveOut.connect(this.busSend.comp);

    this.noise = this.makeNoise(2);
    this.ksCache = new Map();
    this.voices = new Set();
  }

  get now() {
    return this.ctx.currentTime;
  }

  setBusVolume(name, v, ramp = 0.05) {
    const g = this.bus[name];
    if (!g) return;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(Math.max(0, v), t, ramp);
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
    return this.bus[bus] || this.bus.comp;
  }

  // ---------------------------------------------------------------- notes

  note(inst, { midi, time, dur, vel = 0.8, bus = 'comp', text = '', first = true, pan = 0 }) {
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
    const end = def.play(this, { voice, out, midi, freq: midiToFreq(midi), t, dur: Math.max(0.03, dur), vel, text, first });
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

// ------------------------------------------------------------- vowels (robo)

// Formants (F1, F2, F3) for a handful of English vowels.
const VOWELS = {
  i: [280, 2250, 2900],
  I: [400, 1950, 2550],
  e: [520, 1850, 2500],
  ae: [680, 1700, 2400],
  a: [740, 1150, 2450],
  o: [560, 880, 2400],
  u: [320, 900, 2250],
  U: [440, 1050, 2250],
  uh: [620, 1200, 2400],
  er: [480, 1350, 1700],
  ei: [450, 2050, 2600],
};

// Spelling -> [startVowel, endVowel?]. Rough, but it makes the robot sing words.
export function vowelOf(syllable) {
  const s = String(syllable || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return ['uh'];
  const rules = [
    [/igh|^i$|^my$|^by$|^fly|^sky|^why|^try|^cry|^dry|y$(?<=^[^aeiou]+y)/, ['a', 'i']],
    [/ee|ea|ie(?!r)|ey$|^he$|^she$|^we$|^me$|^be$/, ['i']],
    [/oo|ue|ew|ou(?=ld)|^do$|^you$|^to$|^who$|^two$/, ['u']],
    [/ow$|ou|ow(?=n|l|e)/, ['a', 'u']],
    [/oy|oi/, ['o', 'i']],
    [/ai|ay|a.e$|ei/, ['ei', 'i']],
    [/oa|o.e$|^go$|^no$|^so$|^oh$|ow/, ['o', 'u']],
    [/er|ir|ur|or(?=ld|k)|ear(?=n|th)/, ['er']],
    [/ar|ah|al(?=m|l)|^a$/, ['a']],
    [/or|aw|au|al/, ['o']],
    [/y$/, ['i']],
  ];
  for (const [re, v] of rules) if (re.test(s)) return v;
  const m = /[aeiouy]/.exec(s);
  if (!m) return ['uh'];
  return [{ a: 'ae', e: 'e', i: 'I', o: 'o', u: 'uh', y: 'I' }[m[0]]];
}

function onsetOf(syllable) {
  const s = String(syllable || '').toLowerCase().replace(/[^a-z]/g, '');
  const m = /^(sh|ch|th|wh|[bcdfghjklmnpqrstvwxyz]+)/.exec(s);
  if (!m) return null;
  const c = m[1];
  if (/^(s|sh|ch|z|x)/.test(c)) return { kind: 'hiss', freq: c.startsWith('sh') || c.startsWith('ch') ? 3000 : 6000, len: 0.07 };
  if (/^(f|th|h|wh)/.test(c)) return { kind: 'hiss', freq: 2500, len: 0.05 };
  if (/^(t|k|c|p|q)/.test(c)) return { kind: 'tick', freq: c[0] === 't' ? 4500 : 2000, len: 0.025 };
  if (/^(b|d|g)/.test(c)) return { kind: 'thump', len: 0.03 };
  return { kind: 'hum', len: 0.04 }; // l, m, n, r, w, y, v, j
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
  // The robot singer: a buzzing source shaped by vowel formants, with a
  // consonant noise at the start of each syllable.
  robo: {
    play(sy, { voice, out: voiceOut, freq, t, dur, vel, text, first }) {
      const ctx = sy.ctx;
      const end = t + dur + 0.1;
      // The consonant goes straight to the voice output; the vowel gets the envelope.
      voiceOut.gain.value = 1;
      const out = sy.gain(0);
      out.connect(voiceOut);
      const vowels = vowelOf(text);
      const v0 = VOWELS[vowels[0]] || VOWELS.uh;
      const v1 = VOWELS[vowels[1] || vowels[0]] || v0;
      const src = ctx.createOscillator();
      src.type = 'sawtooth';
      src.frequency.setValueAtTime(freq, t);
      // Little scoop into the note, then vibrato.
      if (first) {
        src.frequency.setValueAtTime(freq * 0.97, t);
        src.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
      }
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vg = sy.gain(0);
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(freq * 0.01, t + Math.min(0.5, dur));
      vib.connect(vg);
      vg.connect(src.frequency);
      const pre = sy.filter('lowpass', 5000, 0.5);
      src.connect(pre);
      const sum = sy.gain(1);
      const gains = [1, 0.55, 0.3];
      for (let i = 0; i < 3; i += 1) {
        const bp = sy.filter('bandpass', v0[i], [9, 12, 14][i]);
        if (v1 !== v0) {
          bp.frequency.setValueAtTime(v0[i], t + dur * 0.35);
          bp.frequency.linearRampToValueAtTime(v1[i], t + dur * 0.9);
        }
        const g = sy.gain(gains[i] * 3);
        pre.connect(bp);
        bp.connect(g);
        g.connect(sum);
      }
      // A little of the raw buzz, lowpassed, keeps the fundamental clear.
      const body = sy.filter('lowpass', Math.min(1200, freq * 1.6), 0.7);
      const bodyGain = sy.gain(0.9);
      src.connect(body);
      body.connect(bodyGain);
      bodyGain.connect(sum);
      sum.connect(out);
      src.start(t);
      src.stop(end);
      vib.start(t);
      vib.stop(end);
      voice.srcs.push(src, vib);
      let a = 0.03;
      if (first) {
        const on = onsetOf(text);
        if (on && (on.kind === 'hiss' || on.kind === 'tick')) {
          const bp = sy.filter(on.kind === 'hiss' ? 'highpass' : 'bandpass', on.freq, 1);
          const ng = sy.gain(0);
          ng.gain.setValueAtTime(0, t);
          ng.gain.linearRampToValueAtTime(on.kind === 'hiss' ? 0.18 : 0.3, t + 0.005);
          ng.gain.linearRampToValueAtTime(0, t + on.len);
          bp.connect(ng);
          ng.connect(voiceOut);
          sy.noiseSrc(voice, t, t + on.len + 0.02, bp);
          a = on.len * 0.8;
        } else if (on && on.kind === 'thump') {
          a = 0.02;
        } else if (on) {
          a = 0.06;
        }
      }
      env(out.gain, t, dur * 0.97, { a, d: 0.1, s: 0.9, r: 0.08, peak: 0.5 * vel });
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
