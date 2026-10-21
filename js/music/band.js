/*
 * The arranger: chords + a style -> every note the band plays.
 *
 * A style is a set of one-bar patterns, one character per step (4 steps per
 * beat unless the pattern says res: 2). Drums: x hit, X accent, g ghost.
 * Bass: R root, 5 fifth, 3 third, 6 sixth, 7 seventh, 8 octave, L fifth
 * below, w walk into the next chord. Comp: X chord, x soft chord, S strum
 * down, U strum up, A arpeggio, B broken chord, H high notes, L low notes.
 * Everywhere: _ keeps the note sounding, . is silence.
 *
 * Any song can be played in any style - Twinkle Twinkle as reggae is a
 * feature, not a bug.
 */
import { chordAt } from './score.js';
import { syllablePhones, cleanWord, stressVowel, isVowelPhone } from '../lyrics/phonemes.js';
import { stressIndex } from '../lyrics/syllables.js';
import { STOPWORDS } from '../lyrics/wordlists.js';

const DRUM_KEYS = {
  k: 'kick', s: 'snare', h: 'hat', o: 'openhat', c: 'clap', r: 'rim', t: 'shaker', T: 'tamb',
  m: 'stomp', w: 'cowbell', n: 'snap', b: 'block', z: 'chipnoise', y: 'tom', C: 'crash',
};

