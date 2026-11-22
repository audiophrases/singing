/*
 * Line builder: the words of the next line are scrambled tiles. Tap them in
 * order before the song gets there (word order practice, PinPlay-puzzle style).
 *
 * In teams each line is one team's turn (js/views/turnbar.js): the music
 * waits after the line, the team says the words in order and the teacher taps
 * the tiles. A wrong tile hands the rest of the line to the next team.
 */
import { h, clear, shuffle, seeded } from '../ui.js';
import { lineStops, setupCard, choiceRow, scoreBox, centerOf, stars } from './common.js';
import { lineEl, paintLine } from './karaoke.js';
import { normWord } from '../lyrics/text.js';
import { sfx, floatEmoji } from '../sfx.js';
import { currentLineAt } from '../music/timeline.js';

export async function start(ctx) {
  const { track, timeline, main } = ctx;
  const conf = { which: 'unique' };
  const card = setupCard({
    emoji: '🧱',
    title: 'Line builder',
    intro: 'The words are mixed up! Tap them in the right order to build the line - the music waits for you. In teams, each team builds a line in turn, saying the words in order.',
    body: h('div', null, h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Lines'),
      choiceRow([['unique', 'Each line once'], ['all', 'Every line']], conf.which, (v) => { conf.which = v; })),
      ctx.turns?.setup()),
    onStart: () => { card.destroy(); begin(); },
  });
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function begin() {
    const rnd = seeded(Date.now() % 99991);
    const seen = new Set();
    const tasks = [];
    for (const l of timeline.lines) {
      if (l.instrumental || l.words.length < 3 || l.words.length > 10) continue;
      const key = l.text.toLowerCase();
      if (conf.which === 'unique' && seen.has(key)) continue;
      seen.add(key);
      tasks.push({ line: l, built: 0, done: false, mistakes: 0 });
    }
    const byLine = new Map(tasks.map((t) => [t.line.index, t]));
    const score = scoreBox();
    const built = h('div', { class: 'lb-built' });
    const tiles = h('div', { class: 'lb-tiles' });
    const playing = h('div', { class: 'lb-playing' });
    const msg = h('div', { class: 'gf-msg' });
    clear(main).append(h('div', { class: 'gf-wrap' }, h('div', { class: 'gf-top' }, h('div', { class: 'gf-progress' }, '🧱 Build the next line'), score.el), playing, built, tiles, msg));
    ctx.setBottom(null);

    let current = null;
    let waiting = false;
    let resolveWait = null;
    let playingEl = null;
    // Teams: each line is one team's turn, at the stop (js/views/turnbar.js).
    const T = ctx.turns?.active ? ctx.turns : null;
    let turnTask = null;

    const nextTask = () => {
      const t = track.time();
      return tasks.find((x) => !x.done && x.line.singEnd > t - 0.1) || null;
    };

    const draw = (task) => {
      current = task;
      clear(built);
      clear(tiles);
      if (!task) { built.append(h('span', { class: 'small' }, '🎶')); return; }
      const words = task.line.words.map((w) => w.text);
      for (let i = 0; i < words.length; i += 1) built.append(h('span', { class: `lb-slot${i < task.built ? ' filled' : ''}` }, i < task.built ? words[i] : ''));
      const order = shuffle(words.map((w, i) => ({ w, i })), rnd);
      for (const o of order) {
        if (o.i < task.built) continue;
        const b = h('button', { class: 'btn bank-word', type: 'button' }, o.w.replace(/[,.!?;:]+$/, ''));
        b.addEventListener('click', () => tap(task, o, b));
        tiles.append(b);
      }
    };

    // The line is finished (built, or shown when nobody could): carry on.
    function complete(task, pts) {
      task.done = true;
      if (pts) {
        score.add(pts);
        const c = centerOf(built);
        floatEmoji(`+${pts}`, c.x, c.y - 40, { size: 32 });
      } else score.breakStreak();
      if (waiting && resolveWait) { const r = resolveWait; resolveWait = null; setTimeout(r, pts ? 300 : 1200); } else {
        const si = stops.findIndex((s) => s.line === task.line.index);
        if (si >= 0) runner.pass(si);
      }
      setTimeout(() => draw(nextTask()), pts ? 450 : 1300);
    }

    function tap(task, o, btn) {
      if (T) {
        // The team says the words at the stop; no early answers.
        if (!waiting || turnTask !== task || !T.isOpen()) return;
        if (!T.ready()) { T.nudge(); return; }
      }
      const expected = task.line.words[task.built].text;
      // Same word twice in a line: either tile is fine.
      if (normWord(o.w) === normWord(expected)) {
        task.built += 1;
        btn.remove();
        const slot = built.children[task.built - 1];
        slot.textContent = expected;
        slot.classList.add('filled');
        sfx('pop', { volume: 0.3 });
        if (task.built === task.line.words.length) {
          if (T) { T.mark('right'); return; } // the banner scores it
          sfx('correct', { volume: 0.5 });
          complete(task, Math.max(3, (waiting ? 6 : 10) - task.mistakes * 2));
        }
        return;
      }
      task.mistakes += 1;
      btn.classList.add('shake', 'wrong');
      setTimeout(() => btn.classList.remove('shake', 'wrong'), 400);
      // In teams a wrong word hands the rest of the line to the next team.
      if (T) { T.mark('wrong'); return; }
      score.breakStreak();
      sfx('wrong', { volume: 0.3 });
    }

    function onTurn(o) {
      const task = turnTask;
      if (!task || task.done || !o.done) return;
      turnTask = null;
      if (o.outcome === 'right' || o.outcome === 'stolen') { complete(task, 10); return; }
      // Nobody finished it: show the rest of the line.
      const words = task.line.words.map((w) => w.text);
      [...built.children].forEach((slot, i) => { if (i >= task.built) { slot.textContent = words[i]; slot.classList.add('filled', 'shown'); } });
      clear(tiles);
      complete(task, 0);
    }

    const stops = tasks.map((t) => ({ line: t.line.index, at: Math.min(t.line.end - 0.02, t.line.singEnd + 0.1) }));
    const runner = lineStops(track, stops, (stop) => new Promise((resolve) => {
      const task = byLine.get(stop.line);
      if (!task || task.done) { resolve(); return; }
      waiting = true;
      if (current !== task) draw(task);
      msg.textContent = T ? '⏸ Say the words in order!' : '⏸ Finish building the line!';
      resolveWait = () => { waiting = false; msg.textContent = ''; resolve(); };
      if (T) {
        turnTask = task;
        T.open({ onOutcome: onTurn, prompt: 'Tap the tiles in the order they say' });
      }
    }));

    let raf = 0;
    let shownIdx = -99;
    const loop = () => {
      const t = track.time();
      const i = currentLineAt(timeline, t);
      if (i !== shownIdx) {
        shownIdx = i;
        clear(playing);
        const l = timeline.lines[i];
        playingEl = l && (!byLine.has(l.index) || byLine.get(l.index).done) ? lineEl(l) : null;
        if (playingEl) playing.append(playingEl);
        if (!waiting) {
          const nt = nextTask();
          if (nt !== current) draw(nt);
        }
      }
      if (playingEl) paintLine(playingEl, t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    draw(nextTask());
    if (T) T.idle();
    const offEnd = track.on('end', () => {
      const max = tasks.length * 10;
      ctx.finish({ score: score.value, max, emoji: '🧱', title: 'Master builder!', text: `${tasks.filter((t) => t.done).length} lines built.`, stars: stars(score.value / max) });
    });
    track.seek(0);
    track.play();
    cleanup = () => { cancelAnimationFrame(raf); runner.destroy(); offEnd(); };
  }
}
