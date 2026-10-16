/*
 * Hot mic: pass a real object (the "mic") around while the music plays.
 * When it stops, whoever holds it gets a card: sing the next line, find a
 * rhyme, say a past tense, sing it like a robot...
 */
import { h, clear, shuffle, pick, seeded } from '../ui.js';
import { setupCard, choiceRow } from './common.js';
import { rhymePairs, rhymesFrom } from '../lyrics/rhymes.js';
import { categoryById, baseForm } from '../lyrics/grammar.js';
import { normWord } from '../lyrics/text.js';
import { STOPWORDS, IRREGULAR_VERBS, rhymeFamily } from '../lyrics/wordlists.js';
import { getTeams, addPoints } from '../store.js';
import { sfx } from '../sfx.js';
import { speak } from '../tts.js';

const STYLES_OF_SINGING = [
  ['like an opera singer', '🎭'], ['like a robot', '🤖'], ['like a baby', '👶'], ['whispering', '🤫'],
  ['like a cowboy', '🤠'], ['very, very slowly', '🐢'], ['like a monster', '👹'], ['like a rock star', '🎸'],
  ['like you are very sad', '😢'], ['like you are very happy', '😄'], ['like a pirate', '🏴‍☠️'], ['with your nose closed', '👃'],
];

export function makeCards(timeline, song, rnd = Math.random) {
  const lines = timeline.lines.filter((l) => !l.instrumental && l.words.length >= 2);
  const words = [...new Set(lines.flatMap((l) => l.words.map((w) => normWord(w.text))).filter((w) => w.length >= 3 && !STOPWORDS.has(w)))];
  const vocab = (song.vocab || []).length ? song.vocab : words.slice(0, 15);
  const past = categoryById('past');
  const pastWords = words.filter((w) => past.test(w));
  const pairs = rhymePairs(timeline);
  const rhymable = [...new Set([...pairs.flatMap((p) => [p.a, p.b]), ...words.filter((w) => rhymeFamily(w))])];
  const cards = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    cards.push({ type: 'next', emoji: '🎤', title: 'Sing the next line!', body: `"${lines[i].text}"`, answer: lines[i + 1].text });
  }
  for (const w of rhymable) {
    const ans = rhymesFrom(w, words).slice(0, 4);
    cards.push({ type: 'rhyme', emoji: '🎶', title: 'Rhyme time!', body: `Say a word that rhymes with "${w}".`, answer: ans.length ? `For example: ${ans.join(', ')}` : '' });
  }
  for (const w of pastWords) {
    cards.push({ type: 'past', emoji: '⏪', title: 'Past or present?', body: `"${w}" is in the song. What is the present form?`, answer: baseForm(w) });
  }
  for (const [base, p] of shuffle(IRREGULAR_VERBS, rnd).slice(0, 6)) {
    cards.push({ type: 'past', emoji: '⏪', title: 'Irregular verb!', body: `What is the past of "${base}"?`, answer: p });
  }
  for (const w of vocab) {
    cards.push({ type: 'spell', emoji: '🔤', title: 'Spell it!', body: `Spell "${w}" letter by letter.`, answer: w.toUpperCase().split('').join(' - '), say: w });
    cards.push({ type: 'sentence', emoji: '💬', title: 'Make a sentence', body: `Make a sentence with "${w}".`, answer: '' });
    cards.push({ type: 'mime', emoji: '🎭', title: 'Mime it!', body: 'Mime the secret word. The class guesses!', secret: w, answer: w });
  }
  for (const [how, emoji] of STYLES_OF_SINGING) {
    const l = pick(lines, rnd);
    cards.push({ type: 'style', emoji, title: `Sing it ${how}!`, body: `"${l.text}"`, answer: '' });
  }
  cards.push({ type: 'wild', emoji: '🃏', title: 'Wild card!', body: 'Choose a friend. Sing the first line together!', answer: '' });
  cards.push({ type: 'wild', emoji: '🙋', title: 'Question time', body: 'Ask someone a question about the song. They answer!', answer: '' });
  cards.push({ type: 'wild', emoji: '💃', title: 'Dance break!', body: 'Everybody dance for 10 seconds!', answer: '' });
  return cards;
}

const TYPES = [
  ['next', '🎤 Next line'], ['rhyme', '🎶 Rhymes'], ['past', '⏪ Verbs'], ['spell', '🔤 Spelling'],
  ['sentence', '💬 Sentences'], ['mime', '🎭 Mime'], ['style', '🎭 Silly singing'], ['wild', '🃏 Wild cards'],
];

