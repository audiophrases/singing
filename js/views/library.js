/*
 * The song library: every built-in song plus the teacher's own, as cards.
 */
import { h, clear, levelBadge, pick, debounce } from '../ui.js';
import { allSongs, getProgress, onSongs } from '../store.js';
import { GAMES, gameFits } from '../games/index.js';
import { SynthTrack } from '../music/player.js';
import { folderLibraryControls } from './folder-library.js';
import { onFolderStatus } from '../media/folder-library.js';
import { teacherAccess } from '../cloud/access.js';

const FILTER_KEY = 'singing.libraryFilters.v1';
const LEVELS = ['Pre-A1', 'A1', 'A2', 'B1', 'B2'];
const AGES = [['kids', '🧒 Kids'], ['teens', '🧑 Teens'], ['all', '👪 Everyone']];

let preview = null;

function stopPreview() {
  if (preview) {
    preview.track.destroy();
    if (preview.btn) { preview.btn.textContent = '▶'; preview.btn.classList.remove('playing'); }
    preview = null;
  }
}

function readFilters() {
  try { return { q: '', level: '', ages: '', grammar: '', mine: false, ...JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}') }; } catch { return { q: '', level: '', ages: '', grammar: '', mine: false }; }
}

function saveFilters(f) {
  try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* ignore */ }
}

function sourceLabel(song) {
  if (song.source === 'youtube') return '▶ YouTube';
  if (song.source === 'audio') return '🎧 Audio';
  if (song.source === 'none') return '📝 Lyrics';
  return '';
}

export function songCover(song, { big = false } = {}) {
  const cover = h('div', { class: 'song-cover', style: { '--hue': song.hue ?? 245 } },
    h('span', { class: 'cover-emoji', 'aria-hidden': 'true' }, song.emoji || '🎵'));
  const src = sourceLabel(song);
  if (src && !big) cover.append(h('span', { class: 'cover-src' }, src));
  if (song.source === 'youtube' && song.youtube && song.youtube.id && !big) {
    const img = h('img', { src: `https://i.ytimg.com/vi/${song.youtube.id}/mqdefault.jpg`, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => img.remove());
    cover.prepend(img);
  }
  return cover;
}

function card(song) {
  const link = h('a', { class: 'song-card', href: `#/song/${encodeURIComponent(song.id)}`, style: { '--hue': song.hue ?? 245 } });
  const cover = songCover(song);
  if (!song.source || song.source === 'band') {
    const btn = h('button', { class: 'cover-play', type: 'button', title: 'Listen to the start', 'aria-label': `Listen to ${song.title}` }, '▶');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (preview && preview.btn === btn) { stopPreview(); return; }
      stopPreview();
      const track = new SynthTrack(song);
      const lines = track.timeline.lines;
      const stopAt = lines[Math.min(1, lines.length - 1)].end;
      track.setBarrier(stopAt);
      track.on('barrier', stopPreview);
      track.on('end', stopPreview);
      preview = { track, btn };
      btn.textContent = '⏸';
      btn.classList.add('playing');
      track.play();
    });
    cover.append(btn);
  }
  link.append(cover, h('div', { class: 'song-body' },
    h('div', { class: 'song-title' }, song.title),
    h('div', { class: 'song-artist' }, song.artist || ''),
    h('div', { class: 'song-tags' },
      levelBadge(song.level),
      song.mine ? h('span', { class: 'badge' }, '⭐ Mine') : null,
      ...(song.grammar || []).slice(0, 2).map((g) => h('span', { class: 'badge' }, g)),
    ),
  ));
  return h('li', null, link);
}