export const STYLES = {
  pop: {
    name: 'Pop', emoji: '🎹', comp: 'epiano', bass: 'bass', fills: true,
    p: {
      4: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', bass: 'R_____R_R___5___', comp: 'X_______x___X___' },
      3: { k: 'x...........', s: '....x...x...', h: 'x.x.x.x.x.x.', bass: 'R_______5___', comp: '....X___X___' },
      6: { res: 2, k: 'x.....x.....', s: '......x.....', h: 'x.x.x.x.x.x.', bass: 'R_____5_____', comp: 'X_x_x_X_x_x_' },
    },
  },
  rock: {
    name: 'Rock', emoji: '🎸', comp: 'guitar', drive: true, bass: 'bass', fills: true,
    p: {
      4: { k: 'x.....x.x.......', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.', bass: 'R_R_R_R_R_R_R_R_', comp: 'S_S_S_S_S_S_S_S_' },
      3: { k: 'x.....x.....', s: '....X...X...', h: 'x.x.x.x.x.x.', bass: 'R_R_R_R_R_R_', comp: 'S_S_S_S_S_S_' },
      6: { res: 2, k: 'x.....x.x...', s: '......X.....', h: 'x.x.x.x.x.x.', bass: 'R_R_R_R_R_R_', comp: 'S_S_S_S_S_S_' },
    },
  },
  folk: {
    name: 'Campfire', emoji: '🪕', comp: 'guitar', bass: 'upright', fills: false,
    p: {
      4: { t: 'x.x.x.x.x.x.x.x.', k: 'x.......x.......', bass: 'R_______5_______', comp: 'S...S.U...U.S.U.' },
      3: { t: 'x.x.x.x.x.x.', k: 'x...........', bass: 'R_______5___', comp: 'S...S.U.S.U.' },
      6: { res: 2, t: 'x.x.x.x.x.x.', k: 'x.....x.....', bass: 'R_____5_____', comp: 'S.U.U.S.U.U.' },
    },
  },
  lullaby: {
    name: 'Lullaby', emoji: '🌙', comp: 'harp', bass: 'upright', pad: 'pad', bassVel: 0.5,
    p: {
      4: { bass: 'R_______________', comp: 'A...A...A...A...' },
      3: { bass: 'R___________', comp: 'A...A...A...' },
      6: { res: 2, bass: 'R___________', comp: 'A.A.A.A.A.A.' },
    },
  },
  musicbox: {
    name: 'Music box', emoji: '🎁', comp: 'bells', bass: null, pad: null,
    p: {
      4: { comp: 'B...B...B...B...' },
      3: { comp: 'A...A...A...' },
      6: { res: 2, comp: 'A.A.A.A.A.A.' },
    },
  },
  waltz: {
    name: 'Waltz', emoji: '💃', comp: 'strings', bass: 'upright', fills: false,
    p: {
      4: { bass: 'R_______5_______', comp: '....X___....X___', k: 'x.......x.......', h: '....g.......g...' },
      3: { bass: 'R___________', comp: '....X___X___', k: 'x...........', h: '....g...g...' },
      6: { res: 2, bass: 'R_____5_____', comp: '..X_X_..X_X_', k: 'x.....x.....' },
    },
  },
  march: {
    name: 'Marching band', emoji: '🥁', comp: 'brass', bass: 'tuba', fills: true,
    p: {
      4: { k: 'x.......x.......', s: 'x.xx..x.x.xx..x.', C: 'x...............', bass: 'R___....5___....', comp: '....X_......X_..' },
      3: { k: 'x...........', s: 'x.xx..x...x.', bass: 'R___........', comp: '....X_..X_..' },
      6: { res: 2, k: 'x.....x.....', s: 'x.xx.xx.xx.x', bass: 'R_....5_....', comp: '..X_X_..X_X_' },
    },
  },
  reggae: {
    name: 'Reggae', emoji: '🌴', comp: 'organ', bass: 'bass', swing: 0.25, fills: false,
    p: {
      4: { k: '........x.......', r: '........x.......', h: 'x.x.x.x.x.x.x.x.', bass: 'R__.R.5_._R_8_5.', comp: '....x_......x_..' },
      3: { k: '........x...', r: '........x...', h: 'x.x.x.x.x.x.', bass: 'R__.5___R___', comp: '....x_..x_..' },
      6: { res: 2, k: '......x.....', r: '......x.....', h: 'x.x.x.x.x.x.', bass: 'R_._5_R_._5_', comp: '..x...x...x.' },
    },
  },
  blues: {
    name: 'Blues shuffle', emoji: '🎷', comp: 'epiano', bass: 'upright', swing: 1, fills: true,
    p: {
      4: { k: 'x.......x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', bass: 'R___3___5___6___', comp: '..x_..x_..x_..x_' },
      3: { k: 'x...........', s: '....x...x...', h: 'x.x.x.x.x.x.', bass: 'R___3___5___', comp: '..x_..x_..x_' },
      6: { res: 2, k: 'x.....x.....', s: '......x.....', h: 'x.xx.xx.xx.x', bass: 'R_3_5_6_5_3_', comp: '..x_.x..x_.x' },
    },
  },
  disco: {
    name: 'Disco', emoji: '🪩', comp: 'strings', bass: 'synthbass', fills: true,
    p: {
      4: { k: 'x...x...x...x...', s: '....x.......x...', o: '..x...x...x...x.', h: 'x...x...x...x...', bass: 'R_8_R_8_R_8_R_8_', comp: 'X___..X_..X_X___' },
      3: { k: 'x...x...x...', s: '....x...x...', o: '..x...x...x.', bass: 'R_8_R_8_R_8_', comp: 'X___..X_..X_' },
      6: { res: 2, k: 'x..x..x..x..', s: '......x.....', o: '.x..x..x..x.', bass: 'R_8_R_R_8_R_', comp: 'X_..X_X_..X_' },
    },
  },
  hiphop: {
    name: 'Hip-hop', emoji: '🎤', comp: 'epiano', bass: 'synthbass', swing: 0.4, fills: false,
    p: {
      4: { k: 'x.....x...x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', bass: 'R_____.R__..R___', comp: 'x_______....x___' },
      3: { k: 'x.....x.....', s: '....x.......', h: 'x.x.x.x.x.x.', bass: 'R_____.R____', comp: 'x_______....' },
      6: { res: 2, k: 'x....x..x...', s: '......x.....', h: 'x.x.x.x.x.x.', bass: 'R____.R_____', comp: 'x_____......' },
    },
  },
  country: {
    name: 'Country', emoji: '🤠', comp: 'guitar', bass: 'upright', fills: false,
    p: {
      4: { k: 'x.......x.......', r: '....x.......x...', t: 'x.x.x.x.x.x.x.x.', bass: 'R_______5_______', comp: '....S.U.....S.U.' },
      3: { k: 'x...........', r: '....x...x...', t: 'x.x.x.x.x.x.', bass: 'R_______5___', comp: '....S.U.S.U.' },
      6: { res: 2, k: 'x.....x.....', r: '..x.x...x.x.', bass: 'R_____5_____', comp: '..S.U...S.U.' },
    },
  },
  shanty: {
    name: 'Sea shanty', emoji: '⚓', comp: 'accordion', bass: 'tuba', fills: false,
    p: {
      4: { m: 'x.......x.......', c: '....x.......x...', bass: 'R_______5_______', comp: 'X_______X_______' },
      3: { m: 'x...........', c: '....x...x...', bass: 'R___________', comp: 'X___________' },
      6: { res: 2, m: 'x.....x.....', c: '...x.....x..', bass: 'R_____5_____', comp: 'X_____X_____' },
    },
  },
  reggaeton: {
    name: 'Reggaeton', emoji: '🔥', comp: 'pad', bass: 'synthbass', fills: false,
    p: {
      4: { k: 'x...x...x...x...', r: '...x..x....x..x.', h: 'x.x.x.x.x.x.x.x.', bass: 'R__R__R.R__R__R.', comp: 'X_______X_______' },
      3: { k: 'x...x...x...', r: '...x..x....x', h: 'x.x.x.x.x.x.', bass: 'R__R__R.R___', comp: 'X___________' },
      6: { res: 2, k: 'x..x..x..x..', r: '..x..x..x..x', bass: 'R__R__R__R__', comp: 'X_____X_____' },
    },
  },
  chiptune: {
    name: '8-bit', emoji: '👾', comp: 'chip', bass: 'chipbass', fills: true, lead: 'chip',
    p: {
      4: { k: 'x.......x.......', z: '....x.......x...', h: '..x...x...x...x.', bass: 'R.R.5.5.R.R.5.5.', comp: 'AAAAAAAAAAAAAAAA' },
      3: { k: 'x...........', z: '....x...x...', bass: 'R.R.5.5.R.R.', comp: 'AAAAAAAAAAAA' },
      6: { res: 2, k: 'x.....x.....', z: '...x.....x..', bass: 'R.5.R.5.R.5.', comp: 'AAAAAAAAAAAA' },
    },
  },
  unplugged: {
    name: 'Just piano', emoji: '🎼', comp: 'piano', bass: null,
    p: {
      4: { comp: 'X_______X_______' },
      3: { comp: 'X___________' },
      6: { res: 2, comp: 'X_____X_____' },
    },
  },
  drums: {
    name: 'Drums only', emoji: '🥁', comp: null, bass: null, fills: true,
    p: {
      4: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
      3: { k: 'x...........', s: '....x...x...', h: 'x.x.x.x.x.x.' },
      6: { res: 2, k: 'x.....x.....', s: '......x.....', h: 'x.x.x.x.x.x.' },
    },
  },
};

// room: how many dB the band dips around 3 kHz for that singer's consonants.
export const GUIDES = {
  robo: { name: 'Robot singer', emoji: '🤖', inst: 'robo', room: 2 },
  roboclear: { name: 'Robot · clear English', emoji: '🗣️', inst: 'roboClear', room: 5 },
  flute: { name: 'Flute', emoji: '🎶', inst: 'flute' },
  piano: { name: 'Piano', emoji: '🎹', inst: 'piano' },
  whistle: { name: 'Whistle', emoji: '😗', inst: 'whistle' },
  synth: { name: 'Synth', emoji: '🎛️', inst: 'synthlead' },
  bells: { name: 'Bells', emoji: '🔔', inst: 'bells' },
  roboclassic: { name: 'Robot singer (original)', emoji: '📼', inst: 'roboClassic' },
};

function patternFor(style, meter) {
  const p = style.p;
  if (p[meter]) return { res: 4, ...p[meter], beats: meter };
  if (meter === 2 && p[4]) {
    const half = {};
    for (const [k, v] of Object.entries(p[4])) half[k] = typeof v === 'string' ? v.slice(0, 8) : v;
    return { res: 4, ...half, beats: 2 };
  }
  if (meter === 12 && p[6]) {
    const dbl = {};
    for (const [k, v] of Object.entries(p[6])) dbl[k] = typeof v === 'string' ? v + v : v;
    return { res: 2, ...dbl, beats: 12 };
  }
  // Anything else: loop the 4/4 pattern, truncated.
  const src = p[4] || Object.values(p)[0];
  const out = {};
  const steps = meter * 4;
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== 'string') continue;
    let s = '';
    while (s.length < steps) s += v;
    out[k] = s.slice(0, steps);
  }
  return { res: 4, ...out, beats: meter };
}

