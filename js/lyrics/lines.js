/*
 * The Studio's lyrics, one line per sung line:
 *   [Chorus]                 starts a section
 *   🌟 Twinkle little star    a leading emoji is the line's picture
 *   A: How are you?          "A:" (Boys:, Girls:, Teacher:...) is a part
 *   Hello | Hola             after " | " comes a translation
 *
 * Editing the text keeps the timing: a line that did not change keeps
 * everything (times, word times, notes), and a line edited in place keeps its
 * start and end, even when lines were added or removed elsewhere.
 */

export function lineSource(l) {
  return `${l.pic ? `${l.pic} ` : ''}${l.part ? `${l.part}: ` : ''}${l.text}${l.tr ? ` | ${l.tr}` : ''}`;
}

export function lyricsText(synced = []) {
  return synced.map((l) => `${l.section ? `[${l.section}]\n` : ''}${lineSource(l)}`).join('\n');
}

export function parseLyrics(text, previous = []) {
  const out = [];
  const src = [];
  let section = '';
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { section = sec[1].trim(); continue; }
    let rest = line;
    let tr = '';
    const bar = rest.indexOf(' | ');
    if (bar >= 0) { tr = rest.slice(bar + 3).trim(); rest = rest.slice(0, bar).trim(); }
    let pic = '';
    const em = /^((?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:️|‍(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}))*)\s+/u.exec(rest);
    if (em) { pic = em[1]; rest = rest.slice(em[0].length); }
    let part = '';
    const pm = /^([A-Za-z][\w ]{0,11}):\s+(.+)$/.exec(rest);
    const label = pm ? pm[1].trim() : '';
    if (pm && (!/\s/.test(label) || /^group \d$/i.test(label))) { part = label; rest = pm[2]; }
    const item = { text: rest, pic, part, tr };
    if (section) { item.section = section; section = ''; }
    out.push(item);
    src.push(line);
  }
  if (!previous.length) return out;

  // Line up the new lines with the old ones (longest common subsequence).
  const old = previous.map(lineSource);
  const n = src.length;
  const m = old.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) dp[i][j] = src[i] === old[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const anchors = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (src[i] === old[j]) { anchors.push([i, j]); i += 1; j += 1; } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1; else j += 1;
  }
  anchors.push([n, m]);
  let pi = 0;
  let pj = 0;
  for (const [ai, aj] of anchors) {
    // Between two unchanged lines, as many lines as before: edited in place.
    if (ai - pi === aj - pj) for (let k = 0; k < ai - pi; k += 1) keepTimes(out[pi + k], previous[pj + k]);
    if (ai < n) {
      const sec = out[ai].section;
      out[ai] = { ...previous[aj] };
      delete out[ai].section;
      if (sec) out[ai].section = sec;
    }
    pi = ai + 1;
    pj = aj + 1;
  }
  return out;
}

function keepTimes(l, p) {
  if (Number.isFinite(p.start)) l.start = p.start;
  if (Number.isFinite(p.end)) l.end = p.end;
  // Word times and notes belong to the words, so only if those are the same.
  if (p.text === l.text) {
    if (p.words) l.words = p.words;
    if (p.notes) l.notes = p.notes;
  }
}
