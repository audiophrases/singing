/*
 * Party: whole-class games, with a song picked for you.
 */
import { h, pick } from '../ui.js';
import { allSongs } from '../store.js';
import { GAMES } from '../games/index.js';
import { openTeamsDialog } from './teams.js';
import { surpriseMe } from './library.js';

const PARTY = ['hotmic', 'freeze', 'finish', 'quiz', 'bingo', 'rhyme', 'echo', 'karaoke'];

export async function render(el) {
  const songs = allSongs();
  const sel = h('select', { style: { width: 'auto', maxWidth: '100%' } }, songs.map((s) => h('option', { value: s.id }, `${s.emoji || '🎵'} ${s.title}`)));
  sel.value = pick(songs).id;
  const go = (game) => { location.hash = `#/play/${encodeURIComponent(sel.value)}/${game}`; };
  el.append(
    h('section', { class: 'hero' },
      h('div', null,
        h('h1', null, '🎉 Party games'),
        h('p', null, 'Games for the whole class on the projector. Make teams, pick a song (or let Singing pick), and play.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => openTeamsDialog() }, '👥 Make teams'),
          h('button', { class: 'btn', type: 'button', onclick: surpriseMe }, '🎲 Surprise me'))),
      h('div', { class: 'hero-notes', 'aria-hidden': 'true' }, h('span', null, '🥳'), h('span', null, '🎤'), h('span', null, '🏆'))),
    h('div', { class: 'row', style: { marginBottom: '1rem' } }, h('span', { class: 'filter-label' }, 'Song'), sel,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { sel.value = pick(songs).id; } }, '🎲 Another')),
    h('div', { class: 'activity-grid' }, PARTY.map((id) => GAMES.find((g) => g.id === id)).filter(Boolean).map((g) =>
      h('button', { class: 'activity', type: 'button', onclick: () => go(g.id) },
        h('span', { class: 'act-emoji' }, g.emoji), h('span', { class: 'act-name' }, g.name), h('span', { class: 'act-desc' }, g.desc)))),
  );
  return null;
}
