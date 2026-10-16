/*
 * Which words to hide (gap fills) and which wrong words to offer
 * (multiple choice, "wrong word" game).
 */
import { normWord, levenshtein } from './text.js';
import { STOPWORDS, COMMON, frequencyRank, IRREGULAR_PAST, IRREGULAR_BASE, PRONOUNS, PREPOSITIONS, MODALS, ANIMALS, COLOURS, BODY, FOOD, FAMILY, NUMBERS, FEELINGS, ACTION_VERBS, rhymeFamily } from './wordlists.js';
import { categoryById, baseForm, pastOf } from './grammar.js';
import { rhymesFrom } from './rhymes.js';
import { seeded, shuffle } from '../ui.js';

export const GAP_LEVELS = [
  { id: 'easy', name: 'Beginner', emoji: '🌱', desc: 'One word per line' },
  { id: 'medium', name: 'Intermediate', emoji: '🌿', desc: 'About a quarter of the words' },
  { id: 'hard', name: 'Advanced', emoji: '🌳', desc: 'Half of the words' },
  { id: 'all', name: 'Expert', emoji: '🔥', desc: 'Every word!' },
];

function wordCounts(timeline) {
  const counts = new Map();
  for (const l of timeline.lines) for (const w of l.words) {
    const n = normWord(w.text);
    if (n) counts.set(n, (counts.get(n) || 0) + 1);
  }
  return counts;
}

function gapScore(norm, { last, count, mode }) {
  if (!norm || !/[a-z0-9]/.test(norm)) return -1;
  const stop = STOPWORDS.has(norm);
  let s = stop ? 1 : 3;
  if (norm.length < 3) s -= 1;
  if (mode === 'easy') {
    if (frequencyRank(norm) < 500) s += 1;
    if (count > 1) s += 1;
    if (last) s += 1.5;
    if (stop) s -= 2;
  } else if (mode === 'medium') {
    if (last) s += 1;
    if (norm.length > 7) s -= 0.5;
  }
  return s;
}

/*
 * -> Map(lineIndex -> Set(wordIndex))
 * mode: easy | medium | hard | all | cat:<categoryId>
 */
export function pickGaps(timeline, { mode = 'easy', seed = 1 } = {}) {
  const rnd = seeded(seed);
  const counts = wordCounts(timeline);
  const out = new Map();
  const cat = mode.startsWith('cat:') ? categoryById(mode.slice(4)) : null;
  for (const l of timeline.lines) {
    if (l.instrumental) continue;
    const scored = l.words.map((w, i) => {
      const norm = normWord(w.text);
      return { i, norm, score: gapScore(norm, { last: i === l.words.length - 1, count: counts.get(norm) || 0, mode }) + rnd() * 0.5 };
    }).filter((x) => x.score > 0);
    if (!scored.length) continue;
    let chosen = [];
    if (cat) {
      chosen = scored.filter((x) => cat.test(x.norm));
    } else if (mode === 'all') {
      chosen = scored;
    } else {
      const share = mode === 'easy' ? 0 : mode === 'medium' ? 0.25 : 0.5;
      const want = mode === 'easy' ? 1 : Math.max(1, Math.min(mode === 'medium' ? 3 : 8, Math.round(scored.length * share)));
      chosen = scored.slice().sort((a, b) => b.score - a.score).slice(0, want);
    }
    if (chosen.length) out.set(l.index, new Set(chosen.map((x) => x.i)));
  }
  return out;
}

function wordPool(timeline) {
  const set = new Set();
  for (const l of timeline.lines) for (const w of l.words) {
    const n = normWord(w.text);
    if (n && /^[a-z']+$/.test(n)) set.add(n);
  }
  return [...set];
}

const PRONOUN_GROUPS = [
  ['i', 'you', 'he', 'she', 'it', 'we', 'they'],
  ['me', 'you', 'him', 'her', 'it', 'us', 'them'],
  ['my', 'your', 'his', 'her', 'its', 'our', 'their'],
];
const ARTICLES = ['a', 'an', 'the'];
const MODAL_LIST = ['can', 'could', 'will', 'would', 'should', 'must', 'may', 'might'];
const SETS = [ANIMALS, COLOURS, BODY, FOOD, FAMILY, NUMBERS, FEELINGS, ACTION_VERBS];

function matchCase(src, w) {
  if (!w) return w;
  if (src === src.toUpperCase() && src.length > 1) return w.toUpperCase();
  if (src[0] === src[0].toUpperCase() && /[A-Za-z]/.test(src[0])) return w[0].toUpperCase() + w.slice(1);
  return w;
}

/*
 * Plausible wrong options for a word. kind:
 *   'choice' - for multiple choice: grammar forms first, then sound-alikes
 *   'listen' - for the wrong-word game: sound-alikes and same-topic words
 */
export function distractors(word, { pool = [], count = 2, seed = 1, kind = 'choice' } = {}) {
  const rnd = seeded(seed);
  const w = normWord(word);
  const out = [];
  const add = (cand) => {
    const c = normWord(cand);
    if (!c || c === w || out.includes(c) || c.length < 1) return;
    out.push(c);
  };
  const grammarForms = () => {
    if (IRREGULAR_PAST.has(w)) {
      const base = IRREGULAR_PAST.get(w);
      add(base);
      add(`${base}ed`.replace(/eed$/, 'ed'));
    } else if (/ed$/.test(w) && w.length > 4) {
      const base = baseForm(w);
      add(base);
      add(`${base}s`);
    } else if (/ing$/.test(w) && w.length > 4) {
      const base = baseForm(w);
      add(base);
      add(`${base}s`);
      add(pastOf(base));
    } else if (IRREGULAR_BASE.has(w) && w.length > 2) {
      add(IRREGULAR_BASE.get(w)[0]);
      add(`${w}s`);
    }
    for (const g of PRONOUN_GROUPS) if (g.includes(w)) shuffle(g, rnd).forEach(add);
    if (ARTICLES.includes(w)) ARTICLES.forEach(add);
    if (MODALS.has(w)) shuffle(MODAL_LIST, rnd).forEach(add);
    if (PREPOSITIONS.has(w)) shuffle(['in', 'on', 'at', 'under', 'over', 'to', 'from', 'with', 'by', 'for'], rnd).forEach(add);
  };
  const soundAlikes = () => {
    shuffle(rhymesFrom(w, pool), rnd).forEach(add);
    const fam = rhymeFamily(w);
    if (fam) shuffle(fam, rnd).forEach(add);
    const close = [...new Set([...pool, ...COMMON])]
      .filter((c) => c !== w && Math.abs(c.length - w.length) <= 1 && c.length > 2)
      .map((c) => ({ c, d: levenshtein(c, w) }))
      .filter((x) => x.d > 0 && x.d <= (w.length > 5 ? 2 : 1))
      .sort((a, b) => a.d - b.d || rnd() - 0.5)
      .slice(0, 6)
      .map((x) => x.c);
    close.forEach(add);
  };
  const sameTopic = () => {
    for (const set of SETS) if (set.has(w)) shuffle([...set], rnd).slice(0, 6).forEach(add);
  };
  if (kind === 'choice') {
    grammarForms();
    if (out.length < count) soundAlikes();
    if (out.length < count) sameTopic();
  } else {
    soundAlikes();
    sameTopic();
    if (out.length < count) grammarForms();
  }
  if (out.length < count) {
    shuffle(pool.filter((p) => Math.abs(p.length - w.length) <= 3), rnd).forEach(add);
  }
  return out.slice(0, count).map((c) => matchCase(String(word).replace(/^[^A-Za-z']+/, ''), c));
}

export { wordPool };
