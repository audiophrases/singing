/*
 * Team turns: who answers, steals, passes and points. Pure rules (no DOM, no
 * storage) so they can be tested; js/views/turnbar.js shows them on the stage
 * and keeps the score. Teams are numbered 0..n-1 in their stage order.
 *
 *   let item = openItem({ teams: 3, turn: 1, rules });       // team 1's turn
 *   ({ item, outcome, award } = markItem(item, 'wrong', rules)); // 'steal': team 2's go
 *   ({ item, outcome, award } = markItem(item, 'right', rules)); // 'stolen', team 2 +1
 *   nextTurn(item, 1);                                         // 2: the team after team 1
 *
 * Results the teacher enters: 'right', 'wrong', 'pass' (don't know: the turn
 * is lost quietly), 'timeout' (thinking time ran out) and 'reveal' (show the
 * answer now, nobody scores).
 *
 * Outcomes: 'right' (scored first time), 'stolen' (scored on the steal),
 * 'steal' (the next team may try), 'open' (first hand up: the other teams may
 * try), 'reveal' (nobody scored), 'none' (ignored: first hand up needs a team).
 */

export const POINTS = { own: 2, steal: 1, first: 1 };
export const THINK_TIMES = [0, 5, 10, 15, 30];
export const DEFAULT_RULES = { mode: 'turns', steal: true, think: 0 };

export function rulesOf(teams) {
  const r = { ...DEFAULT_RULES, ...(teams?.rules || {}) };
  return {
    mode: r.mode === 'first' ? 'first' : 'turns',
    steal: r.steal !== false,
    think: THINK_TIMES.includes(Number(r.think)) ? Number(r.think) : 0,
  };
}

const wrap = (i, n) => ((i % n) + n) % n;

export function openItem({ teams, turn = 0, rules }) {
  const n = Math.max(1, Math.floor(teams) || 1);
  if (rules.mode === 'first') return { mode: 'first', n, owner: null, answering: null, phase: 'open', tried: [], done: false, outcome: null };
  const owner = wrap(Number(turn) || 0, n);
  return { mode: 'turns', n, owner, answering: owner, phase: 'turn', tried: [], done: false, outcome: null };
}

export function markItem(item, result, rules) {
  if (!item || item.done) return { item, outcome: 'none', award: null };
  const it = { ...item, tried: [...item.tried] };
  const finish = (outcome, award = null) => ({ item: { ...it, phase: 'done', done: true, outcome }, outcome, award });
  if (result === 'reveal') return finish('reveal');

  if (it.mode === 'first') {
    if (result === 'timeout') return finish('reveal');
    if (it.answering === null) return { item, outcome: 'none', award: null };
    if (result === 'right') return finish('right', { team: it.answering, points: POINTS.first });
    it.tried.push(it.answering);
    it.answering = null;
    if (it.tried.length >= it.n) return finish('reveal');
    return { item: it, outcome: 'open', award: null };
  }

  if (result === 'right') {
    return it.phase === 'steal'
      ? finish('stolen', { team: it.answering, points: POINTS.steal })
      : finish('right', { team: it.answering, points: POINTS.own });
  }
  // Wrong, pass or time's up: one steal by the next team, then the answer.
  if (it.phase === 'turn' && rules.steal && it.n > 1) {
    it.tried.push(it.owner);
    it.phase = 'steal';
    it.answering = wrap(it.owner + 1, it.n);
    return { item: it, outcome: 'steal', award: null };
  }
  return finish('reveal');
}

/*
 * The teacher says who answers: on a team's own turn that team takes the turn
 * (the order carries on after it); on a steal or a first hand up it is the team
 * trying now. Teams that already tried this item can't be chosen.
 */
export function chooseTeam(item, team) {
  if (!item || item.done) return item;
  const t = wrap(Number(team) || 0, item.n);
  if (item.tried.includes(t)) return item;
  if (item.mode === 'turns' && item.phase === 'turn') return { ...item, owner: t, answering: t };
  return { ...item, answering: t };
}

// ↑/↓: the previous / next team that may still answer.
export function stepTeam(item, dir) {
  if (!item || item.done) return item;
  let t = item.answering ?? (dir > 0 ? -1 : item.n);
  for (let k = 0; k < item.n; k += 1) {
    t = wrap(t + dir, item.n);
    if (t !== item.answering && !item.tried.includes(t)) return chooseTeam(item, t);
  }
  return item;
}

// Whose turn comes next: the team after the one whose turn it was, whoever
// stole. First hand up has no order, so the turn stays where it was.
export function nextTurn(item, turn) {
  return item?.mode === 'turns' && item.owner !== null ? wrap(item.owner + 1, item.n) : turn;
}
