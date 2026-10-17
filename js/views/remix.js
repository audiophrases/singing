/*
 * Remix: write new words for a song. Singing bends the tune to fit each new
 * line (splitting or holding notes), so students hear their own verse sung.
 */
import { h, clear, toast } from '../ui.js';
import { getSong, saveUserSong, newSongId, setSharedSong } from '../store.js';
import { compileSong } from '../music/score.js';
import { SynthTrack } from '../music/player.js';
import { transportBar } from '../controls.js';
import { hyphenate, lineSyllables } from '../lyrics/syllables.js';
import { songTimeline } from '../pinplay-export.js';

export async function render(el, { id }) {
  const song = getSong(id);
  if (!song) {
    el.append(h('div', { class: 'empty' }, 'Song not found.'));
    return null;
  }
  const band = !song.source || song.source === 'band';
  const base = band ? compileSong(song) : null;
  const timeline = songTimeline(song);
  const inputs = [];
  const counts = [];
  let track = null;
  let transport = null;
  const previewBox = h('div', { class: 'player-bar hidden' });

  const remixed = () => {
    const copy = JSON.parse(JSON.stringify(song));
    copy.id = `${song.id}-remix`;
    copy.title = `${song.title} (remix)`;
    delete copy.builtin;
    if (band) {
      copy.lines = song.lines.map((l, i) => {
        const text = inputs[i].value.trim();
        if (!text || text === timeline.lines[i].text) return l;
        return { ...l, t: hyphenate(text), fit: true };
      });
    } else {
      copy.synced = (song.synced || []).map((l, i) => ({ ...l, text: inputs[i] ? inputs[i].value.trim() || l.text : l.text }));
    }
    return copy;
  };

  const preview = () => {
    if (!band) return;
    if (track) track.destroy();
    if (transport) transport.destroy();
    track = new SynthTrack(remixed());
    transport = transportBar(track);
    clear(previewBox).append(transport);
    previewBox.classList.remove('hidden');
    track.play();
  };

  const list = h('div', { class: 'remix-list' });
  timeline.lines.forEach((l, i) => {
    if (l.instrumental) { inputs[i] = { value: '' }; return; }
    const want = band ? base.lines[i].syllables.length : 0;
    const input = h('input', { type: 'text', value: l.text, 'aria-label': `Line ${i + 1}` });
    const count = h('span', { class: 'remix-count' });
    const update = () => {
      const n = lineSyllables(input.value).length;
      count.textContent = band ? `${n}/${want}` : '';
      count.className = `remix-count${band && n !== want ? (Math.abs(n - want) > 3 ? ' far' : ' near') : ''}`;
      count.title = band ? `${n} syllables; the tune has ${want} notes` : '';
    };
    input.addEventListener('input', update);
    update();
    inputs[i] = input;
    counts[i] = count;
    list.append(h('div', { class: 'remix-row' },
      l.sectionStart ? h('div', { class: 'remix-section' }, l.section) : null,
      h('div', { class: 'remix-line' }, h('span', { class: 'remix-num' }, String(i + 1)), input, count)));
  });

  el.append(
    h('div', { class: 'row', style: { marginBottom: '.6rem' } }, h('a', { class: 'btn btn-sm ghost', href: `#/song/${encodeURIComponent(song.id)}` }, `← ${song.title}`)),
    h('section', { class: 'card' },
      h('h1', { class: 'page-title' }, `🪄 Remix: ${song.title}`),
      h('p', { class: 'muted' }, band
        ? 'Change any line: new animals for Old MacDonald, your names, new verbs... The numbers show syllables / notes - close is fine, Singing bends the tune to fit.'
        : 'Change the words of any line; the timing stays the same.'),
      h('div', { class: 'row' },
        band ? h('button', { class: 'btn', type: 'button', onclick: preview }, '▶ Listen') : null,
        h('button', { class: 'btn primary', type: 'button', onclick: () => { const s = remixed(); setSharedSong(s); location.hash = `#/play/${encodeURIComponent(s.id)}/karaoke`; } }, '🎤 Sing it'),
        h('button', { class: 'btn', type: 'button', onclick: () => { const s = remixed(); s.id = newSongId(s.title); saveUserSong(s); toast('Saved in your songs ⭐', 'ok'); location.hash = `#/song/${encodeURIComponent(s.id)}`; } }, '💾 Save as my song')),
      previewBox,
      list),
  );
  return () => { if (track) track.destroy(); if (transport) transport.destroy(); };
}
