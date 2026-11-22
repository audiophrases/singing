/*
 * Wrong word: one word in each line has been swapped for one that sounds
 * alike or belongs to the same topic (star -> car). Click the intruder while
 * you listen - before the line ends for full points.
 *
 * In teams each line is one team's turn (js/views/turnbar.js): the music
 * waits at the end of the line and the teacher clicks the word the team names.
 */
import { h, clear } from '../ui.js';
import { distractors, wordPool, matchCase } from '../lyrics/gaps.js';
import { lessonOf, lessonSwaps } from '../lesson/pack.js';
import { normWord } from '../lyrics/text.js';
import { STOPWORDS } from '../lyrics/wordlists.js';
import { lineStops, setupCard, choiceRow, scoreBox, lyricView, centerOf, stars } from './common.js';
import { sfx, floatEmoji } from '../sfx.js';
import { seeded } from '../ui.js';

export async function start(ctx) {
  const { track, timeline, main } = ctx;
  const swaps = lessonSwaps(timeline, lessonOf(ctx.song));
  const conf = { every: 1, source: swaps.size ? 'pack' : 'auto' };
  const card = setupCard({
    emoji: '🕵️',
    title: 'Wrong word',
    intro: 'Read the lyrics while you listen. In each line one word is WRONG. Click it as fast as you can! In teams, each team names the wrong word of a line in turn.',
    body: h('div', null,
      swaps.size ? h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Wrong words'),
        choiceRow([['pack', `🧠 AI pack (${swaps.size} lines)`], ['auto', '🤖 Made by Singing']], conf.source, (v) => { conf.source = v; })) : null,
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Lines'),
        choiceRow([[1, 'Every line'], [2, 'Every other line']], conf.every, (v) => { conf.every = v; })),
      ctx.turns?.setup()),
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
    if (conf.source === 'pack') {
      for (const [index, swap] of swaps) {
        const word = timeline.lines[index].words[swap.wi].text.replace(/^[^A-Za-z']+/, '');
        fakes.set(index, { ...swap, wrong: matchCase(word, swap.wrong), found: false, missed: false, tried: new Set() });
      }
    } else timeline.lines.filter((l) => !l.instrumental).forEach((l, k) => {
      if (k % conf.every !== 0) return;
      const cands = l.words.map((w, i) => i).filter((i) => {
        const n = normWord(l.words[i].text);
        return n.length >= 3 && !STOPWORDS.has(n) && !l.words[i].text.includes('*');
      });
      if (!cands.length) return;
      const wi = cands[Math.floor(rnd() * cands.length)];
      const wrong = distractors(l.words[wi].text, { pool, count: 1, seed: seed + l.index, kind: 'listen' })[0];
      if (!wrong) return;
      fakes.set(l.index, { wi, wrong, found: false, missed: false, tried: new Set() });
    });
    const score = scoreBox();
    const progress = h('div', { class: 'gf-progress' });
    const total = fakes.size;
    const updateProgress = () => { progress.textContent = `${[...fakes.values()].filter((f) => f.found).length} / ${total} found`; };
    updateProgress();

    let waiting = null;
    let resolveWait = null;
    // Teams: each line is one team's turn, at the stop (js/views/turnbar.js).
    const T = ctx.turns?.active ? ctx.turns : null;
    let turnLine = null;
    const render = (w, wi, line, where) => {
      const f = fakes.get(line.index);
      const trail = w.text.match(/[^A-Za-z0-9'’]+$/);
      const lead = w.text.match(/^[^A-Za-z0-9'’]+/);
      const isFake = f && f.wi === wi;
      if (isFake && (f.found || f.missed)) {
        return h('span', { class: 'w' }, lead ? lead[0] : '', h('s', { class: 'ww-wrong' }, f.wrong), ' ', h('span', { class: `ww-right${f.missed ? ' missed' : ''}` }, w.text.replace(/^[^A-Za-z0-9'’]+|[^A-Za-z0-9'’]+$/g, '')), trail ? trail[0] : '');
      }
      const text = isFake ? `${lead ? lead[0] : ''}${f.wrong}${trail ? trail[0] : ''}` : w.text;
      // A word a team said (and missed) stays red for the steal.
      const said = !!f?.tried.has(wi);
      const el = h('button', { class: `ww-word${said ? ' nope' : ''}`, type: 'button', disabled: where === 'prev' || said }, text);
      el.addEventListener('click', () => pick(line, wi, el));
      return el;
    };
    const view = lyricView(ctx, { render });
    const msg = h('div', { class: 'gf-msg' });
    const why = h('div', { class: 'gf-why' });
    clear(main).append(h('div', { class: 'gf-wrap' }, h('div', { class: 'gf-top' }, progress, score.el), view.el, msg, why));
    ctx.setBottom(null);

    function pick(line, wi, el) {
      const f = fakes.get(line.index);
      if (T) {
        // The team names the word at the stop; no early answers.
        if (waiting !== line.index || turnLine !== line.index || !T.isOpen() || !f || f.found || f.missed) return;
        if (!T.ready()) { T.nudge(); return; }
        T.mark(f.wi === wi ? 'right' : 'wrong', { wi });
        return;
      }
      const c = centerOf(el);
      if (f && f.wi === wi && !f.found && !f.missed) {
        f.found = true;
        why.textContent = f.why ? `💡 ${f.why}` : '';
        const pts = waiting === line.index ? 5 : 10;
        score.add(pts);
        floatEmoji(`+${pts}`, c.x, c.y - 30, { size: 30 });
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

    function onTurn(o) {
      const li = turnLine;
      const f = fakes.get(li);
      if (!f || f.found || f.missed) return;
      if (!o.done) {
        if (o.meta.wi !== undefined) { f.tried.add(o.meta.wi); view.refresh(); }
        return;
      }
      turnLine = null;
      const ok = o.outcome === 'right' || o.outcome === 'stolen';
      if (ok) { f.found = true; score.add(10); } else { f.missed = true; score.breakStreak(); }
      why.textContent = f.why ? `💡 ${f.why}` : '';
      updateProgress();
      view.refresh();
      if (waiting === li && resolveWait) { const r = resolveWait; resolveWait = null; setTimeout(r, ok ? 700 : 1300); }
    }

    const stops = [...fakes.keys()].sort((a, b) => a - b).map((li) => ({ line: li, at: Math.min(timeline.lines[li].end - 0.02, timeline.lines[li].singEnd + 0.15) }));
    const runner = lineStops(track, stops, (stop) => new Promise((resolve) => {
      const f = fakes.get(stop.line);
      if (!f || f.found || f.missed) { resolve(); return; }
      // "Again" brings the music back to the same stop: the turn carries on.
      const again = waiting === stop.line;
      waiting = stop.line;
      view.hold(stop.line);
      msg.textContent = '⏸ Which word is wrong? (R: listen again · S: show me)';
      resolveWait = () => { waiting = null; msg.textContent = ''; view.release(); resolve(); };
      if (T && !(again && T.isOpen())) {
        turnLine = stop.line;
        T.open({ onOutcome: onTurn, prompt: 'Click the word they say' });
      }
    }));

    ctx.onKey((e) => {
      const k = e.key.toLowerCase();
      if (k === 'r') {
        const li = waiting !== null ? waiting : Math.max(0, view.index);
        // While the music waits at a line: play it again and wait there again.
        const stop = waiting !== null ? stops.find((s) => s.line === waiting) : null;
        if (stop) track.setBarrier(stop.at);
        track.seek(Math.max(0, timeline.lines[li].start - 0.25));
        track.play();
        return true;
      }
      // In teams the banner's S shows the answer (and ends the turn).
      if (k === 's' && waiting !== null && !T) {
        const f = fakes.get(waiting);
        f.missed = true;
        why.textContent = f.why ? `💡 ${f.why}` : '';
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
    if (T) T.idle();
    track.seek(0);
    track.play();
    cleanup = () => { cancelAnimationFrame(raf); runner.destroy(); offEnd(); };
  }
}
