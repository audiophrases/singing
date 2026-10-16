/*
 * Rhymes from spelling. English spelling is wild, so this is a best guess
 * built from the common patterns plus a list of exceptions - plenty for
 * songs, which choose their rhymes on purpose.
 */
import { rhymeFamily } from './wordlists.js';
import { normWord } from './text.js';

const EXCEPT = {
  are: 'ar', were: 'er', there: 'ea', where: 'ea', their: 'ea', bear: 'ea', wear: 'ea', pear: 'ea', swear: 'ea',
  you: 'uu', do: 'uu', to: 'uu', too: 'uu', two: 'uu', who: 'uu', through: 'uu', shoe: 'uu', gone: 'on', 'you\'re': 'or', your: 'or',
  said: 'ed', says: 'ez', again: 'en', been: 'in', one: 'un', done: 'un', none: 'un', won: 'un', some: 'um', come: 'um',
  love: 'uv', above: 'uv', dove: 'uv', glove: 'uv', move: 'uuv', prove: 'uuv', eye: 'ai', bye: 'ai', buy: 'ai', guy: 'ai',
  i: 'ai', laugh: 'af', half: 'af', giraffe: 'af', four: 'or', door: 'or', floor: 'or', pour: 'or', eight: 'eit',
  great: 'eit', weight: 'eit', straight: 'eit', height: 'ait', heart: 'art', friend: 'end', give: 'iv', live: 'iv',
  have: 'av', what: 'ot', want: 'ont', was: 'oz', does: 'uz', blood: 'ud', good: 'ud', wood: 'ud', could: 'ud',
  would: 'ud', should: 'ud', book: 'uk', look: 'uk', took: 'uk', cook: 'uk', world: 'erld', word: 'erd', work: 'erk',
  head: 'ed', bread: 'ed', dead: 'ed', read: 'iid', instead: 'ed', thread: 'ed', spread: 'ed', ahead: 'ed', breakfast: 'ekfast',
  key: 'ii', people: 'iipel', hour: 'auer', our: 'auer', flower: 'auer', power: 'auer', shower: 'auer', tower: 'auer',
  sew: 'ou', though: 'ou', although: 'ou', dough: 'ou', tough: 'uf', enough: 'uf', rough: 'uf', cough: 'of',
  bough: 'au', plough: 'au', sky: 'ai', fly: 'ai', my: 'ai', by: 'ai', why: 'ai', cry: 'ai', try: 'ai', dry: 'ai', shy: 'ai', high: 'ai', sigh: 'ai',
  la: 'aa', ha: 'aa', ma: 'aa', pa: 'aa', spa: 'aa',
};

const OW_AU = new Set('now how cow wow bow vow down town brown crown clown frown gown owl howl allow'.split(' '));

function tailConsonants(s) {
  return s.replace(/ck$/, 'k').replace(/c$/, 'k').replace(/ph/g, 'f').replace(/mb$/, 'm').replace(/x/g, 'ks').replace(/([^aeiou])\1$/, '$1');
}

export function rhymeKey(word) {
  let w = normWord(word).replace(/[^a-z']/g, '').replace(/'s$/, 's');
  if (!w) return '';
  if (EXCEPT[w]) return EXCEPT[w];
  w = w.replace(/'/g, '');
  const rules = [
    [/igh(t?)$/, (m) => `ai${m[1]}`],
    [/([^aeiou])y$/, (m, s) => (/[aeiou]/.test(s.slice(0, -1)) ? 'ii' : 'ai')],
    [/(ie)$/, () => 'ai'],
    [/^[^aeiou]+e$/, () => 'ii'],
    [/(ore|oor|oar|our)$/, () => 'or'],
    [/(are)$/, () => 'ea'],
    [/(ire)$/, () => 'aia'],
    [/([aeiou])([^aeiouwy]{1,2})e$/, (m) => ({ a: 'ei', e: 'ii', i: 'ai', o: 'ou', u: 'uu' }[m[1]] || m[1]) + tailConsonants(m[2])],
    [/(ee|ea)([^aeiou]*)$/, (m) => (m[2] === 'r' ? 'ia' : `ii${tailConsonants(m[2])}`)],
    [/(ay|ey|ai|eigh)([^aeiou]*)$/, (m) => `ei${tailConsonants(m[2])}`],
    [/(oo)([^aeiou]*)$/, (m) => `uu${tailConsonants(m[2])}`],
    [/(ew|ue)$/, () => 'uu'],
    [/(ow)([^aeiou]*)$/, (m, s) => {
      if (OW_AU.has(s)) return `au${m[2]}`;
      if (/own$/.test(s) && !/^(grown|blown|shown|thrown|known|flown|sown|own)$/.test(s)) return `au${m[2]}`;
      return `ou${m[2]}`;
    }],
    [/(ou)([^aeiou]*)$/, (m) => `au${tailConsonants(m[2])}`],
    [/(oa)([^aeiou]*)$/, (m) => `ou${tailConsonants(m[2])}`],
    [/(ar)([^aeiou]*)$/, (m) => `ar${m[2]}`],
    [/(or|oar|oor|our)([^aeiou]*)$/, (m) => `or${m[2]}`],
    [/(er|ir|ur)([^aeiou]*)$/, (m) => `er${m[2]}`],
    [/(eer|ear)$/, () => 'ia'],
    [/(all)$/, () => 'ol'],
    [/(aw|au)([^aeiou]*)$/, (m) => `o${m[2]}`],
    [/o$/, () => 'ou'],
    [/([aeiou]+)([^aeiou]*)$/, (m) => m[1] + tailConsonants(m[2])],
  ];
  for (const [re, fn] of rules) {
    const m = re.exec(w);
    if (m) return fn(m, w);
  }
  return w;
}

export function rhymes(a, b) {
  const x = normWord(a);
  const y = normWord(b);
  if (!x || !y || x === y) return false;
  const fam = rhymeFamily(x);
  if (fam && fam.includes(y)) return true;
  const kx = rhymeKey(x);
  return kx.length > 0 && kx === rhymeKey(y);
}

// Pairs of rhyming line endings in a song: [{ a, b, lines: [i, j] }]
export function rhymePairs(timeline) {
  const ends = [];
  for (const l of timeline.lines) {
    if (l.instrumental || !l.words.length) continue;
    const last = normWord(l.words[l.words.length - 1].text);
    if (last) ends.push({ word: last, line: l.index });
  }
  const pairs = [];
  const seen = new Set();
  for (let i = 0; i < ends.length; i += 1) {
    for (let j = i + 1; j < Math.min(ends.length, i + 4); j += 1) {
      const a = ends[i].word;
      const b = ends[j].word;
      if (!rhymes(a, b)) continue;
      const key = [a, b].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ a, b, lines: [ends[i].line, ends[j].line] });
    }
  }
  return pairs;
}

// Words that rhyme with `word`, from a pool (song words) and the families.
export function rhymesFrom(word, pool = []) {
  const out = new Set();
  const fam = rhymeFamily(normWord(word));
  if (fam) for (const w of fam) if (w !== normWord(word)) out.add(w);
  for (const p of pool) if (rhymes(word, p)) out.add(normWord(p));
  return [...out];
}
