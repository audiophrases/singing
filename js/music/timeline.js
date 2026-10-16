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
 * Lyrics synced only by line (or by some words): spread the words across each
 * line by syllable weight. lines: [{ text, start, end?, words?: [{ text, start? }] }]
 */
export function timelineFromSynced(lines, duration) {
  const out = [];
  const valid = lines.filter((l) => Number.isFinite(l.start));
  for (let i = 0; i < valid.length; i += 1) {
    const l = valid[i];
    const next = valid[i + 1];
    const end = Number.isFinite(l.end) ? l.end : next ? next.start : Math.min(duration || l.start + 5, l.start + 6);
    const rawWords = String(l.text || '').trim().split(/\s+/).filter(Boolean);
    const weights = rawWords.map((w) => guessSyllables(w) + 0.35);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    // Leave a little air at the end of the line.
    const singEnd = end - Math.min(0.6, (end - l.start) * 0.12);
    const span = Math.max(0.2, singEnd - l.start);
    let t = l.start;
    const fixed = Array.isArray(l.words) ? l.words : [];
    const words = rawWords.map((w, wi) => {
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
    out.push({
      index: i,
      text: rawWords.join(' '),
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
