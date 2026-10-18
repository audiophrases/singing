/*
 * How English words sound, for the robot singer.
 *   phonemes('night') -> 'nYt'
 *   syllablePhones('twinkle,', ['Twin', 'kle,']) -> [{ on: 'tw', nu: 'I', co: 'N' }, { on: 'k', nu: '^', co: 'l' }]
 * Words come from a CMUdict subset (phonedict.js); others are guessed from
 * inflections (plays, played, playing...) and then spelling rules.
 * One character per phone, ARPAbet without stress:
 */
import { PHONE_DICT } from './phonedict.js';

export const ARPA = {
  AA: 'a', AE: '@', AH: '^', AO: 'c', AW: 'W', AY: 'Y', EH: 'E', ER: 'R', EY: 'e', IH: 'I', IY: 'i', OW: 'o', OY: 'O', UH: 'U', UW: 'u',
  B: 'b', CH: 'C', D: 'd', DH: 'D', F: 'f', G: 'g', HH: 'h', JH: 'J', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'N', P: 'p',
  R: 'r', S: 's', SH: 'S', T: 't', TH: 'T', V: 'v', W: 'w', Y: 'y', Z: 'z', ZH: 'Z',
};

const VOWEL_PHONES = new Set('a@^cWYEReIioOUu');
export const isVowelPhone = (p) => VOWEL_PHONES.has(p);

let dict = null;
function lookup(w) {
  if (!dict) {
    dict = new Map();
    for (const line of PHONE_DICT.split('\n')) {
      const sp = line.indexOf(' ');
      if (sp > 0) dict.set(line.slice(0, sp), line.slice(sp + 1));
    }
  }
  return dict.get(w);
}

export function cleanWord(text) {
  return String(text || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z']/g, '').replace(/^'+|'+$/g, '');
}

const VOICELESS = new Set('ptkfTsSC');

// Inflected forms of a dictionary word: plays, played, playing, happier...
function inflected(w) {
  const tryStems = (stems, add) => {
    for (const s of stems) {
      const p = s.length > 1 && lookup(s);
      if (p) return add(p);
    }
    return null;
  };
  const undouble = (s) => (/([bdgklmnprtz])\1$/.test(s) ? s.slice(0, -1) : null);
  let m;
  if ((m = /^(.+)'s$/.exec(w)) || (m = /^(.+[^s'])s$/.exec(w))) {
    const r = tryStems([m[1]], (p) => p + (/[szSZCJ]$/.test(p) ? 'Iz' : VOICELESS.has(p.at(-1)) ? 's' : 'z'));
    if (r) return r;
  }
  if ((m = /^(.+)ies$/.exec(w))) {
    const r = tryStems([`${m[1]}y`], (p) => `${p}z`);
    if (r) return r;
  }
  if ((m = /^(.+(?:s|x|z|ch|sh))es$/.exec(w))) {
    const r = tryStems([m[1]], (p) => `${p}Iz`);
    if (r) return r;
  }
  if ((m = /^(.+)ied$/.exec(w))) {
    const r = tryStems([`${m[1]}y`], (p) => `${p}d`);
    if (r) return r;
  }
  if ((m = /^(.+)ed$/.exec(w))) {
    const r = tryStems([m[1], `${m[1]}e`, undouble(m[1])].filter(Boolean),
      (p) => p + (/[td]$/.test(p) ? 'Id' : VOICELESS.has(p.at(-1)) ? 't' : 'd'));
    if (r) return r;
  }
  if ((m = /^(.+)ing$/.exec(w))) {
    const r = tryStems([m[1], `${m[1]}e`, undouble(m[1])].filter(Boolean), (p) => `${p}IN`);
    if (r) return r;
  }
  const suffixes = [['ly', 'li'], ['ness', 'n^s'], ['ful', 'f^l'], ['less', 'l^s'], ['est', 'Ist'], ['er', 'R'], ['y', 'i']];
  for (const [suf, add] of suffixes) {
    if (!w.endsWith(suf) || w.length < suf.length + 3) continue;
    const base = w.slice(0, -suf.length);
    const r = tryStems([base, `${base}e`, base.replace(/i$/, 'y'), undouble(base)].filter(Boolean), (p) => p + add);
    if (r) return r;
  }
  return null;
}

