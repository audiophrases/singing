/*
 * Rhyme memory: turn two cards - if the words rhyme, you keep them and go
 * again. Every card says its word aloud, so it is pronunciation practice too.
 */
import { h, clear, shuffle, seeded } from '../ui.js';
import { setupCard, choiceRow } from './common.js';
import { rhymePairs, rhymes } from '../lyrics/rhymes.js';
import { normWord } from '../lyrics/text.js';
import { rhymeFamily } from '../lyrics/wordlists.js';
import { getTeams, addPoints, setTeams } from '../store.js';
import { sfx, confetti } from '../sfx.js';
import { speak } from '../tts.js';

export function rhymeSet(timeline, count, rnd) {
  const pairs = rhymePairs(timeline).map((p) => [p.a, p.b]);
  const used = new Set(pairs.flat());
  // Song words with a rhyme family give more pairs.
  const words = [...new Set(timeline.lines.flatMap((l) => l.words.map((w) => normWord(w.text))))];
  for (const w of shuffle(words, rnd)) {
    if (pairs.length >= count) break;
    if (used.has(w)) continue;
    const fam = rhymeFamily(w);
    if (!fam) continue;
    const partner = shuffle(fam.filter((x) => x !== w && !used.has(x)), rnd)[0];
    if (!partner) continue;
    pairs.push([w, partner]);
    used.add(w);
    used.add(partner);
  }
  return shuffle(pairs, rnd).slice(0, count);
}

export async function start(ctx) {
  const { timeline, main, track } = ctx;
  const conf = { pairs: 6, say: true };
  const card = setupCard({
    emoji: '🃏',
    title: 'Rhyme memory',
    intro: 'Turn over two cards. If the words rhyme (star - car), keep them and play again. If not, it is the next team\'s turn!',
    body: h('div', null,
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Pairs'),
        choiceRow([[4, '4'], [6, '6'], [8, '8'], [10, '10']], conf.pairs, (v) => { conf.pairs = v; })),
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Say words'),
        choiceRow([[true, '🔊 Yes'], [false, '🔇 No']], conf.say, (v) => { conf.say = v; }))),
    onStart: () => { card.destroy(); begin(); },
  });
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function begin() {
    track.pause();
    const rnd = seeded(Date.now() % 1e6);
    const pairs = rhymeSet(timeline, conf.pairs, rnd);
    if (pairs.length < 3) {
      clear(main).append(h('div', { class: 'setup-card' }, h('h2', null, 'Not enough rhymes in this song'), h('a', { class: 'btn', href: `#/song/${encodeURIComponent(ctx.song.id)}` }, 'Back')));
      return;
    }
    const teams = getTeams();
    if (teams.on) { teams.showTurn = true; setTeams(teams); }
    const cards = shuffle(pairs.flatMap(([a, b], i) => [{ word: a, pair: i }, { word: b, pair: i }]), rnd);
    const grid = h('div', { class: 'rm-grid', style: { '--cols': cards.length > 12 ? 5 : 4 } });
    const status = h('div', { class: 'rm-status' });
    let open = [];
    let found = 0;
    let busy = false;
    let moves = 0;
    const turnText = () => {
      const t = getTeams();
      status.textContent = t.on ? `${t.list[(t.turn || 0) % t.list.length].emoji} ${t.list[(t.turn || 0) % t.list.length].name}'s turn` : `Pairs: ${found} / ${pairs.length} · Moves: ${moves}`;
    };
    cards.forEach((c) => {
      const el = h('button', { class: 'rm-card', type: 'button' }, h('span', { class: 'rm-back' }, '🎵'), h('span', { class: 'rm-front' }, c.word));
      el.addEventListener('click', () => flip(c, el));
      grid.append(el);
    });
    clear(main).append(h('div', { class: 'rm-wrap' }, status, grid));
    turnText();

    function flip(c, el) {
      if (busy || el.classList.contains('up') || el.classList.contains('done')) return;
      el.classList.add('up');
      if (conf.say) speak(c.word);
      open.push({ c, el });
      if (open.length < 2) return;
      moves += 1;
      const [a, b] = open;
      open = [];
      if (a.c.pair === b.c.pair || rhymes(a.c.word, b.c.word)) {
        found += a.c.pair === b.c.pair ? 1 : 0;
        a.el.classList.add('done');
        b.el.classList.add('done');
        sfx('correct', { volume: 0.5 });
        const t = getTeams();
        if (t.on) addPoints(t.list[(t.turn || 0) % t.list.length].id, 1);
        if (grid.querySelectorAll('.rm-card:not(.done)').length === 0) {
          confetti();
          setTimeout(() => ctx.finish({ emoji: '🃏', title: 'All pairs found!', text: `${moves} moves.`, stars: moves <= pairs.length * 1.5 ? 3 : moves <= pairs.length * 2.5 ? 2 : 1 }), 900);
        }
        turnText();
        return;
      }
      busy = true;
      sfx('wrong', { volume: 0.3 });
      setTimeout(() => {
        a.el.classList.remove('up');
        b.el.classList.remove('up');
        busy = false;
        const t = getTeams();
        if (t.on) { t.turn = ((t.turn || 0) + 1) % t.list.length; setTeams(t, { turn: t.turn }); }
        turnText();
      }, 1300);
    }
    cleanup = () => { const t = getTeams(); if (t.showTurn) { t.showTurn = false; setTeams(t); } };
  }
}
