/*
 * Finish the line: the music stops just before the last words of a line.
 * Teams shout the ending; the teacher gives the point and the song itself
 * sings the answer when it carries on.
 */
import { h, clear, shuffle, seeded } from '../ui.js';
import { getTeams, addPoints } from '../store.js';
import { lineStops, setupCard, choiceRow, lyricView } from './common.js';
import { sfx, confetti } from '../sfx.js';
import { normWord } from '../lyrics/text.js';

export async function start(ctx) {
  const { track, timeline, main } = ctx;
  const conf = { hide: 2, which: 'some', timer: 10 };
  const card = setupCard({
    emoji: '🛑',
    title: 'Finish the line',
    intro: 'The music stops before the end of a line. Who remembers how it goes? Shout it, then let the song tell you if you were right!',
    body: h('div', null,
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Hide'),
        choiceRow([[1, 'Last word'], [2, 'Last 2 words'], [3, 'Last 3 words'], [0, 'Half the line']], conf.hide, (v) => { conf.hide = v; })),
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Stop at'),
        choiceRow([['all', 'Every line'], ['some', 'Every other line'], ['few', '6 surprise lines']], conf.which, (v) => { conf.which = v; })),
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Timer'),
        choiceRow([[0, 'None'], [5, '5 s'], [10, '10 s'], [15, '15 s']], conf.timer, (v) => { conf.timer = v; })),
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
    for (const l of cands) {
      const n = conf.hide === 0 ? Math.max(1, Math.floor(l.words.length / 2)) : Math.min(conf.hide, l.words.length - 1);
      const from = l.words.length - n;
      targets.set(l.index, { line: l, from, revealed: false });
    }
    const stops = [...targets.values()].map((tg) => ({ line: tg.line.index, at: Math.max(tg.line.start, tg.line.words[tg.from].start - 0.06) }));

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

    const reveal = (winner) => {
      if (waitingFor === null) return;
      cancelAnimationFrame(timerRaf);
      timerBar.classList.add('hidden');
      const tg = targets.get(waitingFor);
      tg.revealed = true;
      if (winner) {
        addPoints(winner, 1);
        sfx('correct', { volume: 0.6 });
        confetti({ count: 70 });
      }
      waitingFor = null;
      clear(panel);
      view.refresh();
      const r = resolveStop;
      resolveStop = null;
      if (r) r();
    };

    const showPanel = () => {
      clear(panel);
      const teams = getTeams();
      panel.append(h('div', { class: 'fin-q' }, '🤔 How does it end?'));
      const row = h('div', { class: 'row', style: { justifyContent: 'center' } });
      if (teams.on) {
        row.append(h('span', { class: 'small', style: { marginRight: '.4rem' } }, 'Who got it?'));
        for (const t of teams.list) row.append(h('button', { class: 'btn btn-lg team-btn', type: 'button', style: { '--team-hue': t.hue }, onclick: () => reveal(t.id) }, `${t.emoji} ${t.name}`));
        row.append(h('button', { class: 'btn btn-lg', type: 'button', onclick: () => reveal(null) }, '🙈 Nobody'));
      } else {
        row.append(h('button', { class: 'btn primary btn-lg', type: 'button', onclick: () => reveal(null) }, '▶ Hear the answer (Enter)'));
      }
      panel.append(row);
    };

    const runner = lineStops(track, stops, (stop) => new Promise((resolve) => {
      waitingFor = stop.line;
      resolveStop = resolve;
      view.hold(stop.line);
      view.refresh();
      sfx('pop', { volume: 0.5 });
      showPanel();
      runTimer(conf.timer, () => { sfx('wrong', { volume: 0.4 }); });
    }).then(() => view.release()));

    ctx.onKey((e) => {
      if (e.key === 'Enter' && waitingFor !== null) { reveal(null); return true; }
      return false;
    });

    let raf = 0;
    const loop = () => { view.tick(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const offEnd = track.on('end', () => ctx.finish({ emoji: '🏁', title: 'Song finished!', text: getTeams().on ? 'See who won with W.' : 'You know this song!', stars: 3 }));
    track.seek(0);
    track.play();
    cleanup = () => { cancelAnimationFrame(raf); cancelAnimationFrame(timerRaf); runner.destroy(); offEnd(); };
  }
}
