import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normWord, tokenize, checkAnswer, hintFor } from '../js/lyrics/text.js';
import { CATEGORIES, categoryById, baseForm, pastOf, categoriesInTimeline } from '../js/lyrics/grammar.js';
import { rhymes, rhymePairs } from '../js/lyrics/rhymes.js';
import { pickGaps, distractors } from '../js/lyrics/gaps.js';
import { compileSong } from '../js/music/score.js';
import { timelineFromCompiled } from '../js/music/timeline.js';
import { BUILTIN_SONGS } from '../js/data/songs/index.js';

const tl = (id) => {
  const s = BUILTIN_SONGS.find((x) => x.id === id);
  return timelineFromCompiled(compileSong(s), s.bpm);
};

test('normalising and tokenizing', () => {
  assert.equal(normWord('“Hello,”'), 'hello');
  assert.equal(normWord('Don’t'), "don't");
  const t = tokenize('Oh, what fun!');
  assert.deepEqual(t.map((x) => x.norm), ['oh', 'what', 'fun']);
  assert.equal(t[0].trail, ',');
});

test('answers: right, close, wrong', () => {
  assert.equal(checkAnswer('Wonder', 'wonder'), 'right');
  assert.equal(checkAnswer('wonderr', 'wonder'), 'close');
  assert.equal(checkAnswer('dont', "don't"), 'right');
  assert.equal(checkAnswer('two', '2'), 'right');
  assert.equal(checkAnswer('cat', 'hat'), 'wrong');
  assert.equal(checkAnswer('', 'hat'), 'wrong');
  assert.equal(hintFor('star'), 's___');
});

test('grammar categories', () => {
  const past = categoryById('past');
  for (const w of ['went', 'played', 'broke', 'followed']) assert.ok(past.test(w), w);
  for (const w of ['red', 'bed', 'go', 'need']) assert.ok(!past.test(w), w);
  assert.ok(categoryById('ing').test('falling'));
  assert.ok(!categoryById('ing').test('morning'));
  assert.ok(categoryById('comparative').test('bigger'));
  assert.ok(categoryById('plural').test('bells'));
  assert.equal(baseForm('went'), 'go');
  assert.equal(baseForm('dancing'), 'dance');
  assert.equal(pastOf('stop'), 'stopped');
  assert.ok(CATEGORIES.length > 20);
  const cats = categoriesInTimeline(tl('what-did-you-do')).map((c) => c.id);
  assert.ok(cats.includes('past'), cats.join());
});

test('rhymes', () => {
  assert.ok(rhymes('star', 'are'));
  assert.ok(rhymes('night', 'light'));
  assert.ok(!rhymes('star', 'stream'));
  const pairs = rhymePairs(tl('twinkle'));
  assert.ok(pairs.some((p) => [p.a, p.b].sort().join() === 'are,star'), JSON.stringify(pairs));
  assert.ok(pairs.some((p) => [p.a, p.b].sort().join() === 'high,sky'));
});

test('gap picking by level and category', () => {
  const t = tl('twinkle');
  const easy = pickGaps(t, { mode: 'easy', seed: 3 });
  for (const set of easy.values()) assert.equal(set.size, 1);
  assert.equal(easy.size, t.lines.length);
  const all = pickGaps(t, { mode: 'all' });
  assert.equal([...all.values()].reduce((a, s) => a + s.size, 0), t.lines.reduce((a, l) => a + l.words.length, 0));
  const past = pickGaps(tl('what-did-you-do'), { mode: 'cat:past' });
  assert.ok(past.size >= 6);
  // Same seed, same gaps.
  const again = pickGaps(t, { mode: 'easy', seed: 3 });
  assert.deepEqual([...again.entries()].map(([k, v]) => [k, [...v]]), [...easy.entries()].map(([k, v]) => [k, [...v]]));
});

test('distractors are plausible and never the answer', () => {
  const d1 = distractors('went', { count: 2 });
  assert.deepEqual(d1, ['go', 'goed']);
  const d2 = distractors('Star', { count: 2, kind: 'listen' });
  assert.equal(d2.length, 2);
  assert.ok(d2.every((d) => d.toLowerCase() !== 'star' && /^[A-Z]/.test(d)), d2.join());
  const d3 = distractors('he', { count: 3 });
  assert.ok(d3.every((d) => ['i', 'you', 'she', 'it', 'we', 'they'].includes(d)), d3.join());
  const d4 = distractors('sleeping', { count: 3 });
  assert.ok(d4.includes('sleep'), d4.join());
});
