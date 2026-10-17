/*
 * English syllables and word stress, by rule (plus a few exceptions).
 *   syllabify('little') -> ['lit', 'tle']; stressIndex('today') -> 1
 * Used to fit any text to music: the song maker, remixes, chants.
 */
import { STOPWORDS, NOT_ED } from './wordlists.js';

const EXCEPT = {
  people: ['peo', 'ple'], every: ['ev', 'ery'], everyone: ['ev', 'ery', 'one'], everybody: ['ev', 'ery', 'bo', 'dy'],
  everything: ['ev', 'ery', 'thing'], everywhere: ['ev', 'ery', 'where'], beautiful: ['beau', 'ti', 'ful'], evening: ['eve', 'ning'],
  business: ['busi', 'ness'], different: ['dif', 'fer', 'ent'], chocolate: ['choc', 'late'], interesting: ['in', 'ter', 'est', 'ing'],
  vegetable: ['veg', 'ta', 'ble'], vegetables: ['veg', 'ta', 'bles'], favourite: ['fa', 'vour', 'ite'], favorite: ['fa', 'vor', 'ite'],
  fire: ['fire'], hour: ['hour'], our: ['our'], hours: ['hours'], flour: ['flour'], idea: ['i', 'de', 'a'], area: ['a', 're', 'a'],
  poem: ['po', 'em'], quiet: ['qui', 'et'], science: ['sci', 'ence'], piano: ['pi', 'a', 'no'], lion: ['li', 'on'],
  giraffe: ['gi', 'raffe'], banana: ['ba', 'na', 'na'], tomato: ['to', 'ma', 'to'], potato: ['po', 'ta', 'to'],
  family: ['fam', 'i', 'ly'], animal: ['an', 'i', 'mal'], animals: ['an', 'i', 'mals'], elephant: ['el', 'e', 'phant'],
  yesterday: ['yes', 'ter', 'day'], tomorrow: ['to', 'mor', 'row'], today: ['to', 'day'], tonight: ['to', 'night'],
  orange: ['or', 'ange'], wednesday: ['wednes', 'day'], february: ['feb', 'ru', 'ar', 'y'], cereal: ['ce', 're', 'al'],
  real: ['real'], really: ['real', 'ly'], usually: ['u', 'su', 'al', 'ly'], actually: ['ac', 'tu', 'al', 'ly'],
  'i\'m': ['I\'m'], goodbye: ['good', 'bye'], beyond: ['be', 'yond'], cupboard: ['cup', 'board'], island: ['is', 'land'], listen: ['lis', 'ten'], school: ['school'],
};

const STRESS_EXCEPT = {
  today: 1, tonight: 1, tomorrow: 1, hello: 1, again: 1, about: 1, above: 1, alone: 1, along: 1, away: 1, because: 1,
  before: 1, behind: 1, below: 1, beside: 1, between: 1, giraffe: 1, guitar: 1, balloon: 1, banana: 1, potato: 1, tomato: 1,
  hotel: 1, july: 1, japan: 1, brazil: 1, peru: 1, morocco: 1, canada: 0, italy: 0, china: 0, mexico: 0, idea: 1,
  forget: 1, forgot: 1, begin: 1, began: 1, become: 1, believe: 1, remember: 1, return: 1, repeat: 1, report: 1,
  correct: 1, complete: 1, computer: 1, potato_: 1, amazing: 1, delicious: 1, excited: 1, exciting: 1, eleven: 1,
  upon: 1, until: 1, unless: 1, goodbye: 1, kangaroo: 2, afternoon: 2, understand: 2, chimpanzee: 2, japanese: 2, chinese: 1, yourself: 1, myself: 1, himself: 1,
};

