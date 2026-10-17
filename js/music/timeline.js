/*
 * The timeline: what every game and the karaoke screen read, whatever is
 * playing the music (the built-in band, a YouTube video or an audio file).
 *
 *   { duration, lines: [{ index, text, start, end, singStart, singEnd, section,
 *     part, translation, pic, words: [{ text, start, end, syllables: [{ text,
 *     start, end, midi }] }] }] }
 *
 * All times are seconds of the original recording / base tempo. A player that
 * slows down still reports these times, so nothing else needs to know.
 */

export function timelineFromCompiled(compiled, bpm) {
  const k = 60 / bpm;
  const lines = compiled.lines.map((l) => {
    const syl = l.syllables.map((s) => ({ text: s.text, start: s.start * k, end: s.end * k, midi: s.midi, hit: s.hit, first: s.first, last: s.last }));
    const words = l.words.map((w) => ({
      text: w.text,
      start: w.start * k,
      end: w.end * k,
      syllables: w.syllables.map((i) => syl[i]),
    }));
    return {
      index: l.index,
      text: l.text,
      start: l.start * k,
      end: l.end * k,
      singStart: l.singStart * k,
      singEnd: l.singEnd * k,
      section: l.section,
      sectionStart: l.sectionStart,
      part: l.part,
      translation: l.translation,
      pic: l.pic,
      instrumental: l.instrumental,
      words,
      syllables: syl,
    };
  });
  return { duration: compiled.totalBeats * k, beat: k, meter: compiled.meter, lines };
}

