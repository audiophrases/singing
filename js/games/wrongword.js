/*
 * Wrong word: one word in each line has been swapped for one that sounds
 * alike or belongs to the same topic (star -> car). Click the intruder while
 * you listen - before the line ends for full points.
 */
import { h, clear } from '../ui.js';
import { distractors, wordPool } from '../lyrics/gaps.js';
import { normWord } from '../lyrics/text.js';
import { STOPWORDS } from '../lyrics/wordlists.js';
import { lineStops, setupCard, choiceRow, scoreBox, lyricView, centerOf, stars } from './common.js';
import { sfx, floatEmoji } from '../sfx.js';
import { seeded } from '../ui.js';

export async function start(ctx) {
  const { track, timeline, main } = ctx;
  const conf = { every: 1 };
  const card = setupCard({
    emoji: '🕵️',
    title: 'Wrong word',
    intro: 'Read the lyrics while you listen. In each line one word is WRONG. Click it as fast as you can!',
    body: h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Lines'),
      choiceRow([[1, 'Every line'], [2, 'Every other line']], conf.every, (v) => { conf.every = v; })),
    onStart: () => { card.destroy(); begin(); },
  });
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function begin() {
    const seed = Math.floor(Math.random() * 1e6);
    const rnd = seeded(seed);
    const pool = wordPool(timeline);
    const fakes = new Map(); // line -> { wi, wrong, found }
    timeline.lines.filter((l) => !l.instrumental).forEach((l, k) => {
      if (k % conf.every !== 0) return;
      const cands = l.words.map((w, i) => i).filter((i) => {
        const n = normWord(l.words[i].text);
        return n.length >= 3 && !STOPWORDS.has(n);
      });
      if (!cands.length) return;
      const wi = cands[Math.floor(rnd() * cands.length)];
      const wrong = distractors(l.words[wi].text, { pool, count: 1, seed: seed + l.index, kind: 'listen' })[0];
      if (!wrong) return;
      fakes.set(l.index, { wi, wrong, found: false, missed: false });
    });
    const score = scoreBox();
    const progress = h('div', { class: 'gf-progress' });
    const total = fakes.size;
    const updateProgress = () => { progress.textContent = `${[...fakes.values()].filter((f) => f.found).length} / ${total} found`; };
    updateProgress();

    let waiting = null;
    let resolveWait = null;
    const render = (w, wi, line, where) => {
      const f = fakes.get(line.index);
      const trail = w.text.match(/[^A-Za-z0-9'’]+$/);
      const lead = w.text.match(/^[^A-Za-z0-9'’]+/);
      const isFake = f && f.wi === wi;
      if (isFake && (f.found || f.missed)) {
        return h('span', { class: 'w' }, lead ? lead[0] : '', h('s', { class: 'ww-wrong' }, f.wrong), ' ', h('span', { class: `ww-right${f.missed ? ' missed' : ''}` }, w.text.replace(/^[^A-Za-z0-9'’]+|[^A-Za-z0-9'’]+$/g, '')), trail ? trail[0] : '');
      }
      const text = isFake ? `${lead ? lead[0] : ''}${f.wrong}${trail ? trail[0] : ''}` : w.text;
      const el = h('button', { class: 'ww-word', type: 'button', disabled: where === 'prev' }, text);
      el.addEventListener('click', () => pick(line, wi, el));
      return el;
    };
    const view = lyricView(ctx, { render });
    const msg = h('div', { class: 'gf-msg' });
    clear(main).append(h('div', { class: 'gf-wrap' }, h('div', { class: 'gf-top' }, progress, score.el), view.el, msg));
    ctx.setBottom(null);

    function pick(line, wi, el) {
      const f = fakes.get(line.index);
      const c = centerOf(el);
      if (f && f.wi === wi && !f.found && !f.missed) {
        f.found = true;
        const pts = waiting === line.index ? 5 : 10;
        score.add(pts);
        floatEmoji(`+${pts}`, c.x, c.y - 30, { size: 30 });
        ctx.award(1);
        sfx('correct', { volume: 0.5 });
        updateProgress();
        view.refresh();
        const si = stops.findIndex((s) => s.line === line.index);
        if (waiting === line.index && resolveWait) { const r = resolveWait; resolveWait = null; setTimeout(r, 500); } else if (si >= 0) runner.pass(si);
        return;
      }
      el.classList.add('shake', 'nope');
      setTimeout(() => el.classList.remove('shake'), 400);
      score.add(-2, false);
      floatEmoji('-2', c.x, c.y - 30, { size: 26 });
      sfx('wrong', { volume: 0.35 });
    }

    const stops = [...fakes.keys()].sort((a, b) => a - b).map((li) => ({ line: li, at: Math.min(timeline.lines[li].end - 0.02, timeline.lines[li].singEnd + 0.15) }));
    const runner = lineStops(track, stops, (stop) => new Promise((resolve) => {
      const f = fakes.get(stop.line);
      if (!f || f.found) { resolve(); return; }
      waiting = stop.line;
      view.hold(stop.line);
      msg.textContent = '⏸ Which word is wrong? (R: listen again · S: show me)';
      resolveWait = () => { waiting = null; msg.textContent = ''; view.release(); resolve(); };
    }));

    ctx.onKey((e) => {
      const k = e.key.toLowerCase();
      if (k === 'r') {
        const li = waiting !== null ? waiting : Math.max(0, view.index);
        track.seek(Math.max(0, timeline.lines[li].start - 0.25));
        track.play();
        return true;
      }
      if (k === 's' && waiting !== null) {
        const f = fakes.get(waiting);
        f.missed = true;
        score.breakStreak();
        view.refresh();
        updateProgress();
        const r = resolveWait;
        resolveWait = null;
        setTimeout(r, 900);
        return true;
      }
      return false;
    });

    let raf = 0;
    const loop = () => { view.tick(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const offEnd = track.on('end', () => {
      const found = [...fakes.values()].filter((f) => f.found).length;
      ctx.finish({ score: score.value, max: total * 10, emoji: '🕵️', title: found === total ? 'Super detective!' : 'Case closed!', text: `${found} of ${total} wrong words found.`, stars: stars(score.value / (total * 10)) });
    });
    track.seek(0);
    track.play();
    cleanup = () => { cancelAnimationFrame(raf); runner.destroy(); offEnd(); };
  }
}
