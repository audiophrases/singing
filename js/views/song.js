/*
 * A song's page: listen, change the band, read the lyrics, pick an activity.
 */
import { h, add, levelBadge, toast, confirmDialog, typingTarget } from '../ui.js';
import { getSong, deleteUserSong, saveUserSong, newSongId } from '../store.js';
import { makeTrack } from '../track.js';
import { transportBar, knobsBar, applyKnobs } from '../controls.js';
import { GAMES, GROUPS, gameFits } from '../games/index.js';
import { songCover } from './library.js';
import { speak } from '../tts.js';
import { lineIndexAt } from '../music/timeline.js';
import { shareLink } from '../share.js';
import { exportPinPlayQuiz } from '../pinplay-export.js';

export async function render(el, { id }) {
  const song = getSong(id);
  if (!song) {
    el.append(h('div', { class: 'empty' }, h('span', { class: 'big' }, '🔇'), 'Song not found. ', h('a', { href: '#/' }, 'Back to the songs')));
    return null;
  }
  document.title = `${song.title} · Singing`;
  el.style.setProperty('--hue', song.hue ?? 245);

  let track;
  try {
    track = await makeTrack(song);
  } catch (e) {
    el.append(h('div', { class: 'card' }, h('h2', null, song.title), h('p', { class: 'bad' }, `This song cannot play here: ${e.message}`)));
    return null;
  }
  applyKnobs(track, song);
  const timeline = track.timeline;
  const sung = timeline.lines.filter((l) => !l.instrumental);

  // ----- header
  const transport = transportBar(track);
  const head = h('section', { class: 'card song-head' },
    songCover(song, { big: true }),
    h('div', null,
      h('h1', null, song.title),
      h('div', { class: 'small' }, song.artist || '', song.credit ? ` · ${song.credit}` : ''),
      h('div', { class: 'song-meta' },
        levelBadge(song.level),
        ...(song.grammar || []).map((g) => h('span', { class: 'badge' }, g)),
        ...(song.themes || []).map((t) => h('span', { class: 'badge', style: { background: '#fff4e5', color: '#8a5300' } }, t)),
      ),
      song.about ? h('p', { class: 'song-about' }, song.about) : null,
      h('div', { class: 'player-bar' }, transport),
      knobsBar(track, song),
    ),
  );

  // ----- activities
  const acts = h('div');
  for (const g of GROUPS) {
    const list = GAMES.filter((x) => x.group === g.id && gameFits(x, song, sung.length));
    if (!list.length) continue;
    acts.append(h('h3', { class: 'section-title' }, `${g.emoji} ${g.name}`));
    acts.append(h('div', { class: 'activity-grid' }, list.map((x) => h('a', {
      class: 'activity',
      href: `#/play/${encodeURIComponent(song.id)}/${x.id}`,
    },
    h('span', { class: 'act-emoji' }, x.emoji),
    h('span', { class: 'act-name' }, x.name),
    h('span', { class: 'act-desc' }, x.desc),
    x.mic ? h('span', { class: 'act-tag badge' }, '🎙️ mic') : null))));
  }
  acts.append(h('h3', { class: 'section-title' }, '✏️ Make and share'));
  acts.append(h('div', { class: 'activity-grid' },
    h('a', { class: 'activity', href: `#/remix/${encodeURIComponent(song.id)}` }, h('span', { class: 'act-emoji' }, '🪄'), h('span', { class: 'act-name' }, 'Remix'), h('span', { class: 'act-desc' }, 'Students write their own verses; the band sings them.')),
    h('a', { class: 'activity', href: `#/print/${encodeURIComponent(song.id)}/gapfill` }, h('span', { class: 'act-emoji' }, '🖨️'), h('span', { class: 'act-name' }, 'Worksheets'), h('span', { class: 'act-desc' }, 'Gap fill, cut-up lines, bingo cards, lyrics sheet - ready to print.')),
    h('button', { class: 'activity', type: 'button', onclick: () => editCopy(song) }, h('span', { class: 'act-emoji' }, song.mine ? '✏️' : '📋'), h('span', { class: 'act-name' }, song.mine ? 'Edit song' : 'Copy and edit'), h('span', { class: 'act-desc' }, song.mine ? 'Change lyrics, timing, pictures and translations.' : 'Make your own version of this song in the Studio.')),
    h('button', { class: 'activity', type: 'button', onclick: () => shareLink(song) }, h('span', { class: 'act-emoji' }, '🔗'), h('span', { class: 'act-name' }, 'Share link'), h('span', { class: 'act-desc' }, 'A link that opens this song on any computer, nothing to install.')),
    h('button', { class: 'activity', type: 'button', onclick: () => exportPinPlayQuiz(song) }, h('span', { class: 'act-emoji' }, '🎯'), h('span', { class: 'act-name' }, 'Export to PinPlay'), h('span', { class: 'act-desc' }, 'A PinPlay quiz (gap fills, word choice, line order) from this song.')),
    song.mine ? h('button', { class: 'activity', type: 'button', onclick: async () => {
      if (await confirmDialog(`Delete "${song.title}" from this browser?`, { ok: 'Delete', danger: true })) {
        deleteUserSong(song.id);
        toast('Song deleted');
        location.hash = '#/';
      }
    } }, h('span', { class: 'act-emoji' }, '🗑️'), h('span', { class: 'act-name' }, 'Delete'), h('span', { class: 'act-desc' }, 'Remove this song from this browser.')) : null,
  ));

  // ----- lyrics
  const lyricEls = [];
  const lyrics = h('div', { class: 'lyrics-panel' });
  let section = null;
  for (const l of timeline.lines) {
    if (!section || l.sectionStart) {
      section = h('div', { class: 'lp-section' }, l.section ? h('div', { class: 'lp-title' }, l.section) : null);
      lyrics.append(section);
    }
    const lineEl = h('div', { class: 'lp-line', title: 'Play from here' },
      l.part ? h('span', { class: 'lp-part', style: { '--part-hue': partHue(l.part) } }, l.part) : null,
      l.pic ? `${l.pic} ` : '',
      l.instrumental ? '♪ ♪ ♪' : l.text,
      l.translation ? h('span', { class: 'lp-tr' }, l.translation) : null);
    lineEl.addEventListener('click', () => {
      track.seek(Math.max(0, l.start - 0.05));
      if (!track.playing) track.play();
    });
    lyricEls[l.index] = lineEl;
    section.append(lineEl);
  }
  const vocab = h('div', { class: 'vocab-list' }, (song.vocab || []).map((w) => h('button', { class: 'chip', type: 'button', title: 'Listen', onclick: () => speak(w) }, `🔊 ${w}`)));

  add(el,
    h('div', { class: 'row', style: { marginBottom: '.6rem' } }, h('a', { class: 'btn btn-sm ghost', href: '#/' }, '← All songs')),
    head,
    acts,
    h('h3', { class: 'section-title' }, '📜 Lyrics'),
    h('section', { class: 'card' }, lyrics),
    song.vocab && song.vocab.length ? h('h3', { class: 'section-title' }, '🔤 Key words') : null,
    song.vocab && song.vocab.length ? h('section', { class: 'card' }, vocab, h('p', { class: 'small top-space' }, 'Click a word to hear it.')) : null,
  );

  // Highlight the line being played.
  let raf = 0;
  let lastIdx = -2;
  const loop = () => {
    const idx = track.playing ? lineIndexAt(timeline, track.time()) : -1;
    if (idx !== lastIdx) {
      if (lyricEls[lastIdx]) lyricEls[lastIdx].classList.remove('now');
      if (lyricEls[idx]) lyricEls[idx].classList.add('now');
      lastIdx = idx;
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  const onKey = (e) => {
    if (typingTarget(e) || e.ctrlKey || e.metaKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      transport.toggle();
    }
  };
  document.addEventListener('keydown', onKey);

  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
    transport.destroy();
    track.destroy();
  };
}

export function partHue(part) {
  const p = String(part || '').toLowerCase();
  if (/^(a|teacher|boys|group 1|1)$/.test(p)) return 45;
  if (/^(b|class|girls|group 2|2)$/.test(p)) return 190;
  if (/^(c|group 3|3)$/.test(p)) return 320;
  if (/^(all|everyone)$/.test(p)) return 130;
  let x = 0;
  for (const ch of p) x = (x * 31 + ch.charCodeAt(0)) % 360;
  return x;
}

function editCopy(song) {
  if (song.mine) {
    location.hash = `#/studio/${encodeURIComponent(song.id)}`;
    return;
  }
  const copy = JSON.parse(JSON.stringify(song));
  copy.id = newSongId(song.title);
  copy.title = `${song.title} (my version)`;
  delete copy.builtin;
  saveUserSong(copy);
  toast('A copy is now in your songs');
  location.hash = `#/studio/${encodeURIComponent(copy.id)}`;
}