/*
 * Spelling -> sound, for words the dictionary doesn't know. Tried in order at
 * each letter of "#word#"; the first rule that matches wins.
 */
const C = '[bcdfghjklmnpqrstvwxz]';
const LTS = [
  ['tch', 'C'], ['dge', 'J'], ['tion', 'S^n'], ['sion', 'Z^n'], ['cian', 'S^n'], ['ture', 'CR'], ['cious|tious', 'S^s'],
  ['ough(?=t)', 'c'], ['ough', 'o'], ['augh', 'c'], ['eigh', 'e'], ['igh', 'Y'],
  ['(?<=#)kn', 'n'], ['(?<=#)wr', 'r'], ['(?<=#)gn', 'n'], ['(?<=#)ps', 's'], ['mb(?=#)', 'm'],
  ['ch', 'C'], ['sh', 'S'], ['ph', 'f'], ['th', 'T'], ['wh', 'w'], ['ck', 'k'], ['qu', 'kw'],
  ['ng(?=#|[^aeiouy])', 'N'], ['n(?=k)', 'N'], ['gh(?=#)', ''], ['gh', 'g'], ['x', 'ks'],
  ['air|are(?=#)', 'Er'], ['eer', 'ir'], ['ear(?=#)', 'ir'], ['ire(?=#)', 'YR'], ['ore(?=#)', 'cr'], ['oor', 'cr'], ['our', 'Wr'],
  ['ar(?![aeiouyr])', 'ar'], ['or(?![aeiouyr])', 'cr'], ['[eiuy]r(?![aeiouyr])', 'R'], ['ear(?![aeiouyr])', 'R'],
  ['ai|ay', 'e'], ['ee', 'i'], ['ea', 'i'], ['ie(?=#)', 'Y'], ['ie', 'i'], ['ei', 'e'], ['ey(?=#)', 'i'], ['oa', 'o'],
  ['oo(?=k)', 'U'], ['oo', 'u'], ['ou', 'W'], ['ow(?=#)', 'o'], ['ow', 'W'], ['oi|oy', 'O'], ['au|aw', 'c'], ['ew', 'u'], ['ue', 'u'], ['ui', 'u'],
  // A vowel, one consonant and a silent e: "make", "these", "time", "home", "tune".
  [`a(?=${C}e(?:#|s#|d#|ly#|ful#))`, 'e'], [`e(?=${C}e(?:#|s#|d#))`, 'i'], [`[iy](?=${C}e(?:#|s#|d#|ly#|ful#))`, 'Y'],
  [`o(?=${C}e(?:#|s#|d#|ly#|ful#))`, 'o'], [`u(?=${C}e(?:#|s#|d#|ly#|ful#))`, 'u'],
  [`(?<=${C})le(?=s?#)`, '^l'], ['(?<=[td])ed(?=#)', 'Id'], ['(?<=[sxz]|[cs]h)es(?=#)', 'Iz'], ['(?<=[a-z][a-z])e(?=s?#|d#)', ''], ['o(?=#)', 'o'], ['a(?=#)', '^'], ['i(?=#)', 'i'],
  ['c(?=[eiy])', 's'], ['c', 'k'], ['g(?=[eiy])', 'J'], ['(?<=[aeiouy])s(?=[aeiouy])', 'z'], ['(?<=#)y', 'y'], ['y(?=[aeiou])', 'y'], ['j', 'J'], ['g', 'g'], ['q', 'k'],
  ['a', '@'], ['e', 'E'], ['i', 'I'], ['o', 'a'], ['u', '^'], ['y', 'I'],
].map(([re, out]) => [new RegExp(re, 'y'), out]);

