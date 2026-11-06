/*
 * A song's page: listen, change the band, read the lyrics, pick an activity.
 */
import { h, add, levelBadge, toast, confirmDialog, typingTarget, debounce } from '../ui.js';
import { getSong, deleteUserSong, saveUserSong, newSongId } from '../store.js';
import { makeTrack } from '../track.js';
import { transportBar, knobsBar, applyKnobs } from '../controls.js';
import { GAMES, GROUPS, gameFits } from '../games/index.js';
import { songCover, showCover } from './library.js';
import { artworkDialog } from './artwork.js';
import { speak } from '../tts.js';
import { lineIndexAt } from '../music/timeline.js';
import { shareLink } from '../share.js';
import { exportPinPlayQuiz } from '../pinplay-export.js';
import { deleteCloudSong, setSongPublic, saveCloudSong, deleteStudentSong } from '../cloud/library.js';
import { teacherAccess, isOwner } from '../cloud/access.js';
import { lessonOf, packCounts, plainLines } from '../lesson/pack.js';

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
  const lesson = lessonOf(song);

  // ----- header
  const transport = transportBar(track);
  const cover = songCover(song, { big: true });
  if (teacherAccess() && song.mine && song.cloud && song.source === 'audio') {
    cover.append(h('button', { class: 'cover-edit', type: 'button', onclick: () => artworkDialog(song, { onChange: (src) => showCover(cover, src) }) }, h('span', null, '🖼️ Change picture')));
  }
  const head = h('section', { class: 'card song-head' },
    cover,
    h('div', null,
      h('h1', null, song.title),
      h('div', { class: 'small' }, song.artist || '', song.credit ? ` · ${song.credit}` : ''),
      h('div', { class: 'song-meta' },
        levelBadge(song.level),
        ...(song.grammar || []).map((g) => h('span', { class: 'badge' }, g)),
        ...(song.themes || []).map((t) => h('span', { class: 'badge', style: { background: '#fff4e5', color: '#8a5300' } }, t)),
      ),
      song.madeBy && teacherAccess() ? h('p', { class: 'made-by' }, madeByText(song.madeBy)) : null,
      song.about ? h('p', { class: 'song-about' }, song.about) : null,
      h('div', { class: 'player-bar' }, transport),
      knobsBar(track, song, { onChange: teacherAccess() && song.mine && (song.cloud || (song.source || 'band') === 'band') ? keepKnobs(song) : null }),
    ),
  );

  // ----- activities
  const acts = h('div');
  const counts = teacherAccess() ? packCounts(lesson) : {};
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
    x.mic ? h('span', { class: 'act-tag badge' }, '🎙️ mic') : null,
    counts[x.id] ? h('span', { class: 'act-pack badge', title: `${counts[x.id]} items from the AI pack` }, `🧠 ${counts[x.id]}`) : null))));
  }
  acts.append(h('h3', { class: 'section-title' }, '✏️ Make and share'));
  acts.append(h('div', { class: 'activity-grid' },
    teacherAccess() ? h('a', { class: 'activity', href: `#/lesson/${encodeURIComponent(song.id)}` }, h('span', { class: 'act-emoji' }, '🧠'), h('span', { class: 'act-name' }, 'AI song pack'), h('span', { class: 'act-desc' }, lesson ? 'See this song\'s pack, add to it or replace it.' : 'A prompt for any AI: it studies the lyrics and adds depth to the games.')) : null,
    teacherAccess() && lesson?.chant ? h('a', { class: 'activity', href: `#/chant?lesson=${encodeURIComponent(song.id)}` }, h('span', { class: 'act-emoji' }, '✨'), h('span', { class: 'act-name' }, 'AI chant'), h('span', { class: 'act-desc' }, lesson.chant.teaches ? `An original chant: ${lesson.chant.teaches}.` : 'An original chant on the same language, for the Song maker.')) : null,
    h('a', { class: 'activity', href: `#/remix/${encodeURIComponent(song.id)}` }, h('span', { class: 'act-emoji' }, '🪄'), h('span', { class: 'act-name' }, 'Remix'), h('span', { class: 'act-desc' }, 'Students write their own verses; the band sings them.')),
    h('a', { class: 'activity', href: `#/print/${encodeURIComponent(song.id)}/gapfill` }, h('span', { class: 'act-emoji' }, '🖨️'), h('span', { class: 'act-name' }, 'Worksheets'), h('span', { class: 'act-desc' }, 'Gap fill, cut-up lines, bingo cards, lyrics sheet - ready to print.')),
    teacherAccess() ? h('button', { class: 'activity', type: 'button', onclick: () => editCopy(song) }, h('span', { class: 'act-emoji' }, song.mine ? '✏️' : '📋'), h('span', { class: 'act-name' }, song.mine ? 'Edit song' : 'Copy and edit'), h('span', { class: 'act-desc' }, song.mine ? 'Change lyrics, timing, pictures and translations.' : 'Make your own version of this song in the Studio.')) : null,
    // Band songs in the owner's cloud library can go on the public player.
    teacherAccess() && isOwner() && song.cloud && (song.source || 'band') === 'band' ? h('button', { class: 'activity', type: 'button', 'aria-pressed': String(!!song.public), onclick: async () => {
      try { await setSongPublic(song, !song.public); } catch (e) { toast(e.message, 'bad'); return; }
      toast(song.public ? 'Now private: off the public page' : 'Now public: on the public page', 'ok');
      window.dispatchEvent(new Event('hashchange'));
    } }, h('span', { class: 'act-emoji' }, song.public ? '🌍' : '🔒'), h('span', { class: 'act-name' }, song.public ? 'Public' : 'Private'),
    h('span', { class: 'act-desc' }, song.public ? 'Anyone can play it on the public page, without signing in. Click to make it private.' : 'Only you and your assignments. Click to put it on the public page.')) : null,
    h('button', { class: 'activity', type: 'button', onclick: () => shareLink(song) }, h('span', { class: 'act-emoji' }, '🔗'), h('span', { class: 'act-name' }, 'Share link'), h('span', { class: 'act-desc' }, 'A link that opens this song on any computer, nothing to install.')),
    teacherAccess() ? h('button', { class: 'activity', type: 'button', onclick: () => exportPinPlayQuiz(song) }, h('span', { class: 'act-emoji' }, '🎯'), h('span', { class: 'act-name' }, 'Export to PinPlay'), h('span', { class: 'act-desc' }, 'A PinPlay quiz (gap fills, word choice, line order) from this song.')) : null,
    // Song maker songs go back to the Song maker: a teacher's own, or a student's.
    song.composed && ((teacherAccess() && song.mine) || song.studentSong) ? h('a', { class: 'activity', href: `#/chant?edit=${encodeURIComponent(song.id)}` }, h('span', { class: 'act-emoji' }, '✨'), h('span', { class: 'act-name' }, 'Change in the Song maker'),
      h('span', { class: 'act-desc' }, song.studentSong ? 'Change the words or the tune. Saving sends your teacher the new version.' : 'Change the words, the mood or the tune.')) : null,
    (teacherAccess() && song.mine) || song.studentSong ? h('button', { class: 'activity', type: 'button', onclick: async () => {
      if (await confirmDialog(`Delete "${song.title}"${song.studentSong ? ' from your songs' : song.cloud ? ' from your cloud library' : ' from this browser'}?`, { ok: 'Delete', danger: true })) {
        try { if (song.studentSong) await deleteStudentSong(song); else if (song.cloud) await deleteCloudSong(song); else deleteUserSong(song.id); }
        catch (e) { toast(e.message, 'bad'); return; }
        toast('Song deleted');
        location.hash = '#/';
      }
    } }, h('span', { class: 'act-emoji' }, '🗑️'), h('span', { class: 'act-name' }, 'Delete'),
    h('span', { class: 'act-desc' }, song.studentSong ? 'Remove it from your songs. Your teacher keeps the copy you sent.' : song.cloud ? 'Remove this song from your cloud library.' : 'Remove this song from this browser.')) : null,
  ));

  // ----- lyrics
  const lyricEls = [];
  const lyrics = h('div', { class: 'lyrics-panel' });
  const plain = plainLines(timeline, lesson);
  const plainToggle = plain.size ? h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: (e) => {
    e.currentTarget.setAttribute('aria-pressed', String(lyrics.classList.toggle('show-plain')));
  } }, '💬 In simple English') : null;
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
      l.translation ? h('span', { class: 'lp-tr' }, l.translation) : null,
      plain.get(l.index) ? h('span', { class: 'lp-plain' }, plain.get(l.index)) : null);
    lineEl.addEventListener('click', () => {
      track.seek(Math.max(0, l.start - 0.05));
      if (!track.playing) track.play();
    });
    lyricEls[l.index] = lineEl;
    section.append(lineEl);
  }
  const vocab = lesson?.words?.length
    ? h('div', { class: 'word-cards' }, lesson.words.map((w) => h('button', { class: 'word-card', type: 'button', title: 'Listen', onclick: () => speak(w.word) },
      h('span', { class: 'wc-word' }, `${w.emoji ? `${w.emoji} ` : ''}${w.word}`), w.ipa ? h('span', { class: 'wc-ipa' }, w.ipa) : null,
      h('span', { class: 'wc-meaning' }, w.meaning), w.translation ? h('span', { class: 'wc-tr' }, w.translation) : null,
      w.example ? h('span', { class: 'wc-example' }, w.example) : null)))
    : h('div', { class: 'vocab-list' }, (song.vocab || []).map((w) => h('button', { class: 'chip', type: 'button', title: 'Listen', onclick: () => speak(w) }, `🔊 ${w}`)));
  const hasVocab = lesson?.words?.length || song.vocab?.length;

  add(el,
    h('div', { class: 'row', style: { marginBottom: '.6rem' } }, h('a', { class: 'btn btn-sm ghost', href: '#/' }, '← All songs')),
    head,
    teacherAccess() ? contentWarnings(lesson) : null,
    acts,
    h('h3', { class: 'section-title' }, '📜 Lyrics'),
    h('section', { class: 'card' }, plainToggle ? h('div', { class: 'row', style: { marginBottom: '.5rem' } }, plainToggle) : null, lyrics),
    hasVocab ? h('h3', { class: 'section-title' }, '🔤 Key words') : null,
    hasVocab ? h('section', { class: 'card' }, vocab, h('p', { class: 'small top-space' }, 'Click a word to hear it.')) : null,
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

// What the AI asks the teacher to look at before pressing play.
function contentWarnings(lesson) {
  const cautions = lesson?.teacher?.cautions || [];
  if (!cautions.length) return null;
  return h('section', { class: 'card lesson-warnings' },
    cautions.map((c) => h('p', { class: `lesson-caution ${c.severity}` }, `${c.severity === 'serious' ? '🛑' : '⚠️'} ${c.line ? `Line ${c.line}${c.words ? ` (“${c.words}”)` : ''}: ` : ''}${c.note}`)));
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

// "Made by" for a song a student saved: who to congratulate.
function madeByText({ name, classes = [], version = 1, at }) {
  return `🎓 Made by ${name}${classes.length ? ` · ${classes.join(', ')}` : ''}${at ? ` · ${new Date(at).toLocaleDateString()}` : ''}${version > 1 ? ` · version ${version}` : ''}`;
}

// The teacher's changes to Band, Key, Speed and Melody on their own song
// become the song's settings, for everyone who plays it.
function keepKnobs(song) {
  let queue = Promise.resolve();
  return debounce((knobs) => {
    queue = queue.then(async () => {
      const current = getSong(song.id);
      if (!current) return;
      const next = { ...current, knobs };
      delete next.mine;
      // Only the settings change: the song itself was confirmed when it was saved.
      if (current.cloud) await saveCloudSong(next, { rightsConfirmed: true });
      else saveUserSong(next);
      toast('Saved with the song', 'ok');
    }).catch((e) => toast(e.message, 'bad'));
  }, 800);
}

function editCopy(song) {
  if (song.mine) {
    location.hash = `#/studio/${encodeURIComponent(song.id)}`;
    return;
  }
  const copy = JSON.parse(JSON.stringify(song));
  copy.id = newSongId(song.title);
  copy.title = `${song.title} (my version)`;
  delete copy.starter;
  saveUserSong(copy);
  toast('A copy is now in your songs');
  location.hash = `#/studio/${encodeURIComponent(copy.id)}`;
}