// Note lengths in steps: '_' continues, anything else ends the note.
function holdSteps(pat, i) {
  let n = 1;
  while (i + n < pat.length && pat[i + n] === '_') n += 1;
  return n;
}

function chordPcs(chord) {
  const pcs = [];
  for (const iv of chord.intervals) {
    const pc = (chord.root + iv) % 12;
    if (!pcs.includes(pc)) pcs.push(pc);
  }
  return pcs;
}

// Pick the inversion nearest the previous voicing so chords glide.
export function voiceChord(chord, prev, lo = 53, hi = 74, max = 4) {
  let pcs = chordPcs(chord);
  if (pcs.length > max) pcs = pcs.filter((pc) => pc !== (chord.root + 7) % 12).slice(0, max);
  const cands = [];
  for (let r = 0; r < pcs.length; r += 1) {
    const order = pcs.slice(r).concat(pcs.slice(0, r));
    let base = lo;
    while (((base % 12) + 12) % 12 !== order[0]) base += 1;
    const notes = [base];
    for (let k = 1; k < order.length; k += 1) {
      let n = notes[k - 1] + 1;
      while (((n % 12) + 12) % 12 !== order[k]) n += 1;
      notes.push(n);
    }
    if (notes[notes.length - 1] <= hi + 3) cands.push(notes);
  }
  if (!cands.length) return pcs.map((pc) => 60 + pc);
  const centre = (lo + hi) / 2;
  const score = (c) => {
    if (prev && prev.length) {
      const pm = prev.reduce((a, b) => a + b, 0) / prev.length;
      const cm = c.reduce((a, b) => a + b, 0) / c.length;
      let d = 0;
      for (const n of c) d += Math.min(...prev.map((p) => Math.abs(p - n)));
      return d + Math.abs(cm - pm) * 0.5 + Math.abs(cm - centre) * 0.15;
    }
    const cm = c.reduce((a, b) => a + b, 0) / c.length;
    return Math.abs(cm - centre);
  };
  cands.sort((a, b) => score(a) - score(b));
  return cands[0];
}

