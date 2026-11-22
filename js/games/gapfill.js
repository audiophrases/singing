/*
 * Fill the gaps: the song plays; some words are hidden. Type them (or tap
 * them in the word bank) - the music waits at the end of a line until its
 * gaps are filled. Right while the music is still playing = speed bonus.
 *
 * Also used by "Choose the word" (mode 'choose': three options per gap).
 *
 * In teams every gap is one team's turn (js/views/turnbar.js): the music
 * waits at the line, the team says the word aloud and the teacher marks it
 * (mode 'say': Y/N), types it or clicks it in the word bank.
 */
import { h, clear, shuffle, seeded } from '../ui.js';
import { pickGaps, distractors, wordPool, gapMode, matchCase, GAP_LEVELS } from '../lyrics/gaps.js';
import { lessonOf, gapNotes, orderSets, pickSet, setLabel } from '../lesson/pack.js';
import { categoriesInTimeline } from '../lyrics/grammar.js';
import { checkAnswer, normWord, hintFor } from '../lyrics/text.js';
import { lineStops, setupCard, choiceRow, scoreBox, lyricView, stars, centerOf } from './common.js';
import { sfx, floatEmoji } from '../sfx.js';
import { onTeams } from '../store.js';

export async function start(ctx, forced = {}) {
  const { track, timeline, main, params } = ctx;
  const cats = categoriesInTimeline(timeline, 2).filter((c) => !['colour', 'animal', 'body', 'family', 'food', 'weather', 'time', 'clothes', 'feeling', 'action'].includes(c.id) || c.count >= 3);
  const lesson = lessonOf(ctx.song);
  const sets = orderSets(lesson?.gapSets);
  const first = pickSet(sets, ctx.settings.packLevel);
  const conf = {
    level: params.level || forced.level || 'easy',
    // An assignment plays exactly what the server checks.
    focus: params.focus || (!ctx.assignment && first ? `pack:${first.id}` : ''),
    input: forced.input || params.input || 'type',
    seed: Number(params.seed) || Math.floor(Math.random() * 1e6),
  };
  const difficultyNote = h('p', { class: 'small' });
  const describeDifficulty = () => {
    const set = sets.find((s) => `pack:${s.id}` === conf.focus);
    difficultyNote.textContent = set ? set.rule || `${set.name}: chosen for this song.` : conf.focus
      ? 'Every matching word in the selected focus is hidden.'
      : GAP_LEVELS.find((level) => level.id === conf.level)?.desc || '';
  };
  describeDifficulty();

  // ---------------------------------------------------------------- set-up
  const setupBody = h('div', null,
    h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Difficulty'),
      choiceRow(GAP_LEVELS.map((l) => [l.id, `${l.emoji} ${l.name}`, l.desc]), conf.level, (v) => { conf.level = v; describeDifficulty(); })),
    cats.length || sets.length ? h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Focus'),
      (() => {
        const sel = h('select', { class: 'setup-select', 'aria-label': 'Word focus' }, h('option', { value: '' }, 'Any words (by difficulty)'),
          sets.length ? h('optgroup', { label: '🧠 AI pack' }, sets.map((s) => h('option', { value: `pack:${s.id}`, selected: conf.focus === `pack:${s.id}` }, setLabel(s)))) : null,
          cats.map((c) => h('option', { value: c.id, selected: conf.focus === c.id }, `${c.emoji} Only ${c.name.toLowerCase()} (${c.count})`)));
        sel.addEventListener('change', () => { conf.focus = sel.value; describeDifficulty(); });
        return sel;
      })()) : null,
    difficultyNote,
  );
  // Answer by: in teams the words are said aloud by default.
  const answerRow = forced.input ? null : h('div', { class: 'setup-row' });
  let chosenInput = !!params.input;
  const drawAnswerRow = () => {
    if (!answerRow) return;
    const teams = !!ctx.turns?.active;
    if (!teams && conf.input === 'say') conf.input = 'type';
    if (teams && !chosenInput) conf.input = 'say';
    clear(answerRow).append(h('span', { class: 'setup-label' }, 'Answer by'),
      choiceRow([...(teams ? [['say', '🗣️ Said aloud', 'The team says the word; you press Y or N']] : []), ['type', '⌨️ Typing'], ['bank', '👆 Tapping words']], conf.input, (v) => { conf.input = v; chosenInput = true; }));
  };
  drawAnswerRow();
  if (answerRow) setupBody.append(answerRow);
  if (ctx.assignment) setupBody.querySelectorAll('button, input, select').forEach((control) => { control.disabled = true; });
  else if (answerRow) ctx.addCleanup(onTeams((t, detail = {}) => { if (!detail.bump && card.isConnected) drawAnswerRow(); }));
  // In teams each gap is one team's turn (js/views/turnbar.js).
  const teamRows = ctx.turns?.setup();
  if (teamRows) setupBody.append(teamRows);
  const intro = forced.input === 'choose'
    ? 'Listen and choose the word you hear. The music waits for you at the end of each line. In teams, each team gets a word in turn and says its answer aloud.'
    : 'Listen and type the missing words. The music waits at the end of each line. Type before the line ends for a speed bonus! In teams, each team gets a word in turn and says it aloud.';
  const card = setupCard({
    emoji: forced.input === 'choose' ? '🔘' : '⌨️',
    title: forced.input === 'choose' ? 'Choose the word' : 'Fill the gaps',
    intro,
    body: setupBody,
    onStart: () => { card.destroy(); begin(); },
  });
  clear(main).append(card);
  ctx.setBottom(false);

  let cleanupGame = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanupGame) cleanupGame(); });

  function begin() {
    const rnd = seeded(conf.seed);
    const mode = gapMode(conf.focus, conf.level);
    const gaps = pickGaps(timeline, { mode, seed: conf.seed, lesson });
    const notes = conf.focus.startsWith('pack:') ? gapNotes(timeline, lesson, conf.focus.slice(5)) : new Map();
    const pool = wordPool(timeline);
    const items = [];
    const byLine = new Map();
    for (const l of timeline.lines) {
      const set = gaps.get(l.index);
      if (!set) continue;
      const list = [];
      for (const wi of [...set].sort((a, b) => a - b)) {
        const word = l.words[wi].text.replace(/^[^A-Za-z0-9'’]+|[^A-Za-z0-9'’]+$/g, '');
        const note = notes.get(`${l.index}:${wi}`);
        const item = { id: items.length, line: l.index, wi, word, status: 'open', hints: 0, options: null, tried: new Set(), wrong: (note?.options || []).map((o) => matchCase(word, o)), why: note?.why || '' };
        items.push(item);
        list.push(item.id);
      }
      byLine.set(l.index, list);
    }
    if (!items.length) {
      clear(main).append(h('div', { class: 'setup-card' }, h('h2', null, 'No gaps here'), h('p', null, 'Try another level or focus.'), h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.restart() }, 'Back')));
      return;
    }
    for (const it of items) {
      if (conf.input === 'choose') {
        it.options = shuffle([it.word, ...(it.wrong.length ? it.wrong : distractors(it.word, { pool, count: 2, seed: conf.seed + it.id }))], rnd);
      }
    }
    for (const saved of ctx.savedAnswers || []) {
      const item = items[saved.item_id];
      if (!item) continue;
      const answer = checkAnswer(saved.answer, item.word);
      if (saved.skipped) item.status = 'revealed';
      else if (answer === 'right' || (answer === 'close' && conf.input === 'type')) item.status = answer;
    }
    // Teams: the music waits at each line and every gap is one team's turn,
    // answered aloud; the teacher marks it (say), types it or clicks it.
    const T = ctx.turns?.active ? ctx.turns : null;
    if (conf.input === 'say' && !T) conf.input = 'type';
    let turnItem = null; // the gap the open turn is about
    const score = scoreBox();
    const progress = h('div', { class: 'gf-progress' });
    let active = null;
    const boxes = new Map(); // item id -> element in current/next line

    const render = (w, wi, line, where) => {
      const list = byLine.get(line.index);
      if (!list) return null;
      const id = list.find((x) => items[x].wi === wi);
      if (id === undefined) return null;
      const it = items[id];
      const trail = w.text.match(/[^A-Za-z0-9'’]+$/);
      const box = h('span', { class: `gap-box ${it.status}`, style: { '--chars': Math.max(3, it.word.length) } },
        it.status === 'open' ? (it.hints ? hintFor(it.word, it.hints) : '') : it.word);
      if (where === 'cur' || where === 'next') boxes.set(id, box);
      return h('span', { class: 'w' }, box, trail ? trail[0] : '');
    };
    const view = lyricView(ctx, { render });

    const input = h('input', { class: 'gf-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, placeholder: 'Type the missing word…', 'aria-label': 'Missing word' });
    const bank = h('div', { class: 'gf-bank' });
    const msg = h('div', { class: 'gf-msg' });
    const why = h('div', { class: 'gf-why' });
    const tools = h('div', { class: 'gf-tools' },
      h('button', { class: 'btn', type: 'button', title: 'Listen to the line again (R)', onclick: () => replay() }, '🔁 Again'),
      h('button', { class: 'btn', type: 'button', title: 'Show a letter (Tab)', onclick: () => hint() }, '💡 Hint'),
      h('button', { class: 'btn', type: 'button', title: 'Show the word (S)', onclick: () => reveal() }, '⏭️ Skip'),
    );
    const answerArea = h('div', { class: 'gf-answer' }, conf.input === 'type' ? input : conf.input === 'say' ? null : bank, msg, why, tools);
    clear(main).append(h('div', { class: 'gf-wrap' }, h('div', { class: 'gf-top' }, progress, score.el), view.el, answerArea));
    ctx.setBottom(null);

    const lineDone = (li) => (byLine.get(li) || []).every((id) => items[id].status !== 'open');
    let waitingLine = null;
    let resolveWait = null;

    const findActive = () => {
      const open = items.filter((it) => it.status === 'open');
      if (waitingLine !== null) return open.find((it) => it.line <= waitingLine) || null;
      const cur = view.index;
      return open.find((it) => it.line === cur) || open.find((it) => it.line === cur + 1) || null;
    };

    const updateProgress = () => {
      const done = items.filter((it) => it.status !== 'open').length;
      progress.textContent = `${done} / ${items.length} words`;
    };
    updateProgress();

    const drawActive = () => {
      const a = findActive();
      if (a !== active) {
        active = a;
        for (const [id, el] of boxes) el.classList.toggle('active', !!active && id === active.id);
        drawBank();
      }
      if (active && boxes.get(active.id)) boxes.get(active.id).classList.add('active');
    };

    function drawBank() {
      clear(bank);
      if (conf.input === 'type' || conf.input === 'say') return;
      if (!active || (T && waitingLine === null)) { bank.append(h('span', { class: 'small' }, 'Listen…')); return; }
      let opts;
      if (conf.input === 'choose') {
        opts = active.options;
      } else {
        const lineItems = (byLine.get(active.line) || []).map((id) => items[id]).filter((it) => it.status === 'open');
        const words = lineItems.map((it) => it.word);
        const extra = active.wrong.length ? active.wrong : distractors(active.word, { pool, count: 2, seed: conf.seed + active.id * 7 });
        opts = shuffle([...new Set([...words, ...extra])], seeded(conf.seed + active.id));
      }
      // Options a team already said (and missed) stay greyed out for the steal.
      opts.forEach((w, i) => bank.append(h('button', { class: `btn bank-word${active.tried.has(w) ? ' wrong' : ''}`, type: 'button', disabled: active.tried.has(w), onclick: (e) => tryAnswer(w, e.currentTarget) }, h('kbd', null, String(i + 1)), ` ${w}`)));
    }

    // Typing in teams: the box opens with the turn (no early answers).
    function syncInput() {
      if (!T || conf.input !== 'type') return;
      const on = waitingLine !== null && T.isOpen() && !!active && turnItem === active;
      input.disabled = !on;
      input.placeholder = on ? 'Type the word they say…' : 'Listen…';
      if (on) input.focus();
    }

    function openTurn() {
      if (!T || waitingLine === null || !active || T.isOpen()) return;
      turnItem = active;
      T.open({ judge: conf.input === 'say', onOutcome: onTurn, prompt: conf.input === 'type' ? 'Type the word they say' : '' });
      syncInput();
    }

    function onTurn(o) {
      const it = turnItem;
      if (!it || it.status !== 'open') return;
      if (conf.input === 'type') { input.value = ''; input.classList.remove('wrong'); }
      if (!o.done) {
        if (o.meta.word) { it.tried.add(o.meta.word); drawBank(); }
        if (conf.input === 'type' && o.result === 'wrong') { input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 400); }
        syncInput();
        return;
      }
      turnItem = null;
      if (o.outcome === 'right' || o.outcome === 'stolen') settle(it, 'right', Math.max(2, 10 - it.hints * 3));
      else settle(it, 'revealed', 0);
      // More gaps in this line: the next team's turn, after a moment.
      if (waitingLine !== null && !lineDone(waitingLine)) {
        setTimeout(() => { if (waitingLine !== null) { active = null; drawActive(); openTurn(); } }, 900);
      }
      syncInput();
    }

    function settle(it, status, points, answer = it.word) {
      it.status = status;
      why.textContent = it.why ? `💡 ${it.why}` : '';
      ctx.reportAnswer?.({ itemId: it.id, answer, skipped: status === 'revealed' });
      if (points) score.add(points, status === 'right');
      else score.breakStreak();
      const box = boxes.get(it.id);
      if (box) {
        box.className = `gap-box ${status}`;
        box.textContent = it.word;
        if (points) {
          const c = centerOf(box);
          floatEmoji(`+${points}`, c.x, c.y - 30, { size: 30 });
        }
      }
      updateProgress();
      if (waitingLine !== null && lineDone(waitingLine) && resolveWait) {
        const r = resolveWait;
        resolveWait = null;
        msg.textContent = '';
        setTimeout(r, status === 'revealed' ? 900 : 350);
      }
      // Answered before the music got to the stop: no need to wait there.
      if (waitingLine === null) {
        const si = stopsList.findIndex((s) => s.line === it.line);
        if (si >= 0 && lineDone(it.line)) runner.pass(si);
      }
      active = null;
      drawActive();
    }

    function tryAnswer(text, btn) {
      if (!active) return false;
      if (T) {
        if (waitingLine === null || !T.isOpen() || turnItem !== active || !text.trim()) return false;
        if (!T.ready()) { T.nudge(); return false; }
        const res = checkAnswer(text, active.word);
        // Typed by the teacher: a small slip in the spelling still counts.
        const ok = res === 'right' || (res === 'close' && conf.input === 'type');
        T.mark(ok ? 'right' : 'wrong', { word: text });
        return ok;
      }
      const res = checkAnswer(text, active.word);
      if (res === 'right' || (res === 'close' && conf.input === 'type')) {
        const early = waitingLine === null;
        let pts = res === 'right' ? 10 : 7;
        if (early) pts += 5;
        pts = Math.max(2, pts - active.hints * 3);
        sfx('pop', { volume: 0.35 });
        settle(active, res === 'right' ? 'right' : 'close', pts, text);
        input.value = '';
        input.classList.remove('wrong');
        return true;
      }
      if (btn) {
        btn.classList.add('shake', 'wrong');
        setTimeout(() => btn.classList.remove('shake'), 400);
        sfx('wrong', { volume: 0.3 });
        score.breakStreak();
      }
      return false;
    }

    input.addEventListener('input', () => {
      if (!active) return;
      const v = input.value;
      // Auto-accept as soon as the word is right (no Enter needed).
      if (checkAnswer(v, active.word) === 'right') { tryAnswer(v); return; }
      const typed = normWord(v);
      const target = normWord(active.word);
      input.classList.toggle('wrong', typed.length > 0 && !target.startsWith(typed.replace(/[^a-z0-9']/g, '')));
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && T) {
        e.preventDefault();
        tryAnswer(input.value); // the banner sounds and scores it
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!tryAnswer(input.value)) {
          input.classList.add('shake');
          setTimeout(() => input.classList.remove('shake'), 400);
          if (input.value.trim()) sfx('wrong', { volume: 0.3 });
          score.breakStreak();
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        hint();
      } else if (e.key === 'Escape') {
        input.blur();
      }
    });

    function hint() {
      if (!active) return;
      active.hints = Math.min(active.word.length, active.hints + 1);
      const box = boxes.get(active.id);
      if (box) box.textContent = hintFor(active.word, active.hints);
      if (active.hints >= active.word.replace(/[^A-Za-z]/g, '').length) reveal();
      else if (conf.input === 'type') input.focus();
    }

    function reveal() {
      if (!active) return;
      if (T) { if (T.isOpen()) T.mark('reveal'); return; }
      sfx('wrong', { volume: 0.25 });
      settle(active, 'revealed', 0);
    }

    function replay() {
      const li = waitingLine !== null ? waitingLine : Math.max(0, view.index);
      const line = timeline.lines[li];
      if (!line) return;
      // While the music waits at a line: play it again and wait there again.
      const stop = waitingLine !== null ? stopsList.find((s) => s.line === waitingLine) : null;
      if (stop) track.setBarrier(stop.at);
      track.seek(Math.max(0, line.start - 0.25));
      track.play();
      if (conf.input === 'type') input.focus();
    }

    // Stops: just after the last sung word of every line with gaps.
    const stopsList = [...byLine.keys()].sort((a, b) => a - b).map((li) => {
      const l = timeline.lines[li];
      return { line: li, at: Math.min(l.end - 0.02, l.singEnd + 0.12) };
    });
    const runner = lineStops(track, stopsList, (stop) => new Promise((resolve) => {
      if (lineDone(stop.line)) { resolve(); return; }
      // "Again" brings the music back to the same stop: the turn carries on.
      const again = waitingLine === stop.line;
      waitingLine = stop.line;
      view.hold(stop.line);
      msg.textContent = conf.input === 'say' ? '⏸ What is the missing word? Say it! (R: again · Tab: hint)'
        : conf.input === 'type' ? `⏸ ${T ? 'What is the missing word?' : 'Type the missing word!'} (R: again · Tab: hint)` : '⏸ Which word did you hear?';
      resolveWait = () => {
        waitingLine = null;
        view.release();
        resolve();
      };
      if (again && T?.isOpen()) return;
      active = null;
      drawActive();
      if (T) openTurn();
      else if (conf.input === 'type') input.focus();
    }));

    ctx.onKey((e) => {
      const k = e.key.toLowerCase();
      if (k === 'r') { replay(); return true; }
      if (k === 's' && (conf.input !== 'type' || T)) { reveal(); return true; }
      if (conf.input !== 'type' && /^[1-9]$/.test(k)) {
        const b = bank.querySelectorAll('.bank-word')[Number(k) - 1];
        if (b) b.click();
        return true;
      }
      if (k === 'tab') { hint(); return true; }
      return false;
    });

    let raf = 0;
    const loop = () => {
      const before = view.index;
      view.tick();
      if (view.index !== before) {
        active = null;
      }
      drawActive();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const offEnd = track.on('end', () => {
      const max = items.length * 15;
      const right = items.filter((it) => it.status === 'right' || it.status === 'close').length;
      ctx.finish({
        score: score.value,
        max,
        emoji: right === items.length ? '🏆' : '🎧',
        title: right === items.length ? 'Perfect ears!' : 'Song complete!',
        text: `${right} of ${items.length} words found.`,
        stars: stars(score.value / max),
      });
    });

    if (T) { T.idle(); syncInput(); }
    track.seek(0);
    track.play();
    if (conf.input === 'type' && !T) setTimeout(() => input.focus(), 50);

    cleanupGame = () => {
      cancelAnimationFrame(raf);
      runner.destroy();
      offEnd();
    };
  }
}
