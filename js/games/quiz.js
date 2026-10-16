/*
 * Song quiz: quick multiple-choice questions made from the song itself -
 * complete the line, what comes next, rhymes, verb forms, pictures.
 * Teams take turns; keys 1-4 answer.
 */
import { h, clear, add, shuffle, seeded } from '../ui.js';
import { setupCard, choiceRow, scoreBox, stars } from './common.js';
import { rhymePairs, rhymes } from '../lyrics/rhymes.js';
import { distractors, wordPool } from '../lyrics/gaps.js';
import { categoryById, baseForm } from '../lyrics/grammar.js';
import { normWord } from '../lyrics/text.js';
import { STOPWORDS, IRREGULAR_PAST } from '../lyrics/wordlists.js';
import { getTeams, addPoints, setTeams } from '../store.js';
import { sfx, confetti } from '../sfx.js';

export function makeQuestions(timeline, rnd, count = 10) {
  const seen = new Set();
  const lines = timeline.lines.filter((l) => {
    if (l.instrumental || l.words.length < 3) return false;
    const k = l.text.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const pool = wordPool(timeline);
  const content = pool.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const qs = [];
  const add = (q) => { if (q && q.options.length >= 3 && new Set(q.options.map((o) => o.toLowerCase())).size === q.options.length) qs.push(q); };

  // Complete the line.
  for (const l of shuffle(lines, rnd).slice(0, 5)) {
    const last = l.words[l.words.length - 1].text.replace(/[^A-Za-z'’-]/g, '');
    if (normWord(last).length < 2) continue;
    const wrong = distractors(last, { pool, count: 3, seed: Math.floor(rnd() * 1e6), kind: 'listen' });
    const head = l.words.slice(0, -1).map((w) => w.text).join(' ');
    add({ kind: 'complete', emoji: '🎵', q: `Complete the line:\n"${head} ___"`, answer: last, options: shuffle([last, ...wrong], rnd), line: l });
  }
  // What comes next?
  for (let i = 0; i < lines.length - 1 && qs.filter((q) => q.kind === 'next').length < 3; i += 1) {
    if (rnd() < 0.5) continue;
    const right = lines[i + 1].text;
    const others = shuffle(lines.filter((x, k) => k !== i + 1 && k !== i), rnd).slice(0, 3).map((x) => x.text);
    add({ kind: 'next', emoji: '⏭️', q: `What comes after:\n"${lines[i].text}"`, answer: right, options: shuffle([right, ...others], rnd), long: true, line: lines[i + 1] });
  }
  // Rhymes.
  for (const p of shuffle(rhymePairs(timeline), rnd).slice(0, 3)) {
    const wrong = shuffle(content.filter((w) => w !== p.a && w !== p.b && !rhymes(w, p.a)), rnd).slice(0, 3);
    add({ kind: 'rhyme', emoji: '🎶', q: `Which word rhymes with "${p.a}"?`, answer: p.b, options: shuffle([p.b, ...wrong], rnd) });
  }
  // Verb forms.
  const past = categoryById('past');
  for (const w of shuffle(content.filter((x) => past.test(x)), rnd).slice(0, 2)) {
    const base = baseForm(w);
    const opts = IRREGULAR_PAST.has(w) ? [base, w, `${base}ed`, `${base}s`] : [base, w, `${base}ing`, `${base}s`];
    add({ kind: 'verb', emoji: '⏪', q: `In the song we hear "${w}". What is the present (base) form?`, answer: base, options: shuffle([...new Set(opts)], rnd) });
  }
  // Pictures.
  const withPics = lines.filter((l) => l.pic);
  const picsSeen = new Set();
  for (const l of shuffle(withPics, rnd)) {
    if (picsSeen.has(l.pic) || qs.filter((q) => q.kind === 'pic').length >= 2) continue;
    picsSeen.add(l.pic);
    const others = shuffle(withPics.filter((x) => x.pic !== l.pic), rnd);
    const opts = [];
    for (const o of others) if (!opts.includes(o.pic) && opts.length < 3) opts.push(o.pic);
    if (opts.length < 2) continue;
    add({ kind: 'pic', emoji: '🖼️', q: `Which picture goes with:\n"${l.text}"`, answer: l.pic, options: shuffle([l.pic, ...opts], rnd), big: true });
  }
  // In the song?
  if (content.length >= 4) {
    const fake = distractors(shuffle(content, rnd)[0], { pool: [], count: 1, seed: Math.floor(rnd() * 1e6), kind: 'listen' })[0];
    if (fake && !pool.includes(normWord(fake))) {
      const real = shuffle(content, rnd).slice(0, 3);
      add({ kind: 'odd', emoji: '🕵️', q: 'Which word is NOT in the song?', answer: fake, options: shuffle([fake, ...real], rnd) });
    }
  }
  return shuffle(qs, rnd).slice(0, count);
}

const COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c'];
const SHAPES = ['▲', '◆', '●', '■'];

export async function start(ctx) {
  const { timeline, main, track } = ctx;
  const conf = { count: 10, timer: 20 };
  const card = setupCard({
    emoji: '❓',
    title: 'Song quiz',
    intro: 'Questions about the words of the song. Answer with the mouse or the keys 1, 2, 3 and 4. In teams, each team gets a question in turn.',
    body: h('div', null,
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Questions'),
        choiceRow([[5, '5'], [10, '10'], [15, '15']], conf.count, (v) => { conf.count = v; })),
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Timer'),
        choiceRow([[0, 'None'], [10, '10 s'], [20, '20 s'], [30, '30 s']], conf.timer, (v) => { conf.timer = v; }))),
    onStart: () => { card.destroy(); begin(); },
  });
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function begin() {
    track.pause();
    const rnd = seeded(Date.now() % 1e6);
    const qs = makeQuestions(timeline, rnd, conf.count);
    if (!qs.length) {
      clear(main).append(h('div', { class: 'setup-card' }, h('h2', null, 'No questions for this song yet')));
      return;
    }
    const teams = getTeams();
    if (teams.on) { teams.showTurn = true; setTeams(teams); }
    const score = scoreBox();
    let qi = 0;
    let answered = false;
    let timerRaf = 0;
    let right = 0;
    const area = h('div', { class: 'quiz-wrap' });
    clear(main).append(area);

    const show = () => {
      answered = false;
      const q = qs[qi];
      const t = getTeams();
      const who = t.on ? t.list[(t.turn || 0) % t.list.length] : null;
      const timerFill = h('div', { class: 'fin-timer-fill' });
      const opts = h('div', { class: `quiz-options${q.long ? ' long' : ''}${q.big ? ' big' : ''}` }, q.options.map((o, i) => {
        const b = h('button', { class: 'quiz-opt', type: 'button', style: { '--opt': COLORS[i] } }, h('span', { class: 'qo-shape' }, SHAPES[i]), h('span', { class: 'qo-text' }, o));
        b.addEventListener('click', () => answer(i, b, opts));
        return b;
      }));
      add(clear(area),
        h('div', { class: 'gf-top' }, h('div', { class: 'gf-progress' }, `Question ${qi + 1} / ${qs.length}${who ? ` · ${who.emoji} ${who.name}` : ''}`), score.el),
        h('div', { class: 'quiz-q' }, h('span', { class: 'quiz-emoji' }, q.emoji), h('div', { class: 'quiz-text' }, q.q)),
        q.line ? h('button', { class: 'btn', type: 'button', onclick: () => { track.setBarrier(q.line.singEnd + 0.2); track.seek(Math.max(0, q.line.start - 0.2)); track.play(); } }, '🎵 Listen') : null,
        conf.timer ? h('div', { class: 'fin-timer' }, timerFill) : null,
        opts,
        h('div', { class: 'quiz-next' }),
      );
      cancelAnimationFrame(timerRaf);
      if (conf.timer) {
        const t0 = performance.now();
        const step = () => {
          const left = conf.timer - (performance.now() - t0) / 1000;
          timerFill.style.width = `${Math.max(0, (left / conf.timer) * 100)}%`;
          if (left <= 0) { answer(-1, null, opts); return; }
          timerRaf = requestAnimationFrame(step);
        };
        timerRaf = requestAnimationFrame(step);
      }
    };

    const answer = (i, btn, opts) => {
      if (answered) return;
      answered = true;
      cancelAnimationFrame(timerRaf);
      const q = qs[qi];
      const ok = i >= 0 && q.options[i] === q.answer;
      [...opts.children].forEach((b, k) => {
        b.disabled = true;
        if (q.options[k] === q.answer) b.classList.add('correct');
        else if (k === i) b.classList.add('wrong');
        else b.classList.add('dim');
      });
      const t = getTeams();
      if (ok) {
        right += 1;
        score.add(10);
        sfx('correct', { volume: 0.5 });
        if (t.on) addPoints(t.list[(t.turn || 0) % t.list.length].id, 1);
      } else {
        score.breakStreak();
        sfx('wrong', { volume: 0.4 });
      }
      const next = area.querySelector('.quiz-next');
      next.append(h('button', { class: 'btn primary btn-lg', type: 'button', onclick: goNext }, qi + 1 < qs.length ? 'Next ▶' : '🏁 Results'));
    };

    const goNext = () => {
      track.pause();
      const t = getTeams();
      if (t.on) { t.turn = ((t.turn || 0) + 1) % t.list.length; setTeams(t, { turn: t.turn }); }
      qi += 1;
      if (qi >= qs.length) {
        if (right === qs.length) confetti();
        ctx.finish({ score: right, max: qs.length, emoji: '❓', title: right === qs.length ? 'Quiz champions!' : 'Quiz finished!', text: `${right} of ${qs.length} right.`, stars: stars(right / qs.length) });
        return;
      }
      show();
    };

    ctx.onKey((e) => {
      if (/^[1-4]$/.test(e.key)) {
        const b = area.querySelectorAll('.quiz-opt')[Number(e.key) - 1];
        if (b && !b.disabled) b.click();
        return true;
      }
      if (e.key === 'Enter' && answered) { goNext(); return true; }
      return false;
    });
    show();
    cleanup = () => { cancelAnimationFrame(timerRaf); const t = getTeams(); if (t.showTurn) { t.showTurn = false; setTeams(t); } };
  }
}
