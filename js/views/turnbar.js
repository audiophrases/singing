/*
 * The turn banner on the stage: whose turn it is, the thinking time and the
 * teacher's buttons. Students answer aloud; the teacher enters what they said.
 * The rules are in js/games/turns.js; this keeps the score and shows it.
 *
 * Games that take turns get it as ctx.turns (stage.js):
 *
 *   const T = ctx.turns?.active ? ctx.turns : null;   // once, when play starts
 *   T.idle()                         between items: "Next: 🐼 Pop Pandas"
 *   T.open({ judge, onOutcome })     an item is open: a team must answer
 *                                    judge: the teacher marks ✓/✗ (Y/N) instead
 *                                    of clicking the option the team said
 *       prompt: 'Click the word they say'    what the teacher does (the hint)
 *       mode: 'turns', steal: false, keep: true   this game's own rules
 *                                    (js/games/turns.js; Rhyme memory)
 *       flash(info) -> text|null     the game's own words after an item
 *   T.suggest('right'|'wrong')       a guess (Say it!'s mic): the button
 *                                    lights up, Enter accepts it, Y / N decide
 *   T.ready() / T.nudge()            first hand up: has a team been picked?
 *   T.mark('right'|'wrong'|'pass'|'reveal', meta)
 *   onOutcome({ outcome, result, done, team, points, meta })
 *
 * Keys while an item is open: Y right, N wrong, P pass (first hand up:
 * nobody), S show the answer (show: false - Rhyme memory has none), ↑/↓ who
 * is answering, Enter accept a suggestion.
 *
 * A game that starts in teams keeps them until it ends: switching teams off
 * mid-game takes effect for the next game, so no item is left without a turn.
 */
import { h, clear, add, toast } from '../ui.js';
import { getTeams, addPoints, endTurn, setTurn, setTeamRules, onTeams } from '../store.js';
import { openItem, markItem, chooseTeam, stepTeam, nextTurn, keepsTurn, rulesOf, whoAnswers, POINTS, THINK_TIMES } from '../games/turns.js';
import { choiceRow } from '../games/common.js';
import { openTeamsDialog, spinTeams } from './teams.js';
import { sfx, confetti } from '../sfx.js';

const FLASH_MS = 1800;