function bassNote(chord, deg, nextChord) {
  const root = chord.bass;
  let pc;
  switch (deg) {
    case '5': pc = chord.root + (chord.intervals.includes(6) && !chord.intervals.includes(7) ? 6 : chord.intervals.includes(8) ? 8 : 7); break;
    case '3': pc = chord.root + (chord.intervals.includes(3) ? 3 : 4); break;
    case '6': pc = chord.root + 9; break;
    case '7': pc = chord.root + (chord.intervals.includes(10) ? 10 : chord.intervals.includes(11) ? 11 : 12); break;
    case '8': pc = root + 12; break;
    case 'L': pc = chord.root + 7 - 12; break;
    case 'w': pc = (nextChord ? nextChord.bass : root) - 1; break;
    default: pc = root;
  }
  // Root register: E1 (28)..D#2 (39) lands most roots between 36 and 47.
  const base = 36 + (((root % 12) + 12) % 12);
  const rootMidi = base > 45 ? base - 12 : base;
  return rootMidi + (pc - root);
}

const VEL = { x: 0.8, X: 1, g: 0.35 };

/*
 * events: [{ t, d, inst, midi, vel, bus, text?, first? } | { t, drum, vel }]
 * t and d in beats from the start of the song.
 */
export function arrange(compiled, styleId = 'pop', opts = {}) {
  const style = STYLES[styleId] || STYLES.pop;
  const transpose = opts.transpose || 0;
  const meter = compiled.meter;
  const pat = patternFor(style, meter);
  const res = pat.res || 4;
  const stepBeats = 1 / res;
  const stepsPerBar = Math.round(pat.beats * res);
  const events = [];
  const swingAmt = (opts.swing !== undefined ? opts.swing : style.swing || 0) * (1 / 6);
  const swingStep = (i) => (res === 4 && i % 4 === 2 ? swingAmt : 0);
  const end = compiled.totalBeats;
  // The final bar is a single held chord: find where it begins.
  const finalStart = Math.max(0, end - (compiled.meter));

  let prevVoicing = null;
  let arpIdx = 0;
  let lastChordStart = -1;
  const sectionBars = new Set();
  for (const l of compiled.lines) {
    if (l.sectionStart && l.index > 0) sectionBars.add(Math.ceil(l.start / meter - 1e-6));
  }
  const firstBar = Math.ceil(compiled.firstLineStart / meter - 1e-6);

  const totalBars = Math.ceil(end / pat.beats);
  for (let bar = 0; bar < totalBars; bar += 1) {
    const barStart = bar * pat.beats;
    if (barStart >= finalStart - 1e-9) break;
    const barInSong = bar - firstBar;
    const fillBar = style.fills && barInSong >= 0 && (barInSong % 8 === 7 || sectionBars.has(bar + 1));
    const crashBar = style.fills && (bar === firstBar || sectionBars.has(bar));
    if (crashBar) events.push({ t: barStart, drum: 'crash', vel: 0.7 });

    for (let i = 0; i < stepsPerBar; i += 1) {
      const t = barStart + i * stepBeats;
      if (t >= finalStart - 1e-9) break;
      const ts = t + swingStep(i);
      const ch = chordAt(compiled, t + 1e-6);
      const chord = ch && ch.chord;
      const chordChanged = ch && ch.start !== lastChordStart && Math.abs(ch.start - t) < stepBeats / 2;
      if (ch && ch.start !== lastChordStart && ch.start <= t + 1e-6) {
        lastChordStart = ch.start;
        arpIdx = 0;
      }
      const chordEnd = ch ? ch.start + ch.beats : end;
      const nextCh = chordAt(compiled, chordEnd + 1e-6);

      // Drums (last beat of a fill bar becomes a snare/tom roll).
      const inFill = fillBar && i >= stepsPerBar - res;
      if (inFill) {
        const k = i - (stepsPerBar - res);
        events.push({ t, drum: k % 2 ? 'tom' : 'snare', vel: 0.5 + 0.12 * k });
        if (i === stepsPerBar - res) events.push({ t, drum: 'kick', vel: 0.9 });
      } else {
        for (const [key, drum] of Object.entries(DRUM_KEYS)) {
          const s = pat[key];
          if (!s) continue;
          const c = s[i % s.length];
          if (VEL[c]) events.push({ t: ts, drum, vel: VEL[c] });
        }
      }

      if (!chord) continue;

      // Bass.
      if (style.bass && pat.bass) {
        const c = pat.bass[i % pat.bass.length];
        let deg = /[R53678Lw]/.test(c) ? c : null;
        if (!deg && chordChanged && c === '_') deg = 'R';
        if (deg) {
          let steps = holdSteps(pat.bass, i);
          let d = Math.min(steps * stepBeats, chordEnd - t);
          d = Math.max(stepBeats * 0.8, d * 0.95);
          events.push({
            t: ts, d, inst: style.bass, midi: bassNote(chord, deg, nextCh && nextCh.chord) + transpose,
            vel: (style.bassVel || 0.85), bus: 'bass',
          });
        }
      }

      // Comp.
      if (style.comp && pat.comp) {
        const c = pat.comp[i % pat.comp.length];
        let kind = /[XxSUABHL]/.test(c) ? c : null;
        if (!kind && chordChanged && c === '_') kind = 'x';
        if (kind) {
          const voicing = voiceChord(chord, prevVoicing, 53 + (style.compShift || 0), 74 + (style.compShift || 0));
          prevVoicing = voicing;
          const v = voicing.map((n) => n + transpose);
          const steps = holdSteps(pat.comp, i);
          let d = Math.min(steps * stepBeats, chordEnd - t);
          d = Math.max(stepBeats * 0.9, d);
          const inst = style.comp;
          const bus = 'comp';
          if (kind === 'X' || kind === 'x') {
            for (const n of v) events.push({ t: ts, d, inst, midi: n, vel: kind === 'X' ? 0.85 : 0.6, bus });
          } else if (kind === 'S' || kind === 'U') {
            const low = bassNote(chord, 'R') + 12 + transpose;
            const notes = kind === 'S' ? [low, ...v] : v.slice(-3).reverse();
            notes.forEach((n, k) => events.push({ t: ts + k * 0.012 * (kind === 'S' ? 1 : 0.8), d, inst, midi: n, vel: kind === 'S' ? 0.75 : 0.5, bus }));
          } else if (kind === 'A') {
            const seq = [v[0] - 12, ...v, v[0] + 12];
            const n = seq[arpIdx % seq.length];
            arpIdx += 1;
            events.push({ t: ts, d: Math.max(d, stepBeats), inst, midi: n, vel: 0.65, bus });
          } else if (kind === 'B') {
            const seq = [v[0], v[v.length - 1], v[1] || v[0], v[v.length - 1]];
            const n = seq[arpIdx % seq.length];
            arpIdx += 1;
            events.push({ t: ts, d: Math.max(d, stepBeats), inst, midi: n, vel: 0.6, bus });
          } else if (kind === 'H') {
            for (const n of v.slice(-3)) events.push({ t: ts, d, inst, midi: n, vel: 0.6, bus });
          } else if (kind === 'L') {
            events.push({ t: ts, d, inst, midi: v[0], vel: 0.6, bus });
          }
        }
      }
    }
  }

  // Pad: long chords under everything.
  if (style.pad) {
    let pv = null;
    for (const c of compiled.chords) {
      if (!c.chord || c.start >= finalStart) continue;
      const v = voiceChord(c.chord, pv, 60, 79);
      pv = v;
      const d = Math.min(c.beats, finalStart - c.start);
      for (const n of v) events.push({ t: c.start, d, inst: style.pad, midi: n + transpose, vel: 0.6, bus: 'pad' });
    }
  }

  // Ending: one big chord.
  const last = chordAt(compiled, finalStart + 1e-6);
  if (last && last.chord && finalStart < end) {
    const d = end - finalStart;
    const v = voiceChord(last.chord, prevVoicing, 53, 74).map((n) => n + transpose);
    const inst = style.comp || 'piano';
    for (const n of v) events.push({ t: finalStart, d, inst, midi: n, vel: 0.8, bus: 'comp' });
    if (style.bass) events.push({ t: finalStart, d, inst: style.bass, midi: bassNote(last.chord, 'R') + transpose, vel: 0.85, bus: 'bass' });
    if (style.pad) for (const n of v) events.push({ t: finalStart, d, inst: style.pad, midi: n + 12, vel: 0.5, bus: 'pad' });
    if (style.p[4] && (style.p[4].k || style.p[4].m)) {
      events.push({ t: finalStart, drum: style.p[4].m ? 'stomp' : 'kick', vel: 1 });
      if (style.fills || style.p[4].k) events.push({ t: finalStart, drum: 'crash', vel: 0.8 });
    }
  }

  events.sort((a, b) => a.t - b.t);
  return events;
}

