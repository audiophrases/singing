/*
 * Line order: the song's lines are shuffled cards. While the song plays,
 * click the line you hear - it slides into its place in the song.
 *
 * In teams each line is one team's turn (js/views/turnbar.js): the music
 * waits after the line and the teacher clicks the card the team names.
 */
import { h, clear, shuffle } from '../ui.js';
import { lineStops, setupCard, choiceRow, scoreBox, centerOf, stars } from './common.js';
import { sfx, floatEmoji } from '../sfx.js';

export async function start(ctx) {
  const { track, timeline, main } = ctx;
  const sung = timeline.lines.filter((l) => !l.instrumental);
  // Unique lines in order of first appearance.
  const unique = [];
  const firstOf = new Map();
  for (const l of sung) {
    const k = l.text.toLowerCase().replace(/[^a-z' ]/g, '').trim();
    if (!firstOf.has(k)) { firstOf.set(k, l); unique.push({ key: k, line: l }); }
  }
  const conf = { count: Math.min(8, unique.length) };
  const card = setupCard({
    emoji: '🧩',
    title: 'Line order',
    intro: 'The lines are mixed up! Listen and click the line you hear. Each correct answer earns 10 points, even after the music pauses. Wrong clicks lose 2 points. In teams, each team names a line in turn.',
    body: h('div', null, h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Lines'),
      choiceRow([...new Set([4, 6, 8, 12].filter((n) => n < unique.length).concat([unique.length]))].map((n) => [n, n === unique.length ? `All ${n}` : String(n)]), conf.count, (v) => { conf.count = v; })),
      ctx.turns?.setup()),
    onStart: () => { card.destroy(); begin(); },
  });
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function begin() {
    const chosen = unique.slice(0, conf.count);
    const keys = new Set(chosen.map((c) => c.key));
    const lastLine = chosen[chosen.length - 1].line;
    const score = scoreBox();
    const slots = h('ol', { class: 'lo-slots' }, chosen.map((c, i) => h('li', { class: 'lo-slot' }, h('span', { class: 'lo-num' }, String(i + 1)), h('span', { class: 'lo-text' }, '…'))));
    const cardsEl = h('div', { class: 'lo-cards' });
    const placed = new Set();
    const msg = h('div', { class: 'gf-msg' });
    let waiting = null;
    let resolveWait = null;
    let nowKey = null;
    // Teams: each line is one team's turn, at the stop (js/views/turnbar.js).
    const T = ctx.turns?.active ? ctx.turns : null;
    let turnKey = null;
    const tried = new Set(); // cards a team said (and missed) on this line
    const cardOf = new Map();

    for (const c of shuffle(chosen)) {
      const b = h('button', { class: 'lo-card', type: 'button' }, c.line.pic && ctx.settings.showPics !== false ? `${c.line.pic} ` : '', c.line.text);
      b.addEventListener('click', () => choose(c, b));
      cardOf.set(c.key, b);
      cardsEl.append(b);
    }
    clear(main).append(h('div', { class: 'lo-wrap' }, h('div', { class: 'gf-top' }, h('div', { class: 'gf-progress' }, '🎧 Click the line you hear'), score.el), h('div', { class: 'lo-board' }, slots, cardsEl), msg));
    ctx.setBottom(null);

    // The line goes to its place (shown: nobody got it, so it is just shown).
    function place(c, shown = false) {
      placed.add(c.key);
      const slot = slots.children[chosen.indexOf(c)];
      slot.classList.add('done');
      if (shown) slot.classList.add('shown');
      slot.querySelector('.lo-text').textContent = c.line.text;
      const btn = cardOf.get(c.key);
      btn.classList.add('used');
      btn.disabled = true;
    }

    function choose(c, btn) {
      if (T) {
        // The team names the line at the stop; no early answers.
        if (waiting === null || turnKey !== waiting || !T.isOpen() || placed.has(c.key) || tried.has(c.key)) return;
        if (!T.ready()) { T.nudge(); return; }
        T.mark(c.key === waiting ? 'right' : 'wrong', { key: c.key });
        return;
      }
      const target = waiting !== null ? waiting : nowKey;
      const cc = centerOf(btn);
      if (c.key === target && !placed.has(c.key)) {
        place(c);
        // The automatic listening pause must not reduce credit for a correct answer.
        const pts = 10;
        score.add(pts);
        ctx.award(1);
        floatEmoji(`+${pts}`, cc.x, cc.y - 20, { size: 28 });
        sfx('correct', { volume: 0.45 });
        if (waiting !== null && resolveWait) { const r = resolveWait; resolveWait = null; setTimeout(r, 400); } else {
          const si = stops.findIndex((s) => s.key === c.key);
          if (si >= 0) runner.pass(si);
        }
        if (placed.size === chosen.length) setTimeout(done, 1200);
        return;
      }
      btn.classList.add('shake', 'nope');
      setTimeout(() => btn.classList.remove('shake', 'nope'), 450);
      score.add(-2, false);
      sfx('wrong', { volume: 0.35 });
    }

    function onTurn(o) {
      const key = turnKey;
      const c = chosen.find((x) => x.key === key);
      if (!c || placed.has(key)) return;
      if (!o.done) {
        const b = cardOf.get(o.meta.key);
        if (b) { tried.add(o.meta.key); b.classList.add('nope'); b.disabled = true; }
        return;
      }
      turnKey = null;
      for (const k of tried) { const b = cardOf.get(k); if (b && !placed.has(k)) { b.classList.remove('nope'); b.disabled = false; } }
      tried.clear();
      const ok = o.outcome === 'right' || o.outcome === 'stolen';
      place(c, !ok);
      if (ok) score.add(10); else score.breakStreak();
      if (waiting === key && resolveWait) { const r = resolveWait; resolveWait = null; setTimeout(r, ok ? 600 : 1200); }
      if (placed.size === chosen.length) setTimeout(done, 1500);
    }

    // Stop at the end of each chosen line's first appearance.
    const stops = chosen.map((c) => ({ key: c.key, line: c.line.index, at: Math.min(c.line.end - 0.02, c.line.singEnd + 0.2) }));
    const runner = lineStops(track, stops, (stop) => new Promise((resolve) => {
      if (placed.has(stop.key)) { resolve(); return; }
      // "Again" brings the music back to the same stop: the turn carries on.
      const again = waiting === stop.key;
      waiting = stop.key;
      msg.textContent = T ? '⏸ Which line was that? (R: again · S: show it)' : '⏸ Which line was that? (R: again)';
      resolveWait = () => { waiting = null; msg.textContent = ''; resolve(); };
      if (T && !(again && T.isOpen())) {
        turnKey = stop.key;
        T.open({ onOutcome: onTurn, prompt: 'Click the line they say' });
      }
    }));

    let raf = 0;
    let finished = false;
    const loop = () => {
      const t = track.time();
      const l = timeline.lines.find((x) => !x.instrumental && t >= x.start && t < x.end);
      nowKey = l ? l.text.toLowerCase().replace(/[^a-z' ]/g, '').trim() : null;
      if (nowKey && !keys.has(nowKey)) nowKey = null;
      if (t > lastLine.end + 0.5 && track.playing && !finished && placed.size === chosen.length) done();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    ctx.onKey((e) => {
      if (e.key.toLowerCase() === 'r') {
        const li = waiting !== null ? chosen.find((c) => c.key === waiting).line : timeline.lines.find((x) => track.time() < x.end);
        // While the music waits at a line: play it again and wait there again.
        const stop = waiting !== null ? stops.find((s) => s.key === waiting) : null;
        if (stop) track.setBarrier(stop.at);
        if (li) { track.seek(Math.max(0, li.start - 0.25)); track.play(); }
        return true;
      }
      return false;
    });

    function done() {
      if (finished) return;
      finished = true;
      track.pause();
      ctx.finish({ score: score.value, max: chosen.length * 10, emoji: '🧩', title: 'Song rebuilt!', text: 'Now sing it in the right order!', stars: stars(score.value / (chosen.length * 10)) });
    }
    const offEnd = track.on('end', done);
    if (T) T.idle();
    track.seek(0);
    track.play();
    cleanup = () => { cancelAnimationFrame(raf); runner.destroy(); offEnd(); };
  }
}
