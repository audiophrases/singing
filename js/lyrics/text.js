/*
 * Words in lyrics: splitting, normalising, and checking a typed answer.
 */
import { CONTRACTIONS } from './wordlists.js';

const APOS = /[‘’ʼ`´]/g;

// "Don't," -> "don't"; "(clap)" -> "clap"; "—" -> ""
export function normWord(w) {
  let s = String(w || '').replace(APOS, "'").toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
  if (s.startsWith("'") && !/^'(cause|em|til|bout)$/.test(s)) s = s.replace(/^'+/, '');
  if (s.endsWith("'") && !/in'$/.test(s)) s = s.replace(/'+$/, '');
  return s;
}

export function isWord(raw) {
  return /[A-Za-z0-9]/.test(String(raw || ''));
}

/*
 * Split a line into tokens keeping punctuation for display:
 *   [{ raw: 'star,', lead: '', core: 'star', trail: ',', norm: 'star', word: true }]
 */
export function tokenize(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).map((raw) => {
    const m = /^([^A-Za-z0-9'’]*)(.*?)([^A-Za-z0-9'’]*)$/.exec(raw);
    const core = m ? m[2] : raw;
    return {
      raw,
      lead: m ? m[1] : '',
      core,
      trail: m ? m[3] : '',
      norm: normWord(core),
      word: isWord(core),
    };
  });
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function variants(w) {
  const out = new Set([w]);
  if (CONTRACTIONS.has(w)) out.add(CONTRACTIONS.get(w).replace(/\s+/g, ''));
  const n = NUM_WORDS.indexOf(w);
  if (n >= 0) out.add(String(n));
  if (/^\d+$/.test(w) && NUM_WORDS[Number(w)]) out.add(NUM_WORDS[Number(w)]);
  out.add(w.replace(/'/g, ''));
  out.add(w.replace(/our$/, 'or')); // colour/color
  out.add(w.replace(/ise$/, 'ize'));
  out.add(w.replace(/in'$/, 'ing'));
  return out;
}

/*
 * Compare a typed answer with the expected word(s).
 * -> 'right' | 'close' (one typo in a longer word) | 'wrong'
 */
export function checkAnswer(typed, expected) {
  const a = String(typed || '').trim().split(/\s+/).map(normWord).filter(Boolean).join(' ');
  const b = String(expected || '').trim().split(/\s+/).map(normWord).filter(Boolean).join(' ');
  if (!a) return 'wrong';
  if (a === b) return 'right';
  const va = variants(a.replace(/\s+/g, ''));
  for (const v of variants(b.replace(/\s+/g, ''))) if (va.has(v)) return 'right';
  const flatA = a.replace(/[\s']/g, '');
  const flatB = b.replace(/[\s']/g, '');
  if (flatA === flatB) return 'right';
  if (flatB.length >= 5 && levenshtein(flatA, flatB) <= 1) return 'close';
  if (flatB.length >= 9 && levenshtein(flatA, flatB) <= 2) return 'close';
  return 'wrong';
}

// Letters shown as a hint: "w_ _ _ _ r" style.
export function hintFor(word, revealed = 1) {
  const chars = [...String(word || '')];
  let shown = 0;
  return chars.map((c) => {
    if (!/[A-Za-z]/.test(c)) return c;
    if (shown < revealed) { shown += 1; return c; }
    return '_';
  }).join('');
}