/*
 * How each syllable of a line sounds, for the robot singer: its phones
 * { on, nu, co } and its stress: 2 the stressed syllable of a word, 1 a small
 * word (the, of, you...), 0 an unstressed syllable.
 */
const lineVoices = new WeakMap();
function voiceOf(line) {
  let v = lineVoices.get(line);
  if (!v) {
    v = { ph: [], stress: [] };
    for (const w of line.words || []) {
      const parts = w.syllables.map((i) => line.syllables[i].text);
      const phones = syllablePhones(parts.join(''), parts);
      phones.forEach((x, k) => { v.ph[w.syllables[k]] = x; });
      const core = cleanWord(parts.join(''));
      const st = stressedSyllable(core, parts, phones);
      const small = STOPWORDS.has(core) || core.length <= 2;
      w.syllables.forEach((i, k) => { v.stress[i] = k === st ? (small ? 1 : 2) : 0; });
    }
    lineVoices.set(line, v);
  }
  return v;
}

// Which of the song's syllables of a word is stressed: the dictionary's
// stressed vowel, found in the syllable that sings it; or a guess by rule.
function stressedSyllable(word, parts, phones) {
  if (parts.length < 2) return 0;
  const k = stressVowel(word);
  if (k === null) return stressIndex(word, parts.map(cleanWord));
  let seen = 0;
  for (let i = 0; i < phones.length; i += 1) {
    seen += [...phones[i].nu].filter(isVowelPhone).length;
    if (k < seen) return i;
  }
  return phones.length - 1;
}

