/*
 * Freeze dance: do the action on the screen while the music plays. When the
 * music stops - FREEZE! Anyone who moves is out (or does a forfeit).
 * The actions are imperatives: jump, clap, turn around, touch your toes...
 */
import { h, clear, shuffle, seeded } from '../ui.js';
import { setupCard, choiceRow } from './common.js';
import { normWord } from '../lyrics/text.js';
import { sfx } from '../sfx.js';

export const ACTIONS = [
  ['Jump!', '🦘'], ['Clap your hands!', '👏'], ['Turn around!', '🔄'], ['Wave!', '👋'], ['Stomp your feet!', '🦶'],
  ['Touch your toes!', '🙇'], ['Hands up!', '🙌'], ['Dance like a robot!', '🤖'], ['Swim!', '🏊'], ['Fly like a bird!', '🦅'],
  ['Hop on one foot!', '🦩'], ['Shake your body!', '🫨'], ['Walk like a penguin!', '🐧'], ['March!', '💂'], ['Be a monkey!', '🐒'],
  ['Wiggle your fingers!', '🖐️'], ['Nod your head!', '🙂‍↕️'], ['Row your boat!', '🚣'], ['Play the guitar!', '🎸'], ['Be a tree!', '🌳'],
  ['Clap above your head!', '👏'], ['Spin like a ballerina!', '🩰'], ['Run on the spot!', '🏃'], ['Be a cat!', '🐱'], ['Make a big circle!', '⭕'],
];

const ACTION_WORDS = { clap: '👏', jump: '🦘', stomp: '🦶', wave: '👋', dance: '💃', swim: '🏊', fly: '🦅', row: '🚣', spin: '🌀', turn: '🔄', sleep: '😴', shake: '🫨', march: '💂', run: '🏃', sing: '🎤', swish: '🌧️', roar: '🦁', scream: '😱', shiver: '🥶', laugh: '😂' };

export async function start(ctx) {
  const { track, timeline, main } = ctx;
  const conf = { every: 2, freeze: 'medium' };
  const card = setupCard({
    emoji: '🧊',
    title: 'Freeze dance',
    intro: 'Stand up! Do the action on the screen. When the music stops: FREEZE like a statue! If you move, you sit down.',
    body: h('div', null,
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'New action'),
        choiceRow([[1, 'Every bar'], [2, 'Every 2 bars'], [4, 'Every 4 bars']], conf.every, (v) => { conf.every = v; })),
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Freezes'),
        choiceRow([['few', 'A few'], ['medium', 'Some'], ['many', 'Lots!']], conf.freeze, (v) => { conf.freeze = v; }))),
    onStart: () => { card.destroy(); begin(); },
  });
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function begin() {
    const rnd = seeded(Date.now() % 1e6);
    const deck = shuffle(ACTIONS, rnd);
    let di = 0;
    const action = h('div', { class: 'fz-action' });
    const lyric = h('div', { class: 'fz-lyric' });
    const freezeEl = h('div', { class: 'fz-freeze hidden' }, h('div', { class: 'fz-ice' }, '🧊'), h('div', { class: 'fz-word' }, 'FREEZE!'));
    clear(main).append(h('div', { class: 'fz-wrap' }, action, lyric, freezeEl));
    ctx.setBottom(null);

    const bar = (timeline.beat || 0.6) * (timeline.meter || 4);
    const span = bar * conf.every;
    let lastSlot = -1;
    let freezeTimer = 0;
    let frozen = false;
    let nextFreezeAt = 0;
    const gap = { few: [25, 45], medium: [12, 25], many: [6, 14] }[conf.freeze];
    const planFreeze = () => { nextFreezeAt = track.time() + gap[0] + rnd() * (gap[1] - gap[0]); };

    const show = (text, emoji) => {
      clear(action).append(h('div', { class: 'fz-emoji' }, emoji), h('div', { class: 'fz-text' }, text));
      action.classList.remove('pop');
      void action.offsetWidth;
      action.classList.add('pop');
    };

    const freeze = () => {
      frozen = true;
      track.pause();
      sfx('pop', { volume: 0.8 });
      freezeEl.classList.remove('hidden');
      const secs = 3 + rnd() * 3;
      freezeTimer = setTimeout(() => {
        freezeEl.classList.add('hidden');
        frozen = false;
        show('GO!', '🎉');
        planFreeze();
        track.play();
      }, secs * 1000);
    };

    let raf = 0;
    const loop = () => {
      const t = track.time();
      if (track.playing && !frozen) {
        // Words in the lyrics that are actions win over the deck.
        const l = timeline.lines.find((x) => t >= x.start && t < x.end);
        const w = l && l.words.find((x) => t >= x.start - 0.1 && t < x.end + 0.3 && ACTION_WORDS[normWord(x.text)]);
        const slot = Math.floor(t / span);
        if (w) {
          const n = normWord(w.text);
          if (action.dataset.word !== n) { action.dataset.word = n; show(`${n.toUpperCase()}!`, ACTION_WORDS[n]); }
        } else if (slot !== lastSlot) {
          lastSlot = slot;
          const [text, emoji] = deck[di++ % deck.length];
          action.dataset.word = '';
          show(text, emoji);
        }
        lyric.textContent = l && !l.instrumental ? l.text : '';
        if (nextFreezeAt && t >= nextFreezeAt) freeze();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    ctx.onKey((e) => {
      if (e.key.toLowerCase() === 'z' || e.key === 'Enter') { if (!frozen && track.playing) freeze(); return true; }
      return false;
    });
    const offEnd = track.on('end', () => ctx.finish({ emoji: '🕺', title: 'Great dancing!', text: 'Who is still standing? They are the champions!', stars: 3 }));
    track.seek(0);
    planFreeze();
    track.play();
    cleanup = () => { cancelAnimationFrame(raf); clearTimeout(freezeTimer); offEnd(); };
  }
}
