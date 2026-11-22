/*
 * Rhyme memory: turn two cards - if the words rhyme, you keep them and go
 * again. Every card says its word aloud, so it is pronunciation practice too.
 *
 * In teams it always plays in turn order (js/views/turnbar.js): the team
 * chooses two cards, the teacher turns them; a pair is 2 points and the team
 * goes again, no pair and it is the next team's turn. No steals.
 */
import { h, clear, shuffle, seeded } from '../ui.js';
import { setupCard, choiceRow } from './common.js';
import { rhymePairs, rhymes } from '../lyrics/rhymes.js';
import { normWord } from '../lyrics/text.js';
import { rhymeFamily } from '../lyrics/wordlists.js';
import { sfx, confetti } from '../sfx.js';
import { speak } from '../tts.js';
import { lessonOf, orderSets, pickSet, readAloud, setLabel } from '../lesson/pack.js';
import { POINTS } from './turns.js';

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
  const sets = orderSets(lessonOf(ctx.song)?.pairs);
  const conf = { pairs: 6, say: true, set: pickSet(sets, ctx.settings.packLevel)?.id || '' };
  const card = setupCard({
    emoji: '🃏',
    title: 'Rhyme memory',
    intro: sets.length ? 'Turn over two cards. If they match, keep them and play again. If not, it is the next team\'s turn!' : 'Turn over two cards. If the words rhyme (star - car), keep them and play again. If not, it is the next team\'s turn!',
    body: h('div', null,
      sets.length ? h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Cards'),
        choiceRow([...sets.map((s) => [s.id, setLabel(s, '🃏')]), ['', '🎶 Rhymes']], conf.set, (v) => { conf.set = v; })) : null,
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Pairs'),
        choiceRow([[4, '4'], [6, '6'], [8, '8'], [10, '10']], conf.pairs, (v) => { conf.pairs = v; })),
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Say words'),
        choiceRow([[true, '🔊 Yes'], [false, '🔇 No']], conf.say, (v) => { conf.say = v; })),
      ctx.turns?.setup({ only: true, note: (next) => `${next.emoji} ${next.name} starts. The team chooses two cards and you turn them: a pair is ${POINTS.own} points and the team goes again; no pair, and it is the next team's turn. 🤷 Pass (P) loses the turn.` })),
    onStart: () => { card.destroy(); begin(); },
  });
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function begin() {
    track.pause();
    const rnd = seeded(Date.now() % 1e6);
    const set = sets.find((s) => s.id === conf.set);
    const pairs = set ? shuffle(set.pairs, rnd).slice(0, conf.pairs).map((p) => [p.a, p.b]) : rhymeSet(timeline, conf.pairs, rnd);
    if (pairs.length < 3) {
      clear(main).append(h('div', { class: 'setup-card' }, h('h2', null, 'Not enough rhymes in this song'), h('a', { class: 'btn', href: `#/song/${encodeURIComponent(ctx.song.id)}` }, 'Back')));
      return;
    }
    const cards = shuffle(pairs.flatMap(([a, b], i) => [{ word: a, pair: i, side: 'a' }, { word: b, pair: i, side: 'b' }]), rnd);
    const grid = h('div', { class: 'rm-grid', style: { '--cols': cards.length > 12 ? 5 : 4 } });
    const status = h('div', { class: 'rm-status' });
    let open = [];
    let found = 0;
    let busy = false;
    let moves = 0;
    // Teams: each go is one team's turn; the banner says whose.
    const T = ctx.turns?.active ? ctx.turns : null;
    const left = () => grid.querySelectorAll('.rm-card:not(.done)').length;
    const turnText = () => { status.textContent = `Pairs: ${found} / ${pairs.length} · Moves: ${moves}`; };
    const turn = {
      mode: 'turns',
      steal: false,
      keep: true,
      prompt: 'Click the two cards they choose',
      show: false,
      onOutcome: (o) => onTurn(o),
      flash: (o) => (o.points ? null : o.result === 'wrong' ? '❌ No match. Next team!' : o.result === 'timeout' ? '⏰ Time\'s up! Next team' : '🤷 Next team'),
    };
    function onTurn(o) {
      if (!o.done) return;
      // A pass (or time's up) with one card turned: turn it back.
      if (!o.meta.pair) { for (const x of open) x.el.classList.remove('up'); open = []; }
      if (!left()) return;
      setTimeout(() => { if (grid.isConnected && left() && !T.isOpen()) T.open(turn); }, o.result === 'wrong' ? 1400 : 800);
    }
    cards.forEach((c) => {
      const el = h('button', { class: `rm-card${c.word.length > 14 ? ' wordy' : ''}`, type: 'button' }, h('span', { class: 'rm-back' }, '🎵'), h('span', { class: 'rm-front' }, c.word));
      el.addEventListener('click', () => flip(c, el));
      grid.append(el);
    });
    clear(main).append(h('div', { class: 'rm-wrap' }, status, grid));
    turnText();

    function flip(c, el) {
      if (busy || el.classList.contains('up') || el.classList.contains('done')) return;
      if (T && !T.isOpen()) return; // between turns
      el.classList.add('up');
      if (conf.say && readAloud(set, c.side)) speak(c.word);
      open.push({ c, el });
      if (open.length < 2) return;
      moves += 1;
      const [a, b] = open;
      open = [];
      if (a.c.pair === b.c.pair || (!set && rhymes(a.c.word, b.c.word))) {
        found += a.c.pair === b.c.pair ? 1 : 0;
        a.el.classList.add('done');
        b.el.classList.add('done');
        if (T) T.mark('right', { pair: true }); // the banner scores it: the team goes again
        else sfx('correct', { volume: 0.5 });
        if (!left()) {
          confetti();
          setTimeout(() => ctx.finish({ emoji: '🃏', title: 'All pairs found!', text: `${moves} moves.`, stars: moves <= pairs.length * 1.5 ? 3 : moves <= pairs.length * 2.5 ? 2 : 1 }), 900);
        }
        turnText();
        return;
      }
      busy = true;
      // A miss ends the team's turn (a pair lets it go again).
      if (T) T.mark('wrong', { pair: true });
      else sfx('wrong', { volume: 0.3 });
      setTimeout(() => {
        a.el.classList.remove('up');
        b.el.classList.remove('up');
        busy = false;
        turnText();
      }, 1300);
    }
    if (T) T.open(turn);
    cleanup = () => {};
  }
}