// The melody, for the guide voice and the claps/stomps on "x" notes.
export function melodyEvents(compiled, guide = 'robo', opts = {}) {
  const transpose = opts.transpose || 0;
  const g = GUIDES[guide];
  const robo = !!g && g.inst.startsWith('robo');
  const out = [];
  const sung = [];
  for (const m of compiled.melody) {
    if (m.hit) {
      const line = compiled.lines[m.line];
      const syl = line && m.syl >= 0 ? line.syllables[m.syl] : null;
      const txt = syl ? syl.text : '';
      const drum = /🦶|stomp|👞|👟/.test(txt) ? 'stomp' : /🫰|snap/.test(txt) ? 'snap' : /🥁/.test(txt) ? 'snare' : 'clap';
      out.push({ t: m.start, drum, vel: 0.9, bus: 'lead' });
      continue;
    }
    if (!g || m.midi === null) continue;
    const line = compiled.lines[m.line];
    const syl = line && m.syl >= 0 ? line.syllables[m.syl] : null;
    const first = !syl || syl.notes[0] === m;
    const last = !syl || syl.notes[syl.notes.length - 1] === m;
    const e = {
      t: m.start, d: m.beats * 0.98, inst: g.inst, midi: m.midi + transpose + (opts.octave || 0) * 12,
      vel: 0.85, bus: 'lead', text: syl ? syl.text : 'la', first, last,
      ph: robo && syl ? voiceOf(line).ph[m.syl] || null : null,
    };
    if (robo) {
      e.stress = syl ? voiceOf(line).stress[m.syl] ?? 2 : 2;
      e.wordStart = !!(syl && syl.first && first);
      sung.push([e, m.beats]);
    }
    out.push(e);
  }
  linkNotes(sung);
  return out;
}

/*
 * Robot notes know their neighbours when one follows straight on: nt / pt
 * (beats to the next note, from the one before), the next one's onset and
 * whether it starts a word. A note then stops where the next one's
 * consonants begin, and a melisma glides from the note before.
 *   sung: [[event, beats], ...] in time order.
 */
export function linkNotes(sung) {
  for (let i = 0; i + 1 < sung.length; i += 1) {
    const [a, beats] = sung[i];
    const [b] = sung[i + 1];
    if (Math.abs(b.t - (a.t + beats)) > 0.02) continue;
    a.nt = b.t - a.t;
    a.nextOn = b.first && b.ph ? b.ph.on : '';
    a.nextWord = b.wordStart;
    b.pt = a.nt;
    b.prevMidi = a.midi;
  }
}

// Woodblock clicks: a bar of count-in, or a metronome.
export function clickEvents(fromBeat, beats, meter) {
  const out = [];
  for (let b = 0; b < beats; b += 1) {
    const t = fromBeat + b;
    out.push({ t, drum: (Math.round(t) % meter === 0) ? 'blockHi' : 'block', vel: 0.8, bus: 'fx' });
  }
  return out;
}
