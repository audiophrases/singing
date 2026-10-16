/*
 * Lyrics bingo: cards are made from a word list and a card number (the
 * seed), so a phone, a printout and the teacher's screen always agree on
 * what card 27 looks like - no server needed.
 */
import { normWord } from './text.js';
import { STOPWORDS } from './wordlists.js';
import { seeded, shuffle } from '../ui.js';

export function bingoWords(timeline, max = 40) {
  const out = [];
  const seen = new Set();
  for (const l of timeline.lines) {
    for (const w of l.words) {
      const n = normWord(w.text);
      if (!n || n.length < 3 || STOPWORDS.has(n) || seen.has(n) || /^\d+$/.test(n)) continue;
      seen.add(n);
      out.push(n);
      if (out.length >= max) return out;
    }
  }
  return out;
}

// When each word is first sung (seconds) - that is when it is "called".
export function callTimes(timeline, words) {
  const set = new Set(words);
  const times = new Map();
  for (const l of timeline.lines) {
    for (const w of l.words) {
      const n = normWord(w.text);
      if (set.has(n) && !times.has(n)) times.set(n, w.end);
    }
  }
  return times;
}

export function cardSize(words, wanted) {
  for (const s of [wanted, 4, 3]) {
    const need = s * s - (s === 5 ? 1 : 0);
    if (words.length >= need) return s;
  }
  return 0;
}

export function makeCard(words, seed, size) {
  const rnd = seeded(Number(seed) * 7919 + size);
  const need = size * size - (size === 5 ? 1 : 0);
  const picked = shuffle(words, rnd).slice(0, need);
  const grid = [];
  let k = 0;
  for (let i = 0; i < size * size; i += 1) {
    if (size === 5 && i === 12) grid.push(null); // free space
    else grid.push(picked[k++]);
  }
  return grid;
}

export function checkCard(grid, called) {
  const size = Math.round(Math.sqrt(grid.length));
  const hit = grid.map((w) => w === null || called.has(w));
  const lines = [];
  for (let r = 0; r < size; r += 1) lines.push([...Array(size)].map((_, c) => r * size + c));
  for (let c = 0; c < size; c += 1) lines.push([...Array(size)].map((_, r) => r * size + c));
  lines.push([...Array(size)].map((_, i) => i * size + i));
  lines.push([...Array(size)].map((_, i) => i * size + (size - 1 - i)));
  const done = lines.filter((ln) => ln.every((i) => hit[i]));
  return { hit, lines: done, full: hit.every(Boolean) };
}

function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeWords(words) {
  return b64url(words.join('|'));
}

export function decodeWords(s) {
  try {
    return unb64url(s).split('|').map((w) => w.trim()).filter(Boolean).slice(0, 80);
  } catch {
    return [];
  }
}
