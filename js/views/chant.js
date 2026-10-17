/*
 * Song maker: type any English text, choose a mood, and Singing composes a
 * tune and chords for it - ready for karaoke and every game.
 */
import { h, clear, toast } from '../ui.js';
import { composeSong, MOODS } from '../music/composer.js';
import { SynthTrack } from '../music/player.js';
import { compileSong } from '../music/score.js';
import { transportBar, knobsBar } from '../controls.js';
import { saveUserSong, newSongId, setSharedSong } from '../store.js';
import { STOPWORDS } from '../lyrics/wordlists.js';
import { normWord } from '../lyrics/text.js';

const DRAFT_KEY = 'singing.maker.v1';

const EXAMPLES = [
  { title: 'My Morning', text: 'I wake up at seven, I brush my teeth,\nI eat my breakfast, a banana and cheese.\nI put on my jacket, I run for the bus,\nGood morning, good morning, it\'s always a rush!' },
  { title: 'Colours', text: 'Red like an apple, yellow like the sun,\nGreen like the grass where the rabbits run.\nBlue like the sea and the sky so high,\nColours, colours, flying by!' },
  { title: 'Irregular Verbs', text: 'Go, went, gone, I went to the park,\nSee, saw, seen, I saw it get dark.\nEat, ate, eaten, I ate all the cake,\nWake, woke, woken, I\'m still awake!' },
  { title: 'Comparatives', text: 'An elephant is bigger than a mouse,\nA castle is taller than a house.\nA cheetah is faster than a car,\nBut the sun is the hottest star!' },
];

function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}

export async function render(el) {
  const draft = readDraft() || { ...EXAMPLES[0], mood: 'pop', key: 'C' };
  const state = { title: draft.title, text: draft.text, mood: draft.mood || 'pop', key: draft.key || 'C', seed: draft.seed || 1 };
  let track = null;
  let transport = null;
  let song = null;

  const saveDraft = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch { /* ignore */ } };
  const titleIn = h('input', { type: 'text', value: state.title, placeholder: 'Song title', maxlength: 60 });
  titleIn.addEventListener('input', () => { state.title = titleIn.value; saveDraft(); });
  const textIn = h('textarea', { class: 'maker-text', rows: 9, placeholder: 'Type or paste your text. One line = one line of the song. A blank line starts a new verse.' }, state.text);
  textIn.addEventListener('input', () => { state.text = textIn.value; saveDraft(); });
  const moodRow = h('div', { class: 'style-strip' });
  const drawMoods = () => {
    clear(moodRow);
    for (const [id, m] of Object.entries(MOODS)) {
      moodRow.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.mood === id), onclick: () => { state.mood = id; saveDraft(); drawMoods(); make(); } }, `${m.emoji} ${m.name}`));
    }
  };
  drawMoods();
  const keySel = h('select', { style: { width: 'auto' } }, ['C', 'D', 'E', 'F', 'G', 'A', 'Bb'].map((k) => h('option', { value: k, selected: k === state.key }, k)));
  keySel.addEventListener('change', () => { state.key = keySel.value; saveDraft(); make(); });

  const preview = h('div', { class: 'maker-preview' });

  function make({ reroll = false } = {}) {
    if (reroll) state.seed = Math.floor(Math.random() * 1e6) + 1;
    saveDraft();
    if (track) { track.destroy(); track = null; }
    if (transport) { transport.destroy(); transport = null; }
    clear(preview);
    if (!state.text.trim()) { preview.append(h('p', { class: 'small' }, 'Type some text first.')); return; }
    const words = [...new Set(state.text.split(/\s+/).map(normWord).filter((w) => w.length > 3 && !STOPWORDS.has(w)))].slice(0, 10);
    let c;
    try {
      song = composeSong(state.text, { title: state.title || 'My song', mood: state.mood, key: state.key, seed: state.seed, vocab: words });
      c = compileSong(song);
    } catch (e) {
      console.error(e);
      song = null;
      preview.append(h('p', { class: 'bad' }, `Singing could not make a song from this text (${e.message}). Try shorter lines, or put each line of the song on its own line.`));
      return;
    }
    if (c.warnings.length) console.warn(c.warnings);
    track = new SynthTrack(song);
    transport = transportBar(track);
    const lyrics = h('div', { class: 'lyrics-panel' }, c.lines.map((l) => h('div', { class: 'lp-line' }, l.sectionStart ? h('b', null, `${l.section}: `) : null, l.text)));
    preview.append(
      h('div', { class: 'player-bar' }, transport),
      knobsBar(track, song),
      h('div', { class: 'row top-space' },
        h('button', { class: 'btn', type: 'button', onclick: () => make({ reroll: true }) }, '🎲 Another tune'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => sing() }, '🎤 Sing it (karaoke)'),
        h('button', { class: 'btn', type: 'button', onclick: () => save() }, '💾 Save to my songs')),
      h('h3', { class: 'section-title' }, '📜 Your song'),
      lyrics,
    );
  }

  function save() {
    if (!song) return null;
    const s = { ...song, id: newSongId(song.title) };
    saveUserSong(s);
    toast('Saved in your songs ⭐', 'ok');
    return s;
  }

  function sing() {
    if (!song) return;
    setSharedSong({ ...song });
    location.hash = `#/play/${encodeURIComponent(song.id)}/karaoke`;
  }

  el.append(
    h('section', { class: 'card' },
      h('h1', { class: 'page-title' }, '✨ Song maker'),
      h('p', { class: 'muted' }, 'Turn any English text into a song: vocabulary, a grammar rule, a poem, your class rules. Singing writes the tune and the band plays it - then use it in karaoke and every game.'),
      h('div', { class: 'row' }, h('span', { class: 'filter-label' }, 'Try'), EXAMPLES.map((ex) => h('button', { class: 'chip', type: 'button', onclick: () => { state.title = ex.title; state.text = ex.text; titleIn.value = ex.title; textIn.value = ex.text; make(); } }, ex.title))),
      h('label', null, 'Title'), titleIn,
      h('label', null, 'Your text'), textIn,
      h('label', null, 'Mood'), moodRow,
      h('div', { class: 'row top-space' }, h('span', { class: 'knob-label' }, 'Key'), keySel, h('span', { class: 'grow' }),
        h('button', { class: 'btn primary btn-lg', type: 'button', onclick: () => make() }, '✨ Make my song')),
    ),
    h('section', { class: 'card' }, preview),
  );
  make();
  return () => { if (track) track.destroy(); if (transport) transport.destroy(); };
}
