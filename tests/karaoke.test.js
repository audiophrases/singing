import test from 'node:test';
import assert from 'node:assert/strict';
import { ballHop, BALL_LEAD } from '../js/games/karaoke.js';

const syllables = [{ start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 4 }];

test('the ball moves toward the next syllable before it is sung and has landed by its onset', () => {
  const cue = ballHop(syllables, 1.8);
  assert.equal(cue.from, 0); assert.equal(cue.to, 1);
  assert(cue.progress > 0 && cue.progress < 1);
  for (const t of [2 - BALL_LEAD + 0.001, 2, 2.1]) {
    assert.deepEqual(ballHop(syllables, t), { from: 1, to: 1, progress: 1 });
  }
});

test('first syllables get a preparation bounce and instrumental rests have no stale ball', () => {
  assert.equal(ballHop(syllables, 0), null);
  const first = ballHop(syllables, 0.8);
  assert.equal(first.from, 0); assert.equal(first.to, 0);
  assert(first.progress > 0 && first.progress < 1);
  assert.equal(ballHop(syllables, 4.1), null);
  assert.equal(ballHop([], 1), null);
  const withRest = [{ start: 1, end: 1.4 }, { start: 4, end: 5 }];
  assert.equal(ballHop(withRest, 2), null);
  const afterRest = ballHop(withRest, 3.8);
  assert.equal(afterRest.from, 1); assert.equal(afterRest.to, 1);
});

test('ball anticipation takes the same real time at slow and fast playback rates', () => {
  const normal = ballHop(syllables, 2 - BALL_LEAD - 0.11);
  for (const rate of [0.5, 1.5]) {
    const cue = ballHop(syllables, 2 - (BALL_LEAD + 0.11) * rate, rate);
    assert.equal(cue.to, 1);
    assert(Math.abs(cue.progress - normal.progress) < 1e-9);
    assert.equal(ballHop(syllables, 2, rate).to, 1);
  }
});

test('a larger live lead cues the ball earlier and a negative lead later', () => {
  // At t=1.8 the default lead has not landed on syllable 1 yet.
  assert(ballHop(syllables, 1.8, 1, BALL_LEAD).progress < 1);
  // A 300 ms lead has already landed on it; a -100 ms lead is still holding syllable 0.
  assert.deepEqual(ballHop(syllables, 1.8, 1, 0.3), { from: 1, to: 1, progress: 1 });
  assert.deepEqual(ballHop(syllables, 1.8, 1, -0.1), { from: 0, to: 0, progress: 1 });
});

test('seeking backwards and tightly spaced syllables do not reuse a previous hop position', () => {
  ballHop(syllables, 3.5);
  assert.equal(ballHop(syllables, 0.95).to, 0);
  const fast = [{ start: 1, end: 1.1 }, { start: 1.1, end: 1.2 }, { start: 1.2, end: 1.3 }];
  const cue = ballHop(fast, 1);
  assert.equal(cue.to, 1);
  assert(cue.progress >= 0 && cue.progress <= 1);
});