export async function start(ctx) {
  const { track, timeline, main, song } = ctx;
  const conf = { min: 6, max: 18, types: new Set(TYPES.map((t) => t[0])) };
  const typeBoxes = h('div', { class: 'type-boxes' }, TYPES.map(([id, label]) => {
    const input = h('input', { type: 'checkbox', checked: true });
    input.addEventListener('change', () => { if (input.checked) conf.types.add(id); else conf.types.delete(id); });
    return h('label', { class: 'inline' }, input, label);
  }));
  const card = setupCard({
    emoji: '🔥',
    title: 'Hot mic',
    intro: 'Pass something round the class (a ball, a pencil... the "mic") while the music plays. When the music stops, the person holding it gets a card!',
    body: h('div', null,
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Music stops'),
        choiceRow([['fast', 'Fast (3-10 s)'], ['medium', 'Medium (6-18 s)'], ['slow', 'Slow (10-30 s)']], 'medium', (v) => { [conf.min, conf.max] = { fast: [3, 10], medium: [6, 18], slow: [10, 30] }[v]; })),
      typeBoxes),
    onStart: () => { card.destroy(); begin(); },
  });
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function begin() {
    const rnd = seeded(Date.now() % 1e6);
    let deck = shuffle(makeCards(timeline, song, rnd).filter((c) => conf.types.has(c.type)), rnd);
    if (!deck.length) deck = shuffle(makeCards(timeline, song, rnd), rnd);
    let di = 0;
    const area = h('div', { class: 'hm-area' });
    clear(main).append(area);
    ctx.setBottom(null);
    let timer = 0;

    const passing = () => {
      clear(area).append(h('div', { class: 'hm-pass' },
        h('div', { class: 'hm-mic' }, '🎤'),
        h('div', { class: 'hm-title' }, 'Pass the mic!'),
        h('div', { class: 'small' }, 'Keep passing… the music can stop at any moment!')));
      // Start somewhere random in the song; loop at the end.
      if (!track.playing) {
        if (track.time() > track.duration - 8) track.seek(0);
        track.play();
      }
      clearTimeout(timer);
      const secs = conf.min + rnd() * (conf.max - conf.min);
      timer = setTimeout(stopMusic, secs * 1000);
    };

    const stopMusic = () => {
      track.pause();
      sfx('pop', { volume: 0.7 });
      const c = deck[di % deck.length];
      di += 1;
      const answer = h('div', { class: 'hm-answer hidden' }, c.answer ? `💡 ${c.answer}` : '');
      const teams = getTeams();
      const actions = h('div', { class: 'row', style: { justifyContent: 'center' } });
      if (teams.on) {
        for (const t of teams.list) actions.append(h('button', { class: 'btn team-btn', type: 'button', style: { '--team-hue': t.hue }, onclick: () => { addPoints(t.id, 1); sfx('correct', { volume: 0.5 }); passing(); } }, `+1 ${t.emoji} ${t.name}`));
      } else {
        actions.append(h('button', { class: 'btn success btn-lg', type: 'button', onclick: () => { sfx('correct', { volume: 0.5 }); passing(); } }, '✅ Done!'));
      }
      actions.append(h('button', { class: 'btn btn-lg', type: 'button', onclick: () => passing() }, '⏭ Next'));
      const secret = c.secret ? h('button', { class: 'btn', type: 'button', onclick: (e) => { e.currentTarget.textContent = `🤫 ${c.secret}`; } }, '👀 Show the secret word (only to the mime!)') : null;
      clear(area).append(h('div', { class: 'hm-card' },
        h('div', { class: 'hm-card-emoji' }, c.emoji),
        h('div', { class: 'hm-card-title' }, c.title),
        h('div', { class: 'hm-card-body' }, c.body),
        secret,
        c.say ? h('button', { class: 'btn', type: 'button', onclick: () => speak(c.say) }, '🔊 Hear the word') : null,
        c.answer && !c.secret ? h('button', { class: 'btn', type: 'button', onclick: () => answer.classList.remove('hidden') }, 'Show the answer') : null,
        answer,
        actions));
    };

    ctx.onKey((e) => {
      if (e.key === 'Enter') { if (track.playing) stopMusic(); else passing(); return true; }
      return false;
    });
    const offEnd = track.on('end', () => { track.seek(0); track.play(); });
    passing();
    cleanup = () => { clearTimeout(timer); offEnd(); };
  }
}