const VOWEL = /[aeiouy]/;
const DIGRAPHS = ['ch', 'sh', 'th', 'ph', 'wh', 'gh', 'ck', 'qu'];
const BLENDS = new Set(['bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'sc', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'tr', 'tw', 'wr', 'kn', 'thr', 'str', 'spr', 'scr', 'squ']);

// Indices of vowel letters that start a syllable nucleus, and their ends.
function nuclei(w) {
  const n = [];
  const isV = (i) => {
    const c = w[i];
    if (!c) return false;
    if (c === 'y') return (i > 0 && !VOWEL.test(w[i + 1] || '')) || (i > 0 && VOWEL.test(w[i - 1])) || (i > 0 && w.slice(i + 1, i + 4) === 'ing');
    if (c === 'u' && w[i - 1] === 'q') return false;
    return 'aeiou'.includes(c);
  };
  let i = 0;
  while (i < w.length) {
    if (!isV(i)) { i += 1; continue; }
    let j = i;
    while (j + 1 < w.length && isV(j + 1)) j += 1;
    // Split groups that are really two syllables: li-on, ra-di-o, go-ing, be-ing.
    const grp = w.slice(i, j + 1);
    const before = w[i - 1] || '';
    let split = -1;
    if (/i[aou]/.test(grp) && !/[tscxg]/.test(before) && grp.length >= 2) split = i + grp.search(/i[aou]/) + 1;
    if (w.slice(j + 1, j + 3) === 'ng' && grp.length >= 2 && grp.endsWith('i') && j + 3 === w.length) split = j;
    if (/eo/.test(grp) && i > 0) split = i + grp.indexOf('eo') + 1;
    if (split > i && split <= j) {
      n.push([i, split - 1]);
      n.push([split, j]);
    } else {
      n.push([i, j]);
    }
    i = j + 1;
  }
  // Silent final e (make, home) but not consonant+le (lit-tle) or the only vowel (the, me).
  const last = n[n.length - 1];
  if (n.length > 1 && last && last[0] === last[1] && w[last[0]] === 'e') {
    const end = w.length - 1;
    const pos = last[0];
    if (pos === end && !/[^aeiou]le$/.test(w) && !/[^aeiou]re$/.test(w)) n.pop();
    else if (pos === end - 1 && w[end] === 's' && !/(s|x|z|ch|sh|c|g)es$/.test(w) && !/[^aeiou]les$/.test(w)) n.pop();
    else if (pos === end - 1 && w[end] === 'd' && !/[td]ed$/.test(w) && !NOT_ED.has(w)) n.pop();
  }
  return n;
}

function splitCluster(cluster) {
  // Returns how many consonants stay with the first syllable.
  const L = cluster.length;
  if (L === 0) return 0;
  if (L === 1) return cluster === 'x' ? 1 : 0;
  const lower = cluster;
  for (const d of DIGRAPHS) {
    if (lower === d) return d === 'ck' ? 2 : 0;
    if (lower.startsWith(d)) return d === 'qu' ? 0 : 2;
  }
  if (lower.endsWith('ng') && L === 2) return 2;
  if (L === 2) return BLENDS.has(lower) && lower !== 'st' && lower !== 'sk' && lower !== 'sp' ? 0 : 1;
  // A digraph inside the cluster stays with the first syllable (birth-day).
  for (const d of DIGRAPHS) {
    const at = lower.indexOf(d);
    if (at > 0 && d !== 'qu') return at + 2;
  }
  const tail3 = lower.slice(-3);
  const tail2 = lower.slice(-2);
  if (BLENDS.has(tail3)) return L - 3;
  if (BLENDS.has(tail2)) return L - 2;
  return L - 1;
}

export function syllabify(word) {
  const raw = String(word || '');
  const m = /^([^A-Za-z']*)([A-Za-z'’]+)([^A-Za-z']*)$/.exec(raw);
  if (!m) return [raw];
  const [, lead, core, trail] = m;
  const lower = core.toLowerCase().replace(/’/g, "'");
  const ex = EXCEPT[lower];
  let parts;
  if (ex) {
    // Keep the original letters (and capitals).
    parts = [];
    let k = 0;
    for (const p of ex) {
      parts.push(core.slice(k, k + p.length));
      k += p.length;
    }
    if (k < core.length) parts[parts.length - 1] += core.slice(k);
  } else {
    const w = lower;
    const n = nuclei(w);
    if (n.length <= 1) parts = [core];
    else {
      const cuts = [];
      for (let i = 0; i < n.length - 1; i += 1) {
        const a = n[i][1] + 1;
        const b = n[i + 1][0];
        const cluster = w.slice(a, b).replace(/'/g, '');
        // Consonant + "le" at the end is its own syllable: lit-tle, twin-kle, ap-ple.
        const leEnd = i === n.length - 2 && /[^aeiou]le$/.test(w) && cluster.length >= 2 && cluster.endsWith('l');
        cuts.push(a + (leEnd ? cluster.length - 2 : splitCluster(cluster)));
      }
      parts = [];
      let prev = 0;
      for (const c of cuts) { parts.push(core.slice(prev, c)); prev = c; }
      parts.push(core.slice(prev));
      parts = parts.filter((p) => p.length);
    }
  }
  parts[0] = lead + parts[0];
  parts[parts.length - 1] += trail;
  return parts;
}

export function stressIndex(word, sylls) {
  const w = String(word || '').toLowerCase().replace(/[^a-z']/g, '');
  const s = sylls || syllabify(w);
  if (s.length <= 1) return 0;
  if (w in STRESS_EXCEPT) return Math.min(s.length - 1, STRESS_EXCEPT[w]);
  if (/(tion|sion|cian|ic|ity|ical|ian|ial|ious)s?$/.test(w)) return Math.max(0, s.length - 2);
  if (/(ee|eer|oon|ette|ese|ique)s?$/.test(w)) return s.length - 1;
  const first = s[0].toLowerCase();
  if (s.length >= 2 && /^(a|be|de|re|un|to|for|e|ex|com|con|pro|pre|po|ba|ga|ma)$/.test(first) && !/^(every|any|many|ever|after|under|over|other|enter|even|ending|extra|exercise|animal|apple|area|ever)/.test(w)) return 1;
  return 0;
}

/*
 * A line of text -> [{ text, word, first, last, stress }] where stress is
 * 2 (stressed syllable of a content word), 1 (stressed but a small word)
 * or 0 (unstressed).
 */
export function lineSyllables(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const out = [];
  words.forEach((w, wi) => {
    const sy = syllabify(w);
    const core = w.toLowerCase().replace(/[^a-z']/g, '');
    const st = stressIndex(core, sy);
    const small = STOPWORDS.has(core) || core.length <= 2;
    sy.forEach((s, si) => {
      out.push({
        text: s,
        word: wi,
        first: si === 0,
        last: si === sy.length - 1,
        stress: si === st ? (small ? 1 : 2) : 0,
        pause: si === sy.length - 1 && /[,;:.!?—-]$/.test(w),
      });
    });
  });
  return out;
}

// "Twin-kle, twin-kle" style text from syllables (what song files use).
export function hyphenate(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).map((w) => syllabify(w.replace(/-/g, '=')).join('-')).join(' ');
}
