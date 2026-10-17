/*
 * Studio: bring your own song. Paste the lyrics, link a YouTube video or add
 * an audio file (or no music at all), then tap along to sync each line.
 *
 * Lyrics format, one line per sung line:
 *   [Chorus]                 starts a section
 *   🌟 Twinkle little star    a leading emoji is the line's picture
 *   A: How are you?          "A:" (Boys:, Girls:, Teacher:...) is a part
 *   Hello | Hola             after " | " comes a translation
 */
import { h, clear, toast, fmtTime } from '../ui.js';
import { getSong, saveUserSong, newSongId, userSongs } from '../store.js';
import { youtubeId } from '../media/youtube.js';
import { putMedia, newMediaId } from '../media/store.js';
import { makeTrack } from '../track.js';
import { compileSong } from '../music/score.js';

const EMOJIS = ['🎵', '🎤', '🎸', '🎹', '🥁', '🎺', '🌟', '❤️', '🌈', '🌍', '🐶', '🚀', '☀️', '🌙', '🎉', '🍕', '⚽', '🦄'];

export function parseLyrics(text, previous = []) {
  const out = [];
  let section = '';
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { section = sec[1].trim(); continue; }
    let rest = line;
    let tr = '';
    const bar = rest.indexOf(' | ');
    if (bar >= 0) { tr = rest.slice(bar + 3).trim(); rest = rest.slice(0, bar).trim(); }
    let pic = '';
    const em = /^((?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:️|‍(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}))*)\s+/u.exec(rest);
    if (em) { pic = em[1]; rest = rest.slice(em[0].length); }
    let part = '';
    const pm = /^([A-Za-z][\w ]{0,11}):\s+(.+)$/.exec(rest);
    const label = pm ? pm[1].trim() : '';
    if (pm && (!/\s/.test(label) || /^group \d$/i.test(label))) { part = label; rest = pm[2]; }
    const item = { text: rest, pic, part, tr };
    if (section) { item.section = section; section = ''; }
    out.push(item);
  }
  // Keep the timing of lines that did not change.
  out.forEach((l, i) => {
    const p = previous[i];
    if (p && p.text === l.text && Number.isFinite(p.start)) { l.start = p.start; if (Number.isFinite(p.end)) l.end = p.end; }
  });
  return out;
}

export function lyricsText(synced = []) {
  return synced.map((l) => `${l.section ? `[${l.section}]\n` : ''}${l.pic ? `${l.pic} ` : ''}${l.part ? `${l.part}: ` : ''}${l.text}${l.tr ? ` | ${l.tr}` : ''}`).join('\n');
}

