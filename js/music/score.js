/*
 * Song files -> a timeline every screen can read.
 *
 * A song line pairs lyrics with notes:
 *   { t: 'Twin-kle, twin-kle, lit-tle star,', n: 'C4 C G G A A G:2', c: 'C F:2 C:2' }
 * Hyphens split syllables, "_" holds the previous syllable over another note,
 * "=" is a hyphen that shows ("bye=bye"). Each sung note (not rests) takes the
 * next syllable. Lines can share a tune: song.phrases.A = { n, c } and
 * { t, p: 'A' }. When a line has more or fewer syllables than its tune has
 * notes, the tune is bent to fit (notes split or held) - which is also how the
 * Remix screen fits students' own words to a melody.
 *
 * Times here are in beats from the start of the intro; seconds come later
 * (tempo is the player's business).
 */
import { parseNotes, parseChords } from './notes.js';

export function splitLyric(text) {
  const words = [];
  for (const raw of String(text || '').trim().split(/\s+/).filter(Boolean)) {
    if (/^_+$/.test(raw)) {
      for (let i = 0; i < raw.length; i += 1) words.push({ melisma: true });
      continue;
    }
    const parts = raw.split('-').filter((p) => p !== '');
    const syllables = parts.map((p) => p.replace(/=/g, '-'));
    if (syllables.length) words.push({ syllables });
  }
  return words;
}

// Flatten to the sequence of tokens that consume notes.
export function lyricTokens(text) {
  const out = [];
  splitLyric(text).forEach((w, wi) => {
    if (w.melisma) { out.push({ melisma: true }); return; }
    w.syllables.forEach((s, si) => out.push({ text: s, word: wi, first: si === 0, last: si === w.syllables.length - 1 }));
  });
  return out;
}

export function countSyllables(text) {
  return lyricTokens(text).filter((t) => !t.melisma).length;
}

/*
 * Bend a tune so it carries exactly `want` syllables.
 * More syllables than notes: split the longest notes in two (same pitch).
 * Fewer: first merge repeated pitches, then let a syllable hold over the
 * shortest note pairs (a melisma). Rests are never touched.
 */
export function fitNotes(notes, want) {
  let list = notes.map((n) => ({ ...n }));
  const sung = () => list.filter((n) => n.kind !== 'rest' && !n.hold).length;
  let guard = 0;
  while (sung() < want && guard++ < 500) {
    let bestIdx = -1;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].kind === 'rest') continue;
      if (bestIdx < 0 || list[i].beats > list[bestIdx].beats + 1e-9) bestIdx = i;
    }
    if (bestIdx < 0) break;
    const n = list[bestIdx];
    const half = n.beats / 2;
    list.splice(bestIdx, 1, { ...n, beats: half }, { ...n, beats: half });
  }
  guard = 0;
  while (sung() > want && guard++ < 500) {
    // Prefer merging a repeated pitch into its neighbour.
    let merged = false;
    for (let i = list.length - 1; i > 0; i -= 1) {
      const a = list[i - 1];
      const b = list[i];
      if (a.kind === 'note' && b.kind === 'note' && a.midi === b.midi && !b.hold && !a.hold) {
        list.splice(i - 1, 2, { ...a, beats: a.beats + b.beats });
        merged = true;
        break;
      }
    }
    if (merged) continue;
    // Otherwise the shortest sung note becomes a hold of the note before it.
    let pick = -1;
    for (let i = 1; i < list.length; i += 1) {
      const n = list[i];
      if (n.kind === 'rest' || n.hold) continue;
      const prev = list[i - 1];
      if (prev.kind === 'rest') continue;
      if (pick < 0 || n.beats < list[pick].beats - 1e-9) pick = i;
    }
    if (pick < 0) break;
    list[pick].hold = true;
  }
  return list;
}

function lineSource(song, line) {
  if (line.p) {
    const ph = song.phrases && song.phrases[line.p];
    if (!ph) throw new Error(`Unknown phrase "${line.p}" in "${song.id}"`);
    return { n: line.n || ph.n, c: line.c !== undefined ? line.c : ph.c, pk: line.pk !== undefined ? line.pk : ph.pk };
  }
  return { n: line.n || '', c: line.c, pk: line.pk };
}