export function turnBar({ enabled = () => true } = {}) {
  const el = h('div', { class: 'turn-bar hidden', role: 'status', 'aria-live': 'polite' });
  let item = null;   // the open item (js/games/turns.js), null between items
  let spec = null;   // what the game asked for in open(), kept between items
  let rules = null;  // the open item's rules: the teams' plus the game's own
  let ids = [];      // team ids, in order, when the item opened
  let note = '';     // what just happened ("❌ Not quite.")
  let flash = null;  // { text, hue } after an item, for a moment
  let flashTimer = 0;
  let shown = false;
  let raf = 0;
  let playing = false;   // this game started in teams: it keeps them to the end
  let suggested = null;  // 'right' | 'wrong': a guess the teacher can accept
  let wasOn = getTeams().on;

  const teamsOn = (teams = getTeams()) => enabled() && teams.list.length > 0 && (teams.on || playing);
  const teamAt = (i, teams = getTeams()) => (i === null || i === undefined ? null : teams.list.find((t) => t.id === ids[i]) || null);

  // ------------------------------------------------------------ thinking time
  const stopTimer = () => { cancelAnimationFrame(raf); raf = 0; };
  function startTimer() {
    stopTimer();
    const secs = rulesOf(getTeams()).think;
    if (!secs || !item) return;
    const until = performance.now() + secs * 1000;
    let lastTick = secs + 1;
    const step = () => {
      const left = (until - performance.now()) / 1000;
      const fill = el.querySelector('.tb-timer-fill');
      if (fill) fill.style.width = `${Math.max(0, (left / secs) * 100)}%`;
      const s = Math.ceil(left);
      if (s !== lastTick && s <= 3 && s > 0) { lastTick = s; sfx('tick', { volume: 0.5 }); }
      if (left <= 0) { raf = 0; mark('timeout'); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  // ------------------------------------------------------------------ input
  const rulesFor = (teams, s = spec) => {
    const r = { ...rulesOf(teams) };
    if (s?.mode) r.mode = s.mode;
    if (s?.steal === false) r.steal = false;
    if (s?.keep) r.keep = true;
    return r;
  };

  function open(opts = {}) {
    const { judge = false, onOutcome = () => {}, prompt = '', mode = null, steal = null, keep = false, show = true, flash: say = null } = opts;
    const teams = getTeams();
    if (!teamsOn(teams)) return false;
    ids = teams.list.map((t) => t.id);
    spec = { judge, onOutcome, prompt, mode, steal, keep, show, say, opts };
    rules = rulesFor(teams);
    item = openItem({ teams: ids.length, turn: teams.turn || 0, rules });
    playing = true;
    suggested = null;
    note = '';
    clearTimeout(flashTimer);
    flash = null;
    shown = true;
    draw();
    sfx('pop', { volume: 0.45 });
    startTimer();
    return true;
  }

  function mark(result, meta = {}) {
    if (!item || item.done) return null;
    const res = markItem(item, result, rules);
    if (res.outcome === 'none') { nudge(); return null; }
    suggested = null;
    const before = item;
    const award = res.award;
    const scorer = award ? teamAt(award.team) : null;
    if (scorer) addPoints(scorer.id, award.points);
    if (award) { sfx('correct', { volume: 0.55 }); confetti({ count: 70 }); } else if (result === 'wrong') sfx('wrong', { volume: 0.4 }); else if (result === 'timeout') sfx('wrong', { volume: 0.3 });
    note = result === 'pass' ? '🤷 That\'s OK!' : result === 'timeout' ? '⏰ Time\'s up!' : result === 'wrong' ? '❌ Not quite.' : '';
    const info = { outcome: res.outcome, result, done: res.item.done, team: scorer || teamAt(res.item.answering), points: award?.points || 0, meta };
    if (res.item.done) {
      stopTimer();
      const owner = teamAt(before.owner);
      flash = flashFor(res.outcome, result, scorer, award);
      const said = spec.say?.(info);
      if (said) flash = { ...flash, text: said };
      item = null;
      // A pair in Rhyme memory: the same team goes again (its turn isn't over).
      if (keepsTurn(res.item)) setTurn(before.owner);
      else if (res.item.mode === 'turns' && owner) endTurn(owner.id, nextTurn(res.item, before.owner));
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flash = null; draw(); }, FLASH_MS);
    } else {
      item = res.item;
      startTimer();
    }
    draw();
    spec.onOutcome(info);
    return info;
  }

  function pickTeam(i) {
    if (!item) return;
    const next = chooseTeam(item, i);
    if (next === item) return;
    item = next;
    if (item.mode === 'turns' && item.phase === 'turn') { ids = getTeams().list.map((t) => t.id); setTurn(item.owner); }
    draw();
  }
  function step(dir) {
    if (!item) return;
    const next = stepTeam(item, dir);
    if (next === item) return;
    item = next;
    if (item.mode === 'turns' && item.phase === 'turn') setTurn(item.owner);
    draw();
  }

  function nudge() {
    toast('Who is answering? Click their team or press ↑/↓ first.', '', 2200);
    const card = el.querySelector('.tb-card');
    if (card) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); }
  }

  function onKey(e) {
    if (!item) return false;
    const k = e.key.toLowerCase();
    if (k === 'y' && spec.judge) { mark('right'); return true; }
    if (k === 'n') { mark('wrong'); return true; }
    if (k === 'p') { mark(item.mode === 'first' ? 'reveal' : 'pass'); return true; }
    if (k === 's' && spec.show) { mark('reveal'); return true; }
    if (k === 'enter' && suggested) { mark(suggested); return true; }
    if (k === 'arrowdown' || k === 'arrowup') { step(k === 'arrowdown' ? 1 : -1); return true; }
    return false;
  }

  // ---------------------------------------------------------------- display
  function flashFor(outcome, result, team, award) {
    if (team && outcome === 'stolen') return { text: `🦝 ${team.emoji} ${team.name} stole it! +${award.points}`, hue: team.hue };
    if (team) return { text: `✅ ${team.emoji} ${team.name} +${award.points}`, hue: team.hue };
    if (result === 'pass') return { text: '🤷 No points this time' };
    if (result === 'timeout') return { text: '⏰ Time\'s up! Here\'s the answer' };
    if (result === 'reveal') return { text: '👀 Here\'s the answer' };
    return { text: '🙈 Nobody got it this time' };
  }

  const btn = (label, key, onclick, cls = '') => h('button', { class: `btn tb-btn ${cls}`, type: 'button', onclick }, label, key ? h('kbd', null, key) : null);

  function drawOpen(teams) {
    const r = rules;
    const first = item.mode === 'first';
    const prompt = spec.prompt || 'Press the number they say';
    const who = teamAt(item.answering, teams);
    const card = h('div', { class: 'tb-card', style: { '--team-hue': who ? who.hue : 'var(--hue)' } });
    if (first) {
      card.append(h('div', { class: 'tb-who' }, h('span', { class: 'tb-emoji' }, '✋'), h('span', null, who ? `${who.emoji} ${who.name}` : 'Hands up!')));
      const row = h('div', { class: 'tb-teams' });
      ids.forEach((id, i) => {
        const t = teamAt(i, teams);
        if (!t) return;
        const out = item.tried.includes(i);
        row.append(h('button', {
          class: `btn tb-team${out ? ' out' : ''}`, type: 'button', disabled: out, style: { '--team-hue': t.hue },
          'aria-pressed': String(item.answering === i),
          title: spec.judge ? `${t.name} got it` : `${t.name} is answering`,
          onclick: () => { pickTeam(i); if (spec.judge) mark('right'); },
        }, `${t.emoji} ${t.name}`));
      });
      card.append(row, h('div', { class: 'tb-actions' }, btn('🙈 Nobody', 'P', () => mark('reveal'))));
      if (suggested) card.append(suggestLine());
      card.append(h('div', { class: 'tb-hint' }, spec.judge ? 'Click the team that got it.' : `Click the team whose hand went up, then ${prompt[0].toLowerCase()}${prompt.slice(1)}.`));
    } else {
      const steal = item.phase === 'steal';
      // With student names, one student answers for the team on its own
      // turn; a steal is for the whole team.
      const student = steal ? '' : whoAnswers(who);
      card.append(h('div', { class: 'tb-who' }, h('span', { class: 'tb-emoji' }, who?.emoji || '🎯'), h('span', null, who?.name || ''),
        student ? h('span', { class: 'tb-student' }, `· ${student},`) : null,
        h('span', { class: 'tb-what' }, steal ? `steal it for ${POINTS.steal}!` : 'your turn!')));
      if (note) card.append(h('div', { class: 'tb-note' }, note));
      const actions = h('div', { class: 'tb-actions' });
      if (spec.judge) {
        actions.append(
          btn('✓ Right', 'Y', () => mark('right'), `tb-right${suggested === 'right' ? ' tb-suggested' : ''}`),
          btn('✗ Wrong', 'N', () => mark('wrong'), `tb-wrong${suggested === 'wrong' ? ' tb-suggested' : ''}`));
      }
      actions.append(btn('🤷 Pass', 'P', () => mark('pass')));
      card.append(actions);
      if (suggested) card.append(suggestLine());
      const pts = r.keep ? `${POINTS.own} points and go again` : r.steal && item.n > 1 ? `${POINTS.own} points, ${POINTS.steal} for a steal` : `${POINTS.own} points`;
      card.append(h('div', { class: 'tb-hint' }, spec.judge ? (spec.prompt ? `${spec.prompt} · ${pts}` : `${pts} · ↑/↓ another team`) : `${prompt} · ${pts}`));
    }
    if (r.think) card.append(h('div', { class: 'tb-timer' }, h('div', { class: 'tb-timer-fill' })));
    el.append(card);
  }

  const suggestLine = () => h('div', { class: 'tb-suggest' }, `🎙️ The mic says ${suggested === 'right' ? '✓ right' : '✗ wrong'} · Enter accepts`);

  function drawIdle(teams) {
    const r = rulesFor(teams);
    if (r.mode === 'first') {
      el.append(h('div', { class: 'tb-card idle' }, h('span', null, '✋ First hand up')));
      return;
    }
    const next = teams.list[(teams.turn || 0) % teams.list.length];
    const student = whoAnswers(next);
    el.append(h('div', { class: 'tb-card idle', style: { '--team-hue': next.hue } }, h('span', { class: 'tb-next' }, 'Next turn:'), h('b', null, `${next.emoji} ${next.name}`),
      student ? h('span', { class: 'tb-student' }, `· ${student}`) : null));
  }

  function draw() {
    const teams = getTeams();
    const on = shown && teamsOn(teams);
    el.classList.toggle('hidden', !on);
    clear(el);
    if (!on) return;
    if (item) drawOpen(teams);
    else if (flash) el.append(h('div', { class: 'tb-card flash', style: { '--team-hue': flash.hue ?? 'var(--hue)' } }, flash.text));
    else drawIdle(teams);
  }

  const offTeams = onTeams((teams, detail = {}) => {
    // Points and turns change the chips, not the banner; a team edited in the
    // dialog (name, mascot) must show here too.
    if (detail.bump) return;
    if (playing && wasOn && !teams.on) toast('Teams go off after this game.', '', 2600);
    wasOn = teams.on;
    if (item && teams.list.map((t) => t.id).join() !== ids.join()) {
      // The teams themselves changed mid-item: start that item again.
      const s = spec;
      item = null;
      if (teamsOn(teams)) open(s.opts); else draw();
      return;
    }
    draw();
  });

  const api = {
    get active() { return teamsOn(); },
    get playing() { return playing; },
    open,
    mark,
    nudge,
    suggest(result) { if (item) { suggested = result === 'right' ? 'right' : 'wrong'; draw(); } },
    ready: () => !item || item.mode !== 'first' || item.answering !== null,
    isOpen: () => !!item,
    idle() { if (!item) { shown = true; if (teamsOn()) playing = true; draw(); } },
    end() { stopTimer(); clearTimeout(flashTimer); item = null; flash = null; shown = false; playing = false; suggested = null; draw(); },
  };
  return {
    el,
    api,
    onKey,
    destroy() { api.end(); offTeams(); },
  };
}