export async function render(el, { id }) {
  const existing = id ? getSong(id) : null;
  if (id && (!existing || !existing.mine)) {
    el.append(h('div', { class: 'empty' }, 'Only your own songs can be edited. ', h('a', { href: '#/studio' }, 'Make a new song')));
    return null;
  }
  const song = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: newSongId('song'), title: '', artist: '', credit: '', level: 'A1', ages: 'all', emoji: '🎵', hue: Math.floor(Math.random() * 360),
    grammar: [], themes: [], vocab: [], about: '', source: 'youtube', youtube: { id: '' }, synced: [],
  };
  delete song.mine;
  let track = null;
  let sync = null;

  if (song.source === 'band') return renderBand(el, song);

  const field = (label, input) => h('div', { class: 'studio-field' }, h('label', null, label), input);
  const titleIn = h('input', { type: 'text', value: song.title, placeholder: 'Song title', maxlength: 80 });
  const artistIn = h('input', { type: 'text', value: song.artist, placeholder: 'Singer / band', maxlength: 80 });
  const levelSel = h('select', null, ['Pre-A1', 'A1', 'A2', 'B1', 'B2'].map((l) => h('option', { value: l, selected: l === song.level }, l)));
  const grammarIn = h('input', { type: 'text', value: (song.grammar || []).join(', '), placeholder: 'e.g. Past simple, Can/can\'t' });
  const vocabIn = h('input', { type: 'text', value: (song.vocab || []).join(', '), placeholder: 'Key words, separated by commas' });
  const aboutIn = h('textarea', { rows: 2, placeholder: 'Notes for the teacher (ideas, warnings...)' }, song.about || '');
  const emojiRow = h('div', { class: 'style-strip' });
  const drawEmoji = () => { clear(emojiRow); EMOJIS.forEach((e) => emojiRow.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(song.emoji === e), onclick: () => { song.emoji = e; drawEmoji(); } }, e))); };
  drawEmoji();

  const srcRow = h('div', { class: 'style-strip' });
  const srcBox = h('div');
  const ytIn = h('input', { type: 'url', value: song.youtube && song.youtube.id ? `https://youtu.be/${song.youtube.id}` : '', placeholder: 'https://www.youtube.com/watch?v=...' });
  const fileIn = h('input', { type: 'file', accept: 'audio/*' });
  const fileNote = h('span', { class: 'small' }, song.audio && song.audio.name ? `🎧 ${song.audio.name}` : '');
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    if (!f) return;
    const mid = newMediaId();
    try {
      await putMedia(mid, f);
      song.audio = { mediaId: mid, name: f.name };
      fileNote.textContent = `🎧 ${f.name} (saved in this browser)`;
    } catch (e) {
      toast(`Could not keep the file: ${e.message}`, 'bad');
    }
  });
  const drawSrc = () => {
    clear(srcRow);
    [['youtube', '▶ YouTube video'], ['audio', '🎧 Audio file'], ['none', '📝 No music (lyrics only)']].forEach(([v, label]) => srcRow.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(song.source === v), onclick: () => { song.source = v; drawSrc(); } }, label)));
    clear(srcBox);
    if (song.source === 'youtube') srcBox.append(field('YouTube link', ytIn), h('p', { class: 'small' }, 'Some videos do not allow playing on other websites; if yours does not play, try another upload of the song.'));
    if (song.source === 'audio') srcBox.append(field('Audio file (mp3, m4a...)', fileIn), fileNote, h('p', { class: 'small' }, 'The file stays in this browser. Share links do not include it.'));
    if (song.source === 'none') srcBox.append(h('p', { class: 'small' }, 'No music: you sing or play it yourself. The lyrics move at the speed you set when you sync (or at a reading pace).'));
  };
  drawSrc();

  const lyricsIn = h('textarea', { class: 'studio-lyrics', rows: 14, placeholder: '[Verse 1]\n🌟 First line of the song\nSecond line | translation\n\n[Chorus]\nA: Call...\nB: ...and response' }, lyricsText(song.synced));

  // ---- sync
  const syncList = h('ol', { class: 'sync-list' });
  const tapBtn = h('button', { class: 'btn primary btn-lg sync-tap', type: 'button', disabled: true }, '👆 TAP at the start of each line (Space)');
  const syncStatus = h('div', { class: 'small' });

  const collect = () => {
    song.title = titleIn.value.trim() || 'Untitled song';
    song.artist = artistIn.value.trim();
    song.level = levelSel.value;
    song.grammar = grammarIn.value.split(',').map((s) => s.trim()).filter(Boolean);
    song.vocab = vocabIn.value.split(',').map((s) => s.trim()).filter(Boolean);
    song.about = aboutIn.value.trim();
    if (song.source === 'youtube') song.youtube = { id: youtubeId(ytIn.value) };
    song.synced = parseLyrics(lyricsIn.value, song.synced);
    return song;
  };

  const drawSync = (active = -1) => {
    clear(syncList);
    song.synced.forEach((l, i) => {
      const nudge = (d) => { if (Number.isFinite(l.start)) { l.start = Math.max(0, +(l.start + d).toFixed(2)); drawSync(active); } };
      syncList.append(h('li', { class: `sync-row${i === active ? ' active' : ''}${Number.isFinite(l.start) ? ' done' : ''}` },
        h('span', { class: 'sync-time' }, Number.isFinite(l.start) ? fmtTime(l.start) + `.${String(Math.floor((l.start % 1) * 10))}` : '—'),
        h('button', { class: 'btn btn-sm', type: 'button', title: '0.1 s earlier', onclick: () => nudge(-0.1) }, '−'),
        h('button', { class: 'btn btn-sm', type: 'button', title: '0.1 s later', onclick: () => nudge(0.1) }, '+'),
        h('button', { class: 'btn btn-sm', type: 'button', title: 'Play from here', disabled: !Number.isFinite(l.start), onclick: async () => { await ensureTrack(); track.seek(Math.max(0, l.start - 1)); track.play(); } }, '▶'),
        h('span', { class: 'sync-text' }, l.text)));
    });
  };

  async function ensureTrack() {
    collect();
    if (track) track.destroy();
    track = null;
    try {
      track = await makeTrack({ ...song, synced: song.synced.map((l) => ({ ...l, start: undefined, end: undefined })), duration: 3600 });
    } catch (e) {
      toast(e.message, 'bad');
      throw e;
    }
    return track;
  }

  async function startSync() {
    collect();
    if (!song.synced.length) { toast('Paste the lyrics first.', 'bad'); return; }
    try { await ensureTrack(); } catch { return; }
    song.synced.forEach((l) => { delete l.start; delete l.end; });
    sync = { next: 0 };
    tapBtn.disabled = false;
    syncStatus.textContent = 'Listen, and tap when each line starts. Backspace = undo.';
    drawSync(0);
    track.seek(0);
    track.play();
    tapBtn.focus();
  }

  const tap = () => {
    if (!sync || !track) return;
    const l = song.synced[sync.next];
    if (!l) return;
    l.start = Math.max(0, +(track.time() - 0.15).toFixed(2));
    sync.next += 1;
    drawSync(sync.next);
    if (sync.next >= song.synced.length) {
      syncStatus.textContent = '✅ All lines synced! Let the song finish, then Save.';
      tapBtn.disabled = true;
      setTimeout(() => {
        const last = song.synced[song.synced.length - 1];
        if (track) last.end = Math.max(last.start + 2, track.time());
      }, 4000);
    }
    const row = syncList.children[sync.next];
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  tapBtn.addEventListener('click', tap);

  const onKey = (e) => {
    if (!sync) return;
    if (e.code === 'Space' && document.activeElement !== lyricsIn) { e.preventDefault(); tap(); }
    if (e.key === 'Backspace' && document.activeElement !== lyricsIn && sync.next > 0) {
      e.preventDefault();
      sync.next -= 1;
      delete song.synced[sync.next].start;
      drawSync(sync.next);
      tapBtn.disabled = false;
    }
  };
  document.addEventListener('keydown', onKey);

  const save = () => {
    collect();
    if (song.source === 'youtube' && !song.youtube.id) { toast('That YouTube link does not look right.', 'bad'); return; }
    if (!song.synced.length) { toast('Add the lyrics first.', 'bad'); return; }
    const timed = song.synced.filter((l) => Number.isFinite(l.start)).length;
    if (song.source !== 'none' && timed < song.synced.length) toast(`${song.synced.length - timed} lines are not synced yet - they get estimated times.`);
    saveUserSong(song);
    toast('Song saved ⭐', 'ok');
    location.hash = `#/song/${encodeURIComponent(song.id)}`;
  };

  drawSync();
  el.append(
    h('section', { class: 'card' },
      h('h1', { class: 'page-title' }, existing ? `✏️ ${song.title}` : '🎚️ Studio: add a song'),
      h('p', { class: 'muted' }, 'Any song your class loves: paste the lyrics, link the music, tap along to sync. Prefer a song with no copyright worries? ', h('a', { href: '#/chant' }, 'The Song maker'), ' writes a tune for any text.'),
      h('div', { class: 'studio-grid' },
        field('Title', titleIn), field('Artist', artistIn), field('Level', levelSel), field('Grammar focus', grammarIn), field('Key words', vocabIn)),
      field('Picture', emojiRow),
      field('Teacher notes', aboutIn),
      h('h3', { class: 'section-title' }, '🎵 Music'), srcRow, srcBox,
      h('h3', { class: 'section-title' }, '📜 Lyrics'),
      h('p', { class: 'small' }, 'One line per line of the song. [Chorus] starts a section · an emoji at the start is the picture · "A: " marks a part · " | " adds a translation.'),
      lyricsIn,
      h('h3', { class: 'section-title' }, '⏱️ Sync'),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: startSync }, '▶ Start syncing'), tapBtn, h('button', { class: 'btn', type: 'button', onclick: () => track && (track.playing ? track.pause() : track.play()) }, '⏯')),
      syncStatus,
      syncList,
      h('div', { class: 'row top-space' },
        h('button', { class: 'btn primary btn-lg', type: 'button', onclick: save }, '💾 Save song'),
        existing ? h('a', { class: 'btn', href: `#/song/${encodeURIComponent(song.id)}` }, 'Cancel') : null),
    ),
    importExport(),
  );
  return () => { document.removeEventListener('keydown', onKey); if (track) track.destroy(); };
}