/*
 * Compile a song into:
 *   lines[]: { index, text, part, section, start, end, words[], syllables[], notes[] }
 *   chords[]: { start, beats, name, chord }
 *   melody[]: { start, beats, midi|null, hit, syl }
 *   introBeats, totalBeats, meter, warnings[]
 */
export function compileSong(song) {
  const meter = song.meter || 4;
  const warnings = [];
  const introChords = parseChords(song.intro !== undefined ? song.intro : '', meter);
  let introBeats = introChords.reduce((a, c) => a + c.beats, 0);
  const pickup = song.pickup || 0;
  if (!introChords.length) introBeats = meter * (song.introBars !== undefined ? song.introBars : 1);
  const chords = [];
  let t = 0;
  for (const c of introChords) {
    chords.push({ start: t, beats: c.beats, name: c.name, chord: c.chord });
    t += c.beats;
  }
  t = introBeats - pickup;
  if (t < 0) t = 0;
  const firstLineStart = t;

  const lines = [];
  const melody = [];
  let prevMidi = song.startMidi || 60;
  let section = '';
  (song.lines || []).forEach((line, index) => {
    if (line.s) section = line.s;
    const src = lineSource(song, line);
    let notes = parseNotes(src.n, prevMidi);
    const tokens = lyricTokens(line.t || '');
    const explicitMelisma = tokens.some((x) => x.melisma);
    const sylCount = tokens.filter((x) => !x.melisma).length;
    const noteCount = notes.filter((n) => n.kind !== 'rest').length;
    if (!explicitMelisma && sylCount && noteCount !== sylCount) {
      if (!line.fit && !song.allowFit) warnings.push(`Line ${index + 1} of "${song.id}": ${sylCount} syllables for ${noteCount} notes - fitted.`);
      notes = fitNotes(notes, sylCount);
    }
    for (const n of notes) if (n.kind === 'note') prevMidi = n.midi;

    // A pickup (pk) starts the line before the bar line, borrowing the end of
    // the previous line's last note. Chords still start on the downbeat.
    const pk = index === 0 ? 0 : (src.pk || 0);
    if (pk > 0 && lines.length) {
      t -= pk;
      const prev = lines[lines.length - 1];
      for (let i = melody.length - 1; i >= 0; i -= 1) {
        const m = melody[i];
        if (m.start + m.beats <= t + 1e-9) break;
        m.beats = Math.max(0.05, t - m.start);
      }
      for (const s of prev.syllables) if (s.end > t) s.end = Math.max(s.start + 0.05, t);
      for (const w of prev.words) if (w.end > t) w.end = Math.max(w.start + 0.05, t);
      prev.end = t;
      prev.singEnd = Math.min(prev.singEnd, t);
    }
    const downbeat = t + (index === 0 ? pickup : pk);

    const lineStart = t;
    const syllables = [];
    const words = [];
    let tokIdx = 0;
    let cur = null;
    for (const n of notes) {
      const ev = { start: t, beats: n.beats, midi: n.kind === 'note' ? n.midi : null, hit: n.kind === 'hit', line: index };
      if (n.kind !== 'rest') {
        const tok = n.hold ? { melisma: true } : tokens[tokIdx++];
        if (!tok || tok.melisma) {
          if (cur) {
            cur.end = t + n.beats;
            cur.notes.push(ev);
            ev.syl = cur.index;
          } else if (!tok) {
            // Extra notes with no lyrics left: still part of the melody.
            ev.syl = -1;
          }
        } else {
          cur = {
            index: syllables.length,
            text: tok.text,
            first: tok.first,
            last: tok.last,
            word: tok.word,
            start: t,
            end: t + n.beats,
            midi: ev.midi,
            hit: ev.hit,
            notes: [ev],
          };
          syllables.push(cur);
          ev.syl = cur.index;
        }
        melody.push(ev);
      }
      t += n.beats;
    }
    if (tokIdx < tokens.length) {
      const left = tokens.slice(tokIdx).filter((x) => !x.melisma);
      if (left.length) warnings.push(`Line ${index + 1} of "${song.id}": ${left.length} syllables without notes.`);
    }
    // Words from syllables.
    for (const s of syllables) {
      let w = words[words.length - 1];
      if (!w || s.first || w.wordIndex !== s.word) {
        w = { wordIndex: s.word, text: '', syllables: [], start: s.start, end: s.end };
        words.push(w);
      }
      w.syllables.push(s.index);
      w.text += s.text;
      w.end = s.end;
    }
    const lineEnd = t + (line.gap || 0);
    t = lineEnd;
    const lineBeats = lineEnd - lineStart;

    // Chords for this line ("." keeps the previous chord sounding).
    if (src.c !== undefined && src.c !== null && src.c !== '') {
      let ct = downbeat;
      const parsed = parseChords(src.c, meter);
      const sum = parsed.reduce((a, c) => a + c.beats, 0);
      if (Math.abs(sum - (lineEnd - downbeat)) > 1e-6) {
        warnings.push(`Line ${index + 1} of "${song.id}": chords last ${sum} beats, line lasts ${lineEnd - downbeat} after its pickup.`);
      }
      for (const c of parsed) {
        let beats = c.beats;
        if (ct >= lineEnd - 1e-9) break;
        if (ct + beats > lineEnd) beats = lineEnd - ct;
        if (c.name === '.') {
          const prev = chords[chords.length - 1];
          if (prev) chords.push({ start: ct, beats, name: prev.name, chord: prev.chord, cont: true });
        } else {
          chords.push({ start: ct, beats, name: c.name, chord: c.chord });
        }
        ct += beats;
      }
      if (ct < lineEnd - 1e-9 && chords.length) {
        const last = chords[chords.length - 1];
        last.beats += lineEnd - ct;
      }
    } else if (chords.length) {
      // No chords given: the last chord rings on.
      chords.push({ start: lineStart, beats: lineBeats, name: chords[chords.length - 1].name, chord: chords[chords.length - 1].chord, cont: true });
    }

    lines.push({
      index,
      text: words.map((w) => w.text).join(' '),
      raw: line.t || '',
      part: line.part || '',
      section,
      sectionStart: !!line.s,
      start: lineStart,
      end: lineEnd,
      singStart: syllables.length ? syllables[0].start : lineStart,
      singEnd: syllables.length ? syllables[syllables.length - 1].end : lineEnd,
      words,
      syllables,
      instrumental: syllables.length === 0,
      translation: line.tr || '',
      pic: line.pic || '',
    });
  });

  // Outro: one bar on the last chord, then stop.
  const outroBeats = song.outro !== undefined ? song.outro : meter;
  if (outroBeats > 0 && chords.length) {
    const last = chords[chords.length - 1];
    chords.push({ start: t, beats: outroBeats, name: last.name, chord: last.chord, cont: true, outro: true });
  }
  const totalBeats = t + Math.max(0, outroBeats);

  return {
    id: song.id,
    meter,
    pickup,
    introBeats,
    firstLineStart,
    totalBeats,
    lines,
    chords: mergeChords(chords),
    melody,
    warnings,
  };
}

// Join back-to-back identical chords so the band does not re-strike them.
function mergeChords(list) {
  const out = [];
  for (const c of list) {
    let prev = out[out.length - 1];
    // A pickup's chord starts inside the intro's last bar: cut the intro short.
    while (prev && prev.start + prev.beats > c.start + 1e-9) {
      prev.beats = c.start - prev.start;
      if (prev.beats > 1e-9) break;
      out.pop();
      prev = out[out.length - 1];
    }
    if (prev && c.cont && prev.name === c.name && Math.abs(prev.start + prev.beats - c.start) < 1e-6) {
      prev.beats += c.beats;
      if (c.outro) prev.outro = true;
      continue;
    }
    out.push({ ...c });
  }
  return out;
}

export function chordAt(compiled, beat) {
  const list = compiled.chords;
  let lo = 0;
  let hi = list.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start <= beat + 1e-9) { found = list[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

export function lineAt(compiled, beat) {
  const list = compiled.lines;
  let found = -1;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].start <= beat + 1e-9) found = i; else break;
  }
  return found;
}
