import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openItem, markItem, chooseTeam, stepTeam, nextTurn, rulesOf, POINTS } from '../js/games/turns.js';

const TURNS = rulesOf({});
const NO_STEAL = rulesOf({ rules: { steal: false } });
const FIRST = rulesOf({ rules: { mode: 'first' } });

test('rules default to turns with one steal and no time limit; nonsense falls back', () => {
  assert.deepEqual(rulesOf(undefined), { mode: 'turns', steal: true, think: 0 });
  assert.deepEqual(rulesOf({ rules: { mode: 'chaos', steal: 0, think: 7 } }), { mode: 'turns', steal: true, think: 0 });
  assert.deepEqual(rulesOf({ rules: { mode: 'first', steal: false, think: 10 } }), { mode: 'first', steal: false, think: 10 });
});

test('right on your own turn: 2 points, then the next team', () => {
  const item = openItem({ teams: 3, turn: 1, rules: TURNS });
  assert.equal(item.answering, 1);
  const r = markItem(item, 'right', TURNS);
  assert.equal(r.outcome, 'right');
  assert.deepEqual(r.award, { team: 1, points: POINTS.own });
  assert.equal(POINTS.own, 2);
  assert.equal(r.item.done, true);
  assert.equal(nextTurn(r.item, 1), 2);
});

test('wrong: the next team steals for 1, and the turn order does not jump', () => {
  let r = markItem(openItem({ teams: 3, turn: 2, rules: TURNS }), 'wrong', TURNS);
  assert.equal(r.outcome, 'steal');
  assert.equal(r.award, null);
  assert.equal(r.item.answering, 0, 'the steal wraps round to the first team');
  r = markItem(r.item, 'right', TURNS);
  assert.equal(r.outcome, 'stolen');
  assert.deepEqual(r.award, { team: 0, points: POINTS.steal });
  assert.equal(POINTS.steal, 1);
  assert.equal(nextTurn(r.item, 2), 0, 'the team after the owner (2), not after the stealer');
  const again = markItem(r.item, 'right', TURNS);
  assert.equal(again.outcome, 'none', 'a finished item takes no more marks');
});

test('a failed steal shows the answer; only one steal per item', () => {
  let r = markItem(openItem({ teams: 4, turn: 0, rules: TURNS }), 'wrong', TURNS);
  r = markItem(r.item, 'wrong', TURNS);
  assert.equal(r.outcome, 'reveal');
  assert.equal(r.award, null);
  assert.equal(nextTurn(r.item, 0), 1);
});

test('pass and time up lose the turn like a wrong answer; the steal still happens', () => {
  for (const result of ['pass', 'timeout']) {
    let r = markItem(openItem({ teams: 2, turn: 0, rules: TURNS }), result, TURNS);
    assert.equal(r.outcome, 'steal', result);
    assert.equal(r.item.answering, 1);
    r = markItem(r.item, 'pass', TURNS);
    assert.equal(r.outcome, 'reveal', `a pass on the steal shows the answer (${result})`);
  }
});

test('no steals, or a single team: a miss goes straight to the answer', () => {
  assert.equal(markItem(openItem({ teams: 3, turn: 0, rules: NO_STEAL }), 'wrong', NO_STEAL).outcome, 'reveal');
  const solo = openItem({ teams: 1, turn: 5, rules: TURNS });
  assert.equal(solo.owner, 0);
  assert.equal(markItem(solo, 'wrong', TURNS).outcome, 'reveal');
});

test('reveal ends the item at once with no points', () => {
  const r = markItem(openItem({ teams: 3, turn: 0, rules: TURNS }), 'reveal', TURNS);
  assert.equal(r.outcome, 'reveal');
  assert.equal(r.award, null);
  assert.equal(nextTurn(r.item, 0), 1, 'the turn is still used up');
});

test('changing who answers: on a turn the order follows the new team; a steal skips the team that tried', () => {
  let item = openItem({ teams: 3, turn: 0, rules: TURNS });
  item = stepTeam(item, 1);
  assert.equal(item.owner, 1);
  assert.equal(item.answering, 1);
  item = stepTeam(item, -1);
  item = stepTeam(item, -1);
  assert.equal(item.owner, 2, '↑ from the first team wraps to the last');
  let r = markItem(item, 'wrong', TURNS);
  assert.equal(r.item.answering, 0);
  const moved = stepTeam(r.item, 1);
  assert.equal(moved.answering, 1);
  assert.equal(moved.owner, 2, 'choosing the stealer keeps the owner');
  assert.equal(stepTeam(moved, 1).answering, 0, 'the owner (2) is skipped');
  assert.equal(chooseTeam(moved, 2).answering, 1, 'the owner cannot steal its own item');
  r = markItem(moved, 'right', TURNS);
  assert.deepEqual(r.award, { team: 1, points: 1 });
  assert.equal(nextTurn(r.item, 0), 0, 'after team 2 comes team 0');
});

test('first hand up: pick a team, wrong teams are out, 1 point for the right one', () => {
  let item = openItem({ teams: 3, turn: 2, rules: FIRST });
  assert.equal(item.answering, null);
  assert.equal(markItem(item, 'right', FIRST).outcome, 'none', 'nobody picked yet');
  item = chooseTeam(item, 1);
  let r = markItem(item, 'wrong', FIRST);
  assert.equal(r.outcome, 'open');
  assert.equal(r.item.answering, null);
  assert.equal(chooseTeam(r.item, 1).answering, null, 'a team that missed is out for this item');
  assert.equal(stepTeam(r.item, 1).answering, 0, '↓ with nobody picked starts at the first team');
  assert.equal(stepTeam(stepTeam(r.item, 1), 1).answering, 2, 'and skips the team that missed');
  r = markItem(chooseTeam(r.item, 0), 'right', FIRST);
  assert.deepEqual(r.award, { team: 0, points: POINTS.first });
  assert.equal(nextTurn(r.item, 2), 2, 'first hand up leaves the turn order alone');
});

test('first hand up: when every team has missed, or time is up, the answer is shown', () => {
  let r = { item: openItem({ teams: 2, turn: 0, rules: FIRST }) };
  r = markItem(chooseTeam(r.item, 0), 'wrong', FIRST);
  r = markItem(chooseTeam(r.item, 1), 'pass', FIRST);
  assert.equal(r.outcome, 'reveal');
  assert.equal(markItem(openItem({ teams: 2, turn: 0, rules: FIRST }), 'timeout', FIRST).outcome, 'reveal');
});
