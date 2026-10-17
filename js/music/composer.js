/*
 * The song maker: any English text -> a singable song in Singing's format.
 *
 * 1. Rhythm. Each line is split into syllables with a stress guess, then
 *    placed on an eighth-note grid by dynamic programming: stressed syllables
 *    on strong beats, small words in between, a long note at the end.
 * 2. Harmony. A chord progression for the mood, with a cadence (V - I) to
 *    close every verse.
 * 3. Melody. Stressed syllables take chord tones along an arch (rise to the
 *    middle of the line, come home at the end); the rest move by step. Lines
 *    with the same shape reuse the same tune - repetition is what makes a
 *    song catchy.
 */
import { lineSyllables } from '../lyrics/syllables.js';
import { parsePitchClass, midiToName } from './notes.js';
import { seeded } from '../ui.js';

export const MOODS = {
  pop: { name: 'Happy pop', emoji: '😄', mode: 'major', prog: ['I', 'V', 'vi', 'IV'], style: 'pop', bpm: 108 },
  folk: { name: 'Campfire', emoji: '🔥', mode: 'major', prog: ['I', 'IV', 'V', 'I'], style: 'folk', bpm: 100 },
  calm: { name: 'Calm', emoji: '🌙', mode: 'major', prog: ['I', 'vi', 'IV', 'V'], style: 'lullaby', bpm: 80 },
  rock: { name: 'Rock', emoji: '🎸', mode: 'major', prog: ['I', 'IV', 'I', 'V'], style: 'rock', bpm: 126 },
  sad: { name: 'Minor mood', emoji: '🌧️', mode: 'minor', prog: ['i', 'VI', 'III', 'VII'], style: 'pop', bpm: 92 },
  reggae: { name: 'Reggae', emoji: '🌴', mode: 'major', prog: ['I', 'IV', 'I', 'V'], style: 'reggae', bpm: 84 },
  march: { name: 'March', emoji: '🥁', mode: 'major', prog: ['I', 'V', 'I', 'V'], style: 'march', bpm: 116 },
  disco: { name: 'Disco', emoji: '🪩', mode: 'minor', prog: ['i', 'iv', 'VII', 'III'], style: 'disco', bpm: 118 },
  chant: { name: 'Rap / chant', emoji: '🎤', mode: 'minor', prog: ['i', 'i', 'VI', 'VII'], style: 'hiphop', bpm: 92, chant: true },
};

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

const DEGREES = {
  I: [0, ''], ii: [2, 'm'], iii: [4, 'm'], IV: [5, ''], V: [7, ''], vi: [9, 'm'], V7: [7, '7'],
  i: [0, 'm'], III: [3, ''], iv: [5, 'm'], v: [7, 'm'], VI: [8, ''], VII: [10, ''],
};
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function chordName(keyPc, degree) {
  const [semi, q] = DEGREES[degree];
  return NAMES[(keyPc + semi) % 12] + q;
}

function chordTones(keyPc, degree) {
  const [semi, q] = DEGREES[degree];
  const root = (keyPc + semi) % 12;
  const third = q === 'm' ? 3 : 4;
  const tones = [root, (root + third) % 12, (root + 7) % 12];
  if (q === '7') tones.push((root + 10) % 12);
  return tones;
}

/*
 * Place syllables on a grid of `slots` eighth notes.
 * Returns the slot of each syllable.
 */