function spell(w) {
  const s = `#${w.replace(/'/g, '')}#`;
  let out = '';
  let i = 1;
  while (i < s.length - 1) {
    // Doubled consonants sound once.
    if (s[i] === s[i - 1] && /[bdfgklmnprstvz]/.test(s[i])) { i += 1; continue; }
    let hit = false;
    for (const [re, ph] of LTS) {
      re.lastIndex = i;
      const m = re.exec(s);
      if (m && m[0].length) {
        out += ph;
        i += m[0].length;
        hit = true;
        break;
      }
    }
    if (!hit) {
      const c = s[i];
      if (/[bdfhklmnprstvwz]/.test(c)) out += c;
      i += 1;
    }
  }
  // Final y: "my", "fly" rhyme with "eye"; "happy", "baby" end in "ee".
  if (/[^aeiou]y$/.test(w)) out = out.replace(/I$/, [...out.slice(0, -1)].some(isVowelPhone) ? 'i' : 'Y');
  // Final s after a voiced sound is a z.
  if (/[^s]s$/.test(w) && out.length > 1 && !VOICELESS.has(out.at(-2))) out = out.replace(/s$/, 'z');
  return out;
}

const cache = new Map();
export function phonemes(word) {
  const w = cleanWord(word);
  if (!w) return '';
  if (cache.has(w)) return cache.get(w);
  const p = lookup(w) || inflected(w) || spell(w);
  cache.set(w, p);
  return p;
}

// Consonant clusters that can start an English syllable (in phone codes).
const ONSETS = new Set(['pl', 'bl', 'kl', 'gl', 'pr', 'br', 'tr', 'dr', 'kr', 'gr', 'fr', 'Tr', 'Sr', 'fl', 'sl', 'sp', 'st', 'sk', 'sm', 'sn', 'sw', 'tw', 'dw', 'kw', 'gw', 'Tw',
  'py', 'by', 'ky', 'gy', 'my', 'fy', 'hy', 'vy', 'ny', 'spl', 'spr', 'str', 'skr', 'skw', 'spy', 'sky']);
const legalOnset = (c) => (c.length === 1 ? c !== 'N' : ONSETS.has(c));

function splitOne(p) {
  const idx = [...p].map((ch, i) => (isVowelPhone(ch) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return { on: '', nu: p || '^', co: '' };
  return { on: p.slice(0, idx[0]), nu: p.slice(idx[0], idx.at(-1) + 1), co: p.slice(idx.at(-1) + 1) };
}

/*
 * A word's phones shared out over the syllables the song wrote for it, so
 * "Twin-kle" sings "twing" + "kle". Between two vowels a consonant goes to
 * the next syllable unless the writing keeps it ("an-i-mal", "yes-ter-day").
 */
export function syllablePhones(wordText, parts) {
  const n = parts.length;
  const written = parts.map(cleanWord);
  const p = phonemes(wordText);
  if (n <= 1) return [splitOne(p)];
  // Vowel groups: [start, end] of each nucleus.
  let groups = [];
  for (let i = 0; i < p.length; i += 1) if (isVowelPhone(p[i])) groups.push([i, i]);
  if (groups.length < n || written.some((s) => !s)) {
    return parts.map((s) => splitOne(phonemes(s)));
  }
  // More vowels than written syllables ("fi-re" written "fire"): merge the
  // closest neighbours.
  while (groups.length > n) {
    let best = 0;
    for (let i = 1; i < groups.length - 1; i += 1) {
      if (groups[i + 1][0] - groups[i][1] <= groups[best + 1][0] - groups[best][1]) best = i;
    }
    groups.splice(best, 2, [groups[best][0], groups[best + 1][1]]);
  }
  const cut = [0];
  for (let k = 0; k < n - 1; k += 1) {
    const a = groups[k][1] + 1;
    const b = groups[k + 1][0];
    const cluster = p.slice(a, b);
    const s = written[k];
    const endsCons = /[^aeiouy']$/.test(s) || (/[^aeiouy]e$/.test(s) && s.length > 2);
    const nextVowel = /^[aeiou]/.test(written[k + 1]);
    let coda = 0;
    if (endsCons && nextVowel) coda = cluster.length;
    else if (endsCons && cluster.length >= 2) {
      let on = cluster.length;
      while (on > 0 && !legalOnset(cluster.slice(cluster.length - on))) on -= 1;
      coda = Math.max(1, cluster.length - on);
    }
    cut.push(a + coda);
  }
  cut.push(p.length);
  return groups.map(([gs, ge], k) => ({
    on: p.slice(cut[k], gs),
    nu: p.slice(gs, ge + 1),
    co: p.slice(ge + 1, cut[k + 1]),
  }));
}
