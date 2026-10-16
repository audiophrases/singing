/*
 * Pitches, durations and chords: the small vocabulary every song file is
 * written in.
 *
 *   Pitch:    C4, F#3, Bb, e  (no octave = the octave nearest the previous note)
 *   Duration: G:2, G:.5, G:1/3, G:1.5 (in beats; default 1)
 *   Rest:     r, r:2
 *   Hit:      x, x:.5 (an unpitched clap/stomp that still carries a syllable)
 *   Chord:    C, Am, G7, Fmaj7, Dm7, Bdim, Esus4, C/E, N (no chord), with :beats
 */

export const PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToName(midi) {
  const m = Math.round(midi);
  return SHARP_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

export function pcName(pc) {
  return SHARP_NAMES[((pc % 12) + 12) % 12];
}

// "C#" -> 1, "Bb" -> 10. Returns null when the text is not a note name.
export function parsePitchClass(text) {
  const m = /^([A-Ga-g])(##|bb|#|b|♯|♭)?$/.exec(String(text || '').trim());
  if (!m) return null;
  let pc = PITCH_CLASS[m[1].toUpperCase()];
  const acc = m[2] || '';
  if (acc === '#' || acc === '♯') pc += 1;
  else if (acc === '##') pc += 2;
  else if (acc === 'b' || acc === '♭') pc -= 1;
  else if (acc === 'bb') pc -= 2;
  return ((pc % 12) + 12) % 12;
}

export function parseDuration(text, fallback = 1) {
  if (text === undefined || text === null || text === '') return fallback;
  const s = String(text).trim();
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b;
    return NaN;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// One melody token -> { kind: 'note'|'rest'|'hit', midi?, beats }.
// prevMidi anchors notes written without an octave.
export function parseNoteToken(token, prevMidi = 60) {
  const [head, durText] = String(token).split(':');
  const beats = parseDuration(durText, 1);
  if (!Number.isFinite(beats) || beats <= 0) throw new Error(`Bad duration in "${token}"`);
  if (/^r$/i.test(head)) return { kind: 'rest', beats };
  if (/^x$/i.test(head)) return { kind: 'hit', beats };
  const m = /^([A-Ga-g])(##|bb|#|b)?(-?\d)?$/.exec(head);
  if (!m) throw new Error(`Bad note "${token}"`);
  const pc = parsePitchClass(m[1] + (m[2] || ''));
  let midi;
  if (m[3] !== undefined) {
    // Octave numbers follow the letter, so Cb4/B#4 keep their written octave.
    const letterPc = PITCH_CLASS[m[1].toUpperCase()];
    const shift = pc - letterPc;
    const wrap = shift > 6 ? -12 : shift < -6 ? 12 : 0;
    midi = (Number(m[3]) + 1) * 12 + letterPc + shift + wrap;
  } else {
    // Nearest octave to the previous note (ties go up).
    const base = prevMidi - (((prevMidi % 12) + 12) % 12);
    let best = null;
    for (const cand of [base - 12 + pc, base + pc, base + 12 + pc]) {
      const d = Math.abs(cand - prevMidi);
      if (best === null || d < best.d || (d === best.d && cand > best.midi)) best = { midi: cand, d };
    }
    midi = best.midi;
  }
  return { kind: 'note', midi, beats };
}

export function parseNotes(text, startMidi = 60) {
  const out = [];
  let prev = startMidi;
  for (const tok of String(text || '').trim().split(/\s+/).filter(Boolean)) {
    if (tok === '|') continue; // bar lines are for the author's eyes only
    const n = parseNoteToken(tok, prev);
    if (n.kind === 'note') prev = n.midi;
    out.push(n);
  }
  return out;
}

const QUALITIES = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  '-': [0, 3, 7],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  min7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  '+': [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  sus: [0, 5, 7],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  9: [0, 4, 7, 10, 14],
  add9: [0, 4, 7, 14],
  5: [0, 7],
};

// "Am7/G" -> { name, root: 9, intervals: [0,3,7,10], bass: 7 }; "N" -> null.
export function parseChord(text) {
  const s = String(text || '').trim();
  if (!s || s === 'N' || s === 'NC') return null;
  const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(s);
  if (!m) throw new Error(`Bad chord "${text}"`);
  const root = parsePitchClass(m[1]);
  const q = m[2];
  if (!(q in QUALITIES)) throw new Error(`Unknown chord quality "${q}" in "${text}"`);
  const bass = m[3] ? parsePitchClass(m[3]) : root;
  return { name: s, root, intervals: QUALITIES[q], bass, minor: QUALITIES[q][1] === 3 };
}

export function transposeChordName(name, semis) {
  if (!name || name === 'N') return name;
  const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(name);
  if (!m) return name;
  const root = pcName(parsePitchClass(m[1]) + semis);
  const bass = m[3] ? '/' + pcName(parsePitchClass(m[3]) + semis) : '';
  return root + m[2] + bass;
}

// "C F:2 G7:2" -> [{ chord, beats }]. Default length is one bar.
export function parseChords(text, meter = 4) {
  const out = [];
  for (const tok of String(text || '').trim().split(/\s+/).filter(Boolean)) {
    if (tok === '|') continue;
    const [name, durText] = tok.split(':');
    const beats = parseDuration(durText, meter);
    if (!Number.isFinite(beats) || beats <= 0) throw new Error(`Bad chord duration "${tok}"`);
    out.push({ name: name === '.' ? '.' : name, chord: name === '.' ? undefined : parseChord(name), beats });
  }
  return out;
}