export function placeRhythm(syls, slots, slotsPerBar, rnd = Math.random) {
  const n = syls.length;
  if (!n) return [];
  const INF = 1e9;
  const beatOf = (s) => s % slotsPerBar;
  const cost = (i, s) => {
    const sy = syls[i];
    const b = beatOf(s);
    let c = 0;
    const onBeat = s % 2 === 0;
    const down = b === 0;
    const half = slotsPerBar === 8 && b === 4;
    if (sy.stress === 2) c += onBeat ? (down ? -1.2 : half ? -0.8 : 0) : 4;
    else if (sy.stress === 1) c += onBeat ? 0 : 0.6;
    else c += down ? 1.6 : onBeat ? 0.2 : 0;
    return c + rnd() * 0.25;
  };
  const gapCost = (i, g) => {
    const prev = syls[i - 1];
    if (g <= 0) return INF;
    if (prev.pause) return g >= 2 ? (g > 6 ? 1.5 : 0) : 1.2;
    if (g === 1 || g === 2) return 0;
    if (g === 3) return 0.7;
    if (g === 4) return prev.stress ? 0.6 : 1.5;
    return 2 + (g - 4) * 0.6;
  };
  const maxStart = Math.min(3, slots - n);
  const dp = Array.from({ length: n }, () => new Array(slots).fill(INF));
  const back = Array.from({ length: n }, () => new Array(slots).fill(-1));
  for (let s = 0; s <= maxStart; s += 1) dp[0][s] = cost(0, s) + s * 0.6;
  for (let i = 1; i < n; i += 1) {
    for (let s = i; s < slots - (n - 1 - i); s += 1) {
      const ci = cost(i, s);
      for (let p = Math.max(0, s - 8); p < s; p += 1) {
        if (dp[i - 1][p] >= INF) continue;
        const v = dp[i - 1][p] + gapCost(i, s - p) + ci;
        if (v < dp[i][s]) { dp[i][s] = v; back[i][s] = p; }
      }
    }
  }
  // The last syllable wants room to ring.
  let best = -1;
  if (dp[n - 1].every((v) => v >= INF)) {
    // No placement fits (more syllables than the grid allows): space them evenly.
    return syls.map((_, i) => Math.min(slots - 1, Math.floor((i * slots) / n)));
  }
  let bestV = INF;
  for (let s = n - 1; s < slots; s += 1) {
    if (dp[n - 1][s] >= INF) continue;
    const room = slots - s;
    let v = dp[n - 1][s];
    if (room < 2) v += 3;
    else if (room < 4) v += 0.8;
    if (beatOf(s) === 0 && s >= slots - slotsPerBar) v -= 1;
    if (v < bestV) { bestV = v; best = s; }
  }
  const out = new Array(n);
  let s = best;
  for (let i = n - 1; i >= 0; i -= 1) {
    out[i] = s;
    s = back[i][s];
  }
  return out;
}

function nearestTone(target, tones, lo, hi) {
  let best = null;
  for (let m = lo; m <= hi; m += 1) {
    if (!tones.includes(((m % 12) + 12) % 12)) continue;
    if (best === null || Math.abs(m - target) < Math.abs(best - target)) best = m;
  }
  return best === null ? target : best;
}

function stepToward(from, to, scale, keyPc) {
  if (from === to) return from;
  const dir = to > from ? 1 : -1;
  let m = from + dir;
  while (!scale.includes(((m - keyPc) % 12 + 12) % 12)) m += dir;
  return m;
}

const MAX_LINE = 12;

function countSyl(text) {
  return lineSyllables(text).length;
}

// Group pieces (with their syllable counts) into lines of about equal length.
function balance(pieces, joiner) {
  const total = pieces.reduce((a, p) => a + p.n, 0);
  let linesLeft = Math.ceil(total / MAX_LINE);
  const out = [];
  let cur = [];
  let curN = 0;
  let left = total;
  for (const p of pieces) {
    const goal = left / Math.max(1, linesLeft);
    if (cur.length && curN + p.n > goal + p.n / 2) {
      out.push(cur.join(joiner));
      left -= curN;
      linesLeft -= 1;
      cur = [];
      curN = 0;
    }
    cur.push(p.text);
    curN += p.n;
  }
  if (cur.length) out.push(cur.join(joiner));
  return out;
}

/*
 * A line too long to sing in one breath is split: first at commas and
 * semicolons, then (if a piece is still long) between words.
 */
