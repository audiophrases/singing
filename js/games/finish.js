/*
 * Finish the line: the music stops just before the last words of a line.
 * The class (or, in teams, the team whose turn it is) says the ending; the
 * teacher marks it and the song itself sings the answer when it carries on.
 */
import { h, clear, shuffle, seeded } from '../ui.js';
import { getTeams } from '../store.js';
import { lineStops, setupCard, choiceRow, lyricView } from './common.js';
import { sfx } from '../sfx.js';
import { normWord } from '../lyrics/text.js';
import { lessonOf, lessonStops } from '../lesson/pack.js';

export async function start(ctx) {
  const { track, timeline, main } = ctx;
  const packStops = lessonStops(timeline, lessonOf(ctx.song));
  const conf = { hide: 2, which: packStops.size ? 'pack' : 'some', timer: 10 };
  // In teams the shared thinking time replaces this timer.
  const timerRow = h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Timer'),
    choiceRow([[0, 'None'], [5, '5 s'], [10, '10 s'], [15, '15 s']], conf.timer, (v) => { conf.timer = v; }));
  const card = setupCard({
    emoji: '🛑',
    title: 'Finish the line',
    intro: 'The music stops before the end of a line. Who remembers how it goes? Say it, then let the song tell you if you were right!',
    body: h('div', null,
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Hide'),
        choiceRow([[1, 'Last word'], [2, 'Last 2 words'], [3, 'Last 3 words'], [0, 'Half the line']], conf.hide, (v) => { conf.hide = v; })),
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Stop at'),
        choiceRow([...(packStops.size ? [['pack', `🧠 AI pack (${packStops.size})`]] : []), ['all', 'Every line'], ['some', 'Every other line'], ['few', '6 surprise lines']], conf.which, (v) => { conf.which = v; })),
      timerRow,
      ctx.turns?.setup({ hide: [timerRow] }),
    ),
    onStart: () => { card.destroy(); begin(); },
  });
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function begin() {
    const rnd = seeded(Date.now() % 100000);
    let cands = timeline.lines.filter((l) => !l.instrumental && l.words.length >= 3);
    // Skip lines that end the same as the previous one ("little lamb, little lamb").
    if (conf.which === 'some') cands = cands.filter((_, i) => i % 2 === 1);
    if (conf.which === 'few') cands = shuffle(cands, rnd).slice(0, 6).sort((a, b) => a.start - b.start);
    const targets = new Map();
    if (conf.which === 'pack') {
      for (const [index, stop] of packStops) targets.set(index, { line: timeline.lines[index], from: stop.from, ask: stop.ask, revealed: false });
    } else for (const l of cands) {
      const n = conf.hide === 0 ? Math.max(1, Math.floor(l.words.length / 2)) : Math.min(conf.hide, l.words.length - 1);
      const from = l.words.length - n;
      targets.set(l.index, { line: l, from, revealed: false });
    }
    const stops = [...targets.values()].sort((a, b) => a.line.start - b.line.start).map((tg) => ({ line: tg.line.index, at: Math.max(tg.line.start, tg.line.words[tg.from].start - 0.06) }));

    const render = (w, wi, line, where) => {
      const tg = targets.get(line.index);
      if (!tg || wi < tg.from || tg.revealed || where === 'prev') return null;
      if (where === 'next') return null;
      const trail = w.text.match(/[^A-Za-z0-9'’]+$/);
      const len = normWord(w.text).length;
      return h('span', { class: 'w' }, h('span', { class: `gap-box${waitingFor === line.index ? ' active' : ''}`, style: { '--chars': Math.max(3, len) } }, waitingFor === line.index ? '?' : ''), trail ? trail[0] : '');
    };
    let waitingFor = null;
    const view = lyricView(ctx, { render });
    const panel = h('div', { class: 'fin-panel' });
    const timerBar = h('div', { class: 'fin-timer hidden' }, h('div', { class: 'fin-timer-fill' }));
    clear(main).append(h('div', { class: 'gf-wrap' }, view.el, timerBar, panel));
    ctx.setBottom(null);

    // Teams: each stop is one team's turn; the teacher marks what it said
    // (✓ Y / ✗ N / 🤷 P on the turn banner, js/views/turnbar.js).
    const T = ctx.turns?.active ? ctx.turns : null;
    let resolveStop = null;
    let timerRaf = 0;
    const runTimer = (secs, onEnd) => {
      cancelAnimationFrame(timerRaf);
      if (!secs) { timerBar.classList.add('hidden'); return; }
      timerBar.classList.remove('hidden');
      const fill = timerBar.firstChild;
      const t0 = performance.now();
      let lastTick = secs;
      const step = () => {
        const left = secs - (performance.now() - t0) / 1000;
        fill.style.width = `${Math.max(0, (left / secs) * 100)}%`;
        const s = Math.ceil(left);
        if (s !== lastTick && s <= 3 && s > 0) { lastTick = s; sfx('tick', { volume: 0.5 }); }
        if (left <= 0) { onEnd(); return; }
        timerRaf = requestAnimationFrame(step);
      };
      timerRaf = requestAnimationFrame(step);
    };

    // The stop is over (points, if any, are already given): the song sings the ending.
    const reveal = () => {
      if (waitingFor === null) return;
      cancelAnimationFrame(timerRaf);
      timerBar.classList.add('hidden');
      const tg = targets.get(waitingFor);
      tg.revealed = true;
      waitingFor = null;
      clear(panel);
      view.refresh();
      const r = resolveStop;
      resolveStop = null;
      if (r) r();
    };

    const showPanel = () => {
      clear(panel);
      panel.append(h('div', { class: 'fin-q' }, targets.get(waitingFor)?.ask || '🤔 How does it end?'));
      if (T) {
        panel.append(h('div', { class: 'small' }, 'Mark the answer on the banner above · Enter: hear the answer now'));
        return;
      }
      panel.append(h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn primary btn-lg', type: 'button', onclick: () => reveal() }, '▶ Hear the answer (Enter)')));
    };

    const runner = lineStops(track, stops, (stop) => new Promise((resolve) => {
      waitingFor = stop.line;
      resolveStop = resolve;
      view.hold(stop.line);
      view.refresh();
      showPanel();
      if (T) {
        T.open({ judge: true, onOutcome: (o) => { if (o.done) reveal(); } });
      } else {
        sfx('pop', { volume: 0.5 });
        runTimer(conf.timer, () => { sfx('wrong', { volume: 0.4 }); });
      }
    }).then(() => view.release()));

    ctx.onKey((e) => {
      if (e.key === 'Enter' && waitingFor !== null) {
        if (T && T.isOpen()) T.mark('reveal'); else reveal();
        return true;
      }
      return false;
    });

    let raf = 0;
    const loop = () => { view.tick(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const offEnd = track.on('end', () => ctx.finish({ emoji: '🏁', title: 'Song finished!', text: getTeams().on ? 'See who won with W.' : 'You know this song!', stars: 3 }));
    if (T) T.idle();
    track.seek(0);
    track.play();
    cleanup = () => { cancelAnimationFrame(raf); cancelAnimationFrame(timerRaf); runner.destroy(); offEnd(); };
  }
}