function matches(song, f) {
  if (f.level && song.level !== f.level) return false;
  if (f.ages && song.ages !== f.ages && song.ages !== 'all') return false;
  if (f.mine && !song.mine) return false;
  if (f.grammar && !(song.grammar || []).includes(f.grammar)) return false;
  if (f.q) {
    const hay = [song.title, song.artist, ...(song.grammar || []), ...(song.themes || []), ...(song.vocab || [])].join(' ').toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

export function surpriseMe() {
  const songs = allSongs();
  const song = pick(songs);
  const games = GAMES.filter((g) => !g.mic && gameFits(g, song, (song.lines || song.synced || []).length));
  const game = pick(games);
  location.hash = `#/play/${encodeURIComponent(song.id)}/${game.id}`;
}

export async function render(el) {
  const f = readFilters();
  let songs = allSongs();
  const grammarSet = [...new Set(songs.flatMap((s) => s.grammar || []))].sort();
  const progress = getProgress();

  const grid = h('ul', { class: 'song-grid' });
  const count = h('span', { class: 'small' });

  const draw = () => {
    songs = allSongs();
    saveFilters(f);
    clear(grid);
    const list = songs.filter((s) => matches(s, f));
    count.textContent = `${list.length} song${list.length === 1 ? '' : 's'}`;
    if (!list.length) {
      grid.append(h('li', { class: 'empty', style: { gridColumn: '1 / -1' } }, h('span', { class: 'big' }, '🔍'), 'No songs match. ', teacherAccess() ? h('a', { href: '#/studio' }, 'Make your own song!') : 'Try another search.'));
      return;
    }
    for (const s of list) grid.append(card(s));
  };

  const chipRow = (label, items, key) => {
    const row = h('div', { class: 'row' }, h('span', { class: 'filter-label' }, label));
    const all = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(!f[key]) }, 'All');
    row.append(all);
    const buttons = [all];
    all.addEventListener('click', () => { f[key] = ''; sync(); });
    for (const [value, text] of items) {
      const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(f[key] === value) }, text);
      b.dataset.value = value;
      b.addEventListener('click', () => { f[key] = f[key] === value ? '' : value; sync(); });
      buttons.push(b);
      row.append(b);
    }
    const sync = () => {
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === all ? !f[key] : f[key] === b.dataset.value)));
      draw();
    };
    return row;
  };

  const search = h('input', { type: 'search', placeholder: 'Search songs, grammar, words...', value: f.q, 'aria-label': 'Search songs' });
  search.addEventListener('input', debounce(() => { f.q = search.value.trim(); draw(); }, 150));

  const grammarSel = h('select', { 'aria-label': 'Grammar', style: { width: 'auto' } },
    h('option', { value: '' }, 'Any grammar'),
    grammarSet.map((g) => h('option', { value: g, selected: f.grammar === g }, g)));
  grammarSel.addEventListener('change', () => { f.grammar = grammarSel.value; draw(); });

  const mineBtn = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(!!f.mine) }, '⭐ My songs');
  mineBtn.addEventListener('click', () => { f.mine = !f.mine; mineBtn.setAttribute('aria-pressed', String(f.mine)); draw(); });

  let continueCard = null;
  if (progress.last && progress.last.songId) {
    const s = songs.find((x) => x.id === progress.last.songId);
    if (s) {
      continueCard = h('a', { class: 'btn', href: `#/song/${encodeURIComponent(s.id)}` }, `↩ Back to ${s.emoji || '🎵'} ${s.title}`);
    }
  }

  const folders = folderLibraryControls();
  el.append(
    h('section', { class: 'hero' },
      h('div', null,
        h('h1', null, 'Sing, play, learn English!'),
        h('p', null, 'Karaoke, listening games and party games for your class - with a built-in band that plays every song at any speed, in any key, in any style.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: surpriseMe }, '🎲 Surprise me'),
          teacherAccess() ? h('a', { class: 'btn', href: '#/studio' }, '➕ Add a song') : null,
          h('a', { class: 'btn', href: '#/chant' }, '✨ Song maker'),
          h('a', { class: 'btn', href: '#/party' }, '🎉 Party games'),
          continueCard,
        ),
      ),
      h('div', { class: 'hero-notes', 'aria-hidden': 'true' }, h('span', null, '🎵'), h('span', null, '🎤'), h('span', null, '🎶')),
    ),
    ...(folders ? [folders] : []),
    h('div', { class: 'filters' },
      h('div', { class: 'row' }, search, grammarSel, mineBtn, h('span', { class: 'grow' }), count),
      chipRow('Level', LEVELS.map((l) => [l, l]), 'level'),
      chipRow('Ages', AGES, 'ages'),
    ),
    grid,
  );
  draw();
  const off = onFolderStatus((state) => { if (state.changed) draw(); });
  const offSongs = onSongs(draw);
  return () => { stopPreview(); folders?.destroy(); off(); offSongs(); };
}