export function splitLongLine(raw) {
  if (countSyl(raw) <= MAX_LINE + 4) return [raw];
  const clauses = raw.split(/(?<=[,;:])\s+/).filter(Boolean);
  const pieces = [];
  for (const c of clauses) {
    const n = countSyl(c);
    if (n <= MAX_LINE + 4) { pieces.push({ text: c, n }); continue; }
    const words = c.split(/\s+/).filter(Boolean).map((w) => ({ text: w, n: countSyl(w) }));
    for (const part of balance(words, ' ')) pieces.push({ text: part, n: countSyl(part) });
  }
  return balance(pieces, ' ');
}

function signature(syls, slots) {
  return `${syls.length}:${slots}:${syls.map((s) => s.stress).join('')}`;
}

/*
 * composeSong(text, { title, mood, key, seed, bpm })
 * Blank lines in the text start a new verse.
 */
export function composeSong(text, opts = {}) {
  const mood = MOODS[opts.mood] || MOODS.pop;
  const rnd = seeded(opts.seed || 1);
  const keyName = opts.key || (mood.mode === 'minor' ? 'A' : 'C');
  const keyPc = parsePitchClass(keyName) ?? 0;
  const scale = mood.mode === 'minor' ? MINOR : MAJOR;
  const meter = 4;
  const slotsPerBar = meter * 2;
  // Tonic around C4..A4 so tunes sit in a child-friendly range.
  let tonic = 60 + keyPc;
  if (tonic > 65) tonic -= 12;
  const lo = tonic - 3;
  const hi = tonic + 14;

  const verses = String(text || '').replace(/\r/g, '').split(/\n\s*\n/)
    .map((v) => v.split('\n').map((l) => l.trim()).filter(Boolean).flatMap(splitLongLine))
    .filter((v) => v.length);
  const lines = [];
  const memory = new Map();
  let progIdx = 0;
  let prevPitch = tonic + 4;
  const chordStep = () => mood.prog[progIdx++ % mood.prog.length];

  verses.forEach((verse, vi) => {
    verse.forEach((raw, li) => {
      const syls = lineSyllables(raw);
      if (!syls.length) return;
      const bars = 2 * Math.max(1, Math.ceil(syls.length / 9));
      const slots = bars * slotsPerBar;
      const lastOfVerse = li === verse.length - 1;
      const even = li % 2 === 1;
      // Chords: one per bar; the verse ends with V - I.
      const chords = [];
      for (let b = 0; b < bars; b += 1) chords.push(chordStep());
      if (lastOfVerse) {
        chords[bars - 1] = mood.mode === 'minor' ? 'i' : 'I';
        if (bars >= 2) chords[bars - 2] = mood.mode === 'minor' ? 'V' : (mood.prog.includes('IV') && rnd() < 0.3 ? 'IV' : 'V');
        progIdx = 0;
      } else if (even) {
        chords[bars - 1] = mood.mode === 'minor' ? 'VII' : 'V';
      }
      const sig = signature(syls, slots);
      let tune = memory.get(`${sig}:${lastOfVerse}`);
      if (!tune) {
        const pos = placeRhythm(syls, slots, slotsPerBar, rnd);
        // Melody.
        const pitches = [];
        const strongIdx = syls.map((s, i) => (s.stress === 2 || i === syls.length - 1 || i === 0 ? i : -1)).filter((i) => i >= 0);
        const peakAt = Math.floor(syls.length * (0.45 + rnd() * 0.25));
        const startTarget = tonic + (rnd() < 0.5 ? 4 : 7) - (mood.mode === 'minor' ? 1 : 0);
        const anchors = new Map();
        for (const i of strongIdx) {
          const bar = Math.min(bars - 1, Math.floor(pos[i] / slotsPerBar));
          const tones = chordTones(keyPc, chords[bar]);
          let target;
          if (i === syls.length - 1) {
            target = lastOfVerse ? tonic : even ? tonic + 2 : tonic + 7;
            if (lastOfVerse || even) {
              anchors.set(i, nearestTone(target, lastOfVerse ? [keyPc % 12] : tones, lo, hi));
              continue;
            }
          } else {
            const u = i <= peakAt ? i / Math.max(1, peakAt) : 1 - (i - peakAt) / Math.max(1, syls.length - peakAt);
            target = startTarget + u * (5 + rnd() * 3);
          }
          anchors.set(i, nearestTone(target, tones, lo, hi));
        }
        let p = anchors.has(0) ? anchors.get(0) : prevPitch;
        for (let i = 0; i < syls.length; i += 1) {
          if (anchors.has(i)) {
            p = anchors.get(i);
          } else {
            // Step toward the next anchor, sometimes stay put.
            let next = null;
            for (let k = i + 1; k < syls.length; k += 1) if (anchors.has(k)) { next = anchors.get(k); break; }
            if (next === null) next = p;
            const stay = rnd() < (mood.chant ? 1 : 0.3);
            if (!stay) p = stepToward(p, next, scale, keyPc);
          }
          pitches.push(p);
        }
        if (mood.chant) {
          // A chant rides on two notes: accents up, the rest on the reciting tone.
          for (let i = 0; i < pitches.length; i += 1) pitches[i] = syls[i].stress === 2 ? tonic + 7 : tonic + 3 + (mood.mode === 'minor' ? 0 : 1);
          pitches[pitches.length - 1] = lastOfVerse ? tonic : tonic + 7;
        }
        tune = { pos, pitches, slots };
        memory.set(`${sig}:${lastOfVerse}`, tune);
      }
      prevPitch = tune.pitches[tune.pitches.length - 1];
      // Notes string.
      const toks = [];
      let cursor = 0;
      tune.pos.forEach((s, i) => {
        if (s > cursor) toks.push(`r:${(s - cursor) / 2}`);
        const next = i + 1 < tune.pos.length ? tune.pos[i + 1] : tune.slots;
        toks.push(`${midiToName(tune.pitches[i])}:${(next - s) / 2}`);
        cursor = next;
      });
      const lyric = [];
      let curWord = -1;
      for (const s of syls) {
        if (s.word !== curWord) { lyric.push(s.text.replace(/-/g, '=')); curWord = s.word; } else lyric[lyric.length - 1] += `-${s.text.replace(/-/g, '=')}`;
      }
      lines.push({
        s: li === 0 ? `Verse ${vi + 1}` : undefined,
        t: lyric.join(' '),
        n: toks.join(' '),
        c: chords.map((d) => `${chordName(keyPc, d)}:${meter}`).join(' '),
      });
    });
  });
  const first = lines[0] ? lines[0].c.split(' ')[0].split(':')[0] : NAMES[keyPc];
  return {
    id: opts.id || `made-${(opts.seed || 1).toString(36)}`,
    title: opts.title || 'My song',
    artist: 'Made with Singing',
    credit: 'Tune composed by the Singing song maker.',
    level: opts.level || 'A1',
    ages: 'all',
    emoji: opts.emoji || mood.emoji,
    hue: opts.hue ?? Math.floor(rnd() * 360),
    grammar: opts.grammar || ['Your text'],
    themes: [],
    vocab: opts.vocab || [],
    about: 'Made in the song maker. Change the mood or roll a new tune, then sing it in Karaoke.',
    bpm: opts.bpm || mood.bpm,
    meter,
    key: NAMES[keyPc],
    style: mood.style,
    intro: `${first}:4 ${first}:4`,
    lines: lines.map((l) => (l.s ? l : { t: l.t, n: l.n, c: l.c })),
    source: 'band',
    composed: { text, mood: opts.mood || 'pop', seed: opts.seed || 1, key: keyName },
  };
}