// Rough syllable count for plain English words (used for timing estimates).
export function guessSyllables(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/*
 * Notes from an UltraStar file, [start, end, midi|null, text, golden?], into
 * words made of syllables. A syllable starting with a space begins a new word,
 * one ending with a space ends it, and "~" holds the syllable before.
 */
export function wordsFromNotes(notes) {
  const words = [];
  let word = null;
  let last = null;
  const close = () => {
    if (word && word.length) words.push(word);
    word = null;
  };
  for (const n of notes || []) {
    const raw = String(n[3] ?? '');
    const t = raw.trim();
    if (/^\s/.test(raw)) close();
    if (!t || t[0] === '~') {
      if (last) {
        last.end = Math.max(last.end, n[1]);
        last.text += t.replace(/~/g, '');
      }
    } else {
      if (!word) word = [];
      last = { text: t.replace(/~/g, ''), start: n[0], end: n[1], midi: Number.isFinite(n[2]) ? n[2] : null };
      word.push(last);
    }
    if (/\s$/.test(raw)) close();
  }
  close();
  return words.map((syllables) => ({
    text: syllables.map((s) => s.text).join(''),
    start: syllables[0].start,
    end: syllables[syllables.length - 1].end,
    syllables,
  }));
}

export function notesText(notes) {
  return wordsFromNotes(notes).map((w) => w.text).join(' ');
}

/*
 * Lines without a time get one: spread between their timed neighbours, or
 * one after another at a reading pace when nothing is timed at all.
 */
export function fillTimes(lines, { pace = 0.34, gap = 1.2, start = 2 } = {}) {
  const out = lines.map((l) => {
    const c = { ...l };
    if (!Number.isFinite(c.start) && Array.isArray(c.notes) && c.notes.length) c.start = c.notes[0][0];
    return c;
  });
  const timed = (l) => l && Number.isFinite(l.start);
  const len = (l) => {
    const words = String(l.text || '').trim().split(/\s+/).filter(Boolean);
    return Math.max(1.5, words.reduce((a, w) => a + guessSyllables(w), 0) * pace);
  };
  if (!out.some(timed)) {
    let t = start;
    for (const l of out) {
      l.start = t;
      l.end = t + len(l);
      t = l.end + gap;
    }
    return out;
  }
  for (let i = 0; i < out.length; i += 1) {
    if (timed(out[i])) continue;
    let j = i;
    while (j < out.length && !timed(out[j])) j += 1;
    const run = out.slice(i, j);
    const prev = out[i - 1];
    const next = out[j];
    if (!next) {
      // At the end: one after another.
      let t = Number.isFinite(prev.end) ? prev.end + gap : prev.start + len(prev) + gap;
      for (const l of run) {
        l.start = t;
        l.end = t + len(l);
        t = l.end + gap;
      }
    } else {
      // Share the time before the next timed line (with the line before, if
      // nobody knows where that one ends).
      const share = prev && !Number.isFinite(prev.end) ? [prev, ...run] : run;
      const from = !prev ? Math.max(0, next.start - run.reduce((a, l) => a + len(l) + gap, 0)) : Number.isFinite(prev.end) ? prev.end : prev.start;
      const span = Math.max(0.3 * share.length, next.start - from);
      const weights = share.map(len);
      const total = weights.reduce((a, b) => a + b, 0);
      let t = from;
      share.forEach((l, k) => {
        if (l !== prev) l.start = t;
        t += (weights[k] / total) * span;
      });
    }
    i = j - 1;
  }
  return out;
}

/*
 * Lyrics synced by line, by some words (LRC) or note by note (UltraStar).
 * Lines synced only by line spread their words by syllable weight.
 * lines: [{ text, start?, end?, words?: [{ start? }], notes?: [[start, end, midi, text, golden?]] }]
 */
export function timelineFromSynced(lines, duration) {
  const out = [];
  const valid = fillTimes(lines || []);
  for (let i = 0; i < valid.length; i += 1) {
    const l = valid[i];
    const next = valid[i + 1];
    let end = Number.isFinite(l.end) ? l.end : next ? next.start : Math.min(duration || l.start + 5, l.start + 6);
    const rawWords = String(l.text || '').trim().split(/\s+/).filter(Boolean);
    const noted = Array.isArray(l.notes) && l.notes.length ? wordsFromNotes(l.notes) : null;
    let words;
    let notes = [];
    if (noted && noted.length && noted.map((w) => w.text).join(' ') === rawWords.join(' ')) {
      words = noted;
      notes = l.notes.filter((n) => Number.isFinite(n[2])).map((n) => {
        const t = String(n[3] ?? '').trim();
        return { start: n[0], end: n[1], midi: n[2], golden: !!n[4], text: t[0] === '~' ? '' : t };
      });
      if (!Number.isFinite(l.end)) end = Math.max(end, words[words.length - 1].end);
    } else {
      const weights = rawWords.map((w) => guessSyllables(w) + 0.35);
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      // Leave a little air at the end of the line.
      const singEnd = end - Math.min(0.6, (end - l.start) * 0.12);
      const span = Math.max(0.2, singEnd - l.start);
      let t = l.start;
      const fixed = Array.isArray(l.words) ? l.words : [];
      words = rawWords.map((w, wi) => {
        const fw = fixed[wi];
        let start = t;
        if (fw && Number.isFinite(fw.start)) start = fw.start;
        const dur = (weights[wi] / total) * span;
        t = start + dur;
        const syl = { text: w, start, end: t, midi: null };
        return { text: w, start, end: t, syllables: [syl] };
      });
      // Words with tapped starts: end each where the next begins.
      for (let wi = 0; wi < words.length - 1; wi += 1) {
        if (words[wi + 1].start > words[wi].start) {
          words[wi].end = Math.min(words[wi].end, words[wi + 1].start);
          if (fixed[wi + 1] && Number.isFinite(fixed[wi + 1].start)) words[wi].end = words[wi + 1].start;
          words[wi].syllables[0].end = words[wi].end;
        }
      }
    }
    out.push({
      index: i,
      text: words.map((w) => w.text).join(' '),
      start: l.start,
      end,
      singStart: words.length ? words[0].start : l.start,
      singEnd: words.length ? words[words.length - 1].end : end,
      section: l.section || '',
      sectionStart: !!l.section,
      part: l.part || '',
      translation: l.tr || '',
      pic: l.pic || '',
      instrumental: words.length === 0,
      words,
      syllables: words.flatMap((w) => w.syllables),
      notes,
    });
  }
  const last = out[out.length - 1];
  return { duration: duration || (last ? last.end + 2 : 0), beat: null, meter: null, lines: out };
}

export function lineIndexAt(timeline, t) {
  const lines = timeline.lines;
  let found = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].start <= t + 1e-6) found = i; else break;
  }
  return found;
}

// The line on screen: the one being sung, or the next one during a gap.
export function currentLineAt(timeline, t, lead = 0.8) {
  const lines = timeline.lines;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (t < l.singStart - lead) {
      if (i === 0) return -1;
      return t < lines[i - 1].singEnd + 0.4 ? i - 1 : i;
    }
    if (t < l.end) return i;
  }
  return lines.length - 1;
}

export function sungLines(timeline) {
  return timeline.lines.filter((l) => !l.instrumental);
}