// Songs played by the band: edit the song file directly (for the curious).
function renderBand(el, song) {
  const area = h('textarea', { class: 'studio-json', rows: 24, spellcheck: false }, JSON.stringify({ ...song, mine: undefined }, null, 2));
  const msg = h('div', { class: 'small' });
  const check = () => {
    try {
      const s = JSON.parse(area.value);
      const c = compileSong(s);
      msg.textContent = c.warnings.length ? `⚠️ ${c.warnings.join(' · ')}` : '✅ The song file is fine.';
      return s;
    } catch (e) {
      msg.textContent = `❌ ${e.message}`;
      return null;
    }
  };
  el.append(h('section', { class: 'card' },
    h('h1', { class: 'page-title' }, `✏️ ${song.title}`),
    h('p', { class: 'muted' }, 'This song is played by the built-in band. Each line has lyrics (t, hyphens split syllables), notes (n, e.g. "C4 D E:2") and chords (c). Use Remix to change only the words.'),
    area, msg,
    h('div', { class: 'row top-space' },
      h('button', { class: 'btn', type: 'button', onclick: check }, '🔍 Check'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => { const s = check(); if (s) { saveUserSong(s); toast('Saved ⭐', 'ok'); location.hash = `#/song/${encodeURIComponent(s.id)}`; } } }, '💾 Save'),
      h('a', { class: 'btn', href: `#/remix/${encodeURIComponent(song.id)}` }, '🪄 Remix words instead'))));
  return null;
}

// Back up and restore your songs as a file.
function importExport() {
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = Array.isArray(data) ? data : Array.isArray(data.songs) ? data.songs : [data];
      let n = 0;
      for (const s of list) {
        if (!s || !s.title || !(s.lines || s.synced)) continue;
        if (!s.id) s.id = newSongId(s.title);
        saveUserSong(s);
        n += 1;
      }
      toast(`${n} song${n === 1 ? '' : 's'} imported ⭐`, 'ok');
    } catch (e) {
      toast(`Could not read the file: ${e.message}`, 'bad');
    }
  });
  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ app: 'singing', version: 1, songs: userSongs() }, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'singing-songs.json' });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  return h('section', { class: 'card' },
    h('h3', { style: { marginTop: 0 } }, '💾 Back up your songs'),
    h('p', { class: 'small' }, 'Your songs live in this browser. Download them as a file to keep them safe or move them to another computer. (Audio files are not included.)'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: exportAll }, '⬇️ Download my songs'),
      h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, '⬆️ Import songs'),
      fileIn));
}