/*
 * The team rows for a game's set-up card: who is playing and how they answer.
 * hide: rows of the game that teams replace (its own timer) - hidden while
 * teams are on. only: the game always plays in turn order with its own rules
 * (Rhyme memory), so no Answering and Steal rows; note(next) says how.
 */
export function turnSetup({ hide = [], only = false, note = null } = {}) {
  const box = h('div', { class: 'turn-setup' });
  const row = (label, ...children) => h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, label), ...children);
  const draw = (teams = getTeams()) => {
    clear(box);
    for (const r of hide) if (r) r.classList.toggle('hidden', !!teams.on);
    if (!teams.on) {
      box.append(row('Teams', h('button', { class: 'btn', type: 'button', onclick: () => openTeamsDialog() }, '👥 Play in teams')));
      return;
    }
    const r = rulesOf(teams);
    if (only) r.mode = 'turns';
    const next = teams.list[(teams.turn || 0) % teams.list.length];
    const who = whoAnswers(next);
    const chips = teams.list.map((t) => h('span', { class: `team-chip${r.mode === 'turns' && t === next ? ' turn' : ''}`, style: { '--team-hue': t.hue } }, h('span', { class: 'tc-emoji' }, t.emoji), h('span', { class: 'tc-name' }, t.name)));
    const spin = r.mode === 'turns' && chips.length > 1 ? h('button', { class: 'btn btn-sm', type: 'button', title: 'Pick the team that starts at random', onclick: () => {
      spin.disabled = true;
      chips.forEach((c) => c.classList.remove('turn'));
      spinTeams(chips, (pick) => setTurn(pick));
    } }, '🎲 Who starts') : null;
    add(box,
      row('Teams', h('span', { class: 'turn-setup-teams' }, chips), spin,
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openTeamsDialog() }, '✏️ Edit')),
      only ? null : row('Answering', choiceRow([['turns', '🔄 Turns'], ['first', '✋ First hand up']], r.mode, (v) => setTeamRules({ mode: v }))),
      !only && r.mode === 'turns' ? row('Steal', choiceRow([[true, '🦝 Next team can steal'], [false, 'No steals']], r.steal, (v) => setTeamRules({ steal: v }))) : null,
      row('Thinking time', choiceRow(THINK_TIMES.map((s) => [s, s ? `${s} s` : 'No limit']), r.think, (v) => setTeamRules({ think: v }))),
      h('p', { class: 'small turn-setup-note' }, note ? note(next) : r.mode === 'turns'
        ? `${next.emoji} ${next.name}${who ? ` (${who})` : ''} starts. Each team answers in turn: ${POINTS.own} points if right${r.steal ? `, or the next team can steal it for ${POINTS.steal}` : ''}. 🤷 Pass (P) loses the turn.`
        : `Click the team whose hand went up first, then enter its answer: ${POINTS.first} point. A team that is wrong is out for that question.`),
    );
  };
  draw();
  box.destroy = onTeams((teams, detail = {}) => { if (!detail.bump) draw(teams); });
  return box;
}
