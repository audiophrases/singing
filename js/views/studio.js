/*
 * Studio: bring your own song. Paste the lyrics (format in lyrics/lines.js),
 * link a YouTube video or add an audio file (or no music at all), then tap
 * along to sync each line - or import a timing file (UltraStar, LRC, SRT,
 * WebVTT) and just line it up with the music.
 */
import { h, clear, toast, fmtTime, confirmDialog, openModal } from '../ui.js';
import { getSong, saveUserSong, newSongId, userSongs } from '../store.js';
import { youtubeId } from '../media/youtube.js';
import { putMedia, getMedia, newMediaId } from '../media/store.js';
import { decodeText, readTimingFile, shiftSynced } from '../media/timing.js';
import { decodeMono, features, alignNotes, alignRecordings } from '../media/align.js';
import { parseLyrics, lyricsText } from '../lyrics/lines.js';
import { makeTrack } from '../track.js';
import { compileSong } from '../music/score.js';
import { selectAudioFiles, AUDIO_FILE, LYRICS_FILE } from '../media/song-files.js';
import { folderLibraryControls } from './folder-library.js';
import { saveCloudSong, cloudMediaBlob } from '../cloud/library.js';

const EMOJIS = ['🎵', '🎤', '🎸', '🎹', '🥁', '🎺', '🌟', '❤️', '🌈', '🌍', '🐶', '🚀', '☀️', '🌙', '🎉', '🍕', '⚽', '🦄'];

// Resolves with the index of the button pressed, or -1.
function choose(title, message, labels) {
  return new Promise((resolve) => {
    let picked = -1;
    const m = openModal([
      h('h2', null, title),
      h('p', null, message),
      h('div', { class: 'modal-actions' }, labels.map((label, i) => h('button', { class: `btn${i === 0 ? ' primary' : ''}`, type: 'button', onclick: () => { picked = i; m.close(); } }, label))),
    ], { onClose: () => resolve(picked) });
  });
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
  const karIn = h('input', { type: 'file', accept: 'audio/*' });
  const karNote = h('div', { class: 'small' }, song.karaoke && song.karaoke.name ? `🎤 ${song.karaoke.name}` : '');
  const rightsIn = h('input', { type: 'checkbox', checked: !!song.cloud });
  const vocIn = h('input', { type: 'file', accept: 'audio/*', 'aria-label': 'Vocals only file' });
  const vocNote = h('div', { class: 'small' }, song.vocals?.name ? `🗣️ ${song.vocals.name}` : '');
  // Files added in this visit, to listen to them (auto-align) without reading them back.
  const blobs = {};
  const keepFile = async (f) => {
    const mid = newMediaId();
    await putMedia(mid, f);
    blobs[mid] = f;
    return mid;
  };
  const setAudioFile = async (f) => {
    try {
      song.audio = { mediaId: await keepFile(f), name: f.name };
      fileNote.textContent = `🎧 ${f.name} (ready to upload when you save)`;
      return true;
    } catch (e) {
      toast(`Could not keep the file: ${e.message}`, 'bad');
      return false;
    }
  };
  const setKaraokeFile = async (f) => {
    try {
      song.karaoke = { mediaId: await keepFile(f), name: f.name, offset: 0 };
      karNote.textContent = `🎤 ${f.name} (ready to upload when you save)`;
      return true;
    } catch (e) {
      toast(`Could not keep the file: ${e.message}`, 'bad');
      return false;
    }
  };
  const setVocalsFile = async (f) => {
    try {
      song.vocals = { mediaId: await keepFile(f), name: f.name, offset: 0 };
      vocNote.textContent = `🗣️ ${f.name} (ready to upload when you save)`;
      return true;
    } catch (e) {
      toast(`Could not keep the file: ${e.message}`, 'bad');
      return false;
    }
  };
  fileIn.addEventListener('change', async () => { if (fileIn.files[0] && await setAudioFile(fileIn.files[0])) afterMedia({ audio: true }); });
  karIn.addEventListener('change', async () => { if (karIn.files[0] && await setKaraokeFile(karIn.files[0])) afterMedia({ karaoke: true }); });
  vocIn.addEventListener('change', async () => { if (vocIn.files[0] && await setVocalsFile(vocIn.files[0])) afterMedia({ vocals: true }); });
  const dropKaraoke = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { delete song.karaoke; karIn.value = ''; karNote.textContent = ''; } }, '✕ No karaoke version');
  const dropVocals = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { delete song.vocals; vocIn.value = ''; vocNote.textContent = ''; } }, '✕ No vocals file');
  const drawSrc = () => {
    clear(srcRow);
    [['youtube', '▶ YouTube video'], ['audio', '🎧 Audio file'], ['none', '📝 No music (lyrics only)']].forEach(([v, label]) => srcRow.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(song.source === v), onclick: () => { song.source = v; drawSrc(); } }, label)));
    clear(srcBox);
    if (song.source === 'youtube') srcBox.append(field('YouTube link', ytIn), h('p', { class: 'small' }, 'Some videos do not allow playing on other websites; if yours does not play, try another upload of the song.'));
    if (song.source === 'audio') {
      srcBox.append(field('Original recording (mp3, m4a...)', fileIn), fileNote,
        field('Karaoke version (optional)', karIn), karNote, dropKaraoke,
        field('Vocals only (optional)', vocIn), vocNote, dropVocals,
        h('p', { class: 'small' }, 'Keep the original song, the instrumental and isolated vocals together. Choose Vocals only in the player to practise with just the singer.'),
        h('p', { class: 'small' }, 'Use the same recording without the singer. Original, karaoke and vocals files are saved to your private cloud library. Sign in as a teacher before saving.'));
    }
    if (song.source === 'none') srcBox.append(h('p', { class: 'small' }, 'No music: you sing or play it yourself. The lyrics move at the speed you set when you sync (or at a reading pace).'));
  };
  drawSrc();

  const lyricsIn = h('textarea', { class: 'studio-lyrics', rows: 14, placeholder: '[Verse 1]\n🌟 First line of the song\nSecond line | translation\n\n[Chorus]\nA: Call...\nB: ...and response' }, lyricsText(song.synced));

  // ---- sync
  const syncList = h('ol', { class: 'sync-list' });
  const TAP_LABEL = '👆 TAP at the start of each line (Space)';
  const tapBtn = h('button', { class: 'btn primary btn-lg sync-tap', type: 'button', disabled: true }, TAP_LABEL);
  const syncStatus = h('div', { class: 'small' });
  const importNote = h('div', { class: 'small' });
  let align = null;

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
      // The whole line moves: its end, word times and notes too.
      const nudge = (d) => { if (Number.isFinite(l.start)) { song.synced[i] = shiftSynced([l], d)[0]; drawSync(active); } };
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
      track = await makeTrack({ ...song, synced: song.synced.map((l) => ({ text: l.text })), duration: 3600 });
    } catch (e) {
      toast(e.message, 'bad');
      throw e;
    }
    return track;
  }

  async function startSync() {
    collect();
    if (!song.synced.length) { toast('Paste the lyrics first.', 'bad'); return; }
    const detailed = song.synced.some((l) => l.notes || l.words);
    if (detailed && !(await confirmDialog('Tapping replaces the timing from the imported file, including its word times and notes (Pitch Pal needs the notes). To fix timing that is just early or late, use "All lines earlier / later" instead.', { ok: 'Tap again', title: 'Replace the timing?' }))) return;
    try { await ensureTrack(); } catch { return; }
    song.synced.forEach((l) => { delete l.start; delete l.end; delete l.words; delete l.notes; });
    align = null;
    sync = { next: 0 };
    tapBtn.textContent = TAP_LABEL;
    tapBtn.disabled = false;
    syncStatus.textContent = 'Listen, and tap when each line starts. Backspace = undo.';
    drawSync(0);
    track.seek(0);
    track.play();
    tapBtn.focus();
  }

  // Imported timing that is a little early or late (another version of the
  // song, a video with a longer intro): move every line at once.
  let moved = 0;
  const shiftAll = (d, note = '') => {
    collect();
    if (!song.synced.some((l) => Number.isFinite(l.start))) { toast('Nothing is synced yet: import a timing file or tap along first.', 'bad'); return; }
    song.synced = shiftSynced(song.synced, d);
    moved = Math.round((moved + d) * 100) / 100;
    syncStatus.textContent = note || (moved ? `All lines moved ${Math.abs(moved)} s ${moved < 0 ? 'earlier' : 'later'}. Press ▶ on a line to check.` : 'All lines back where they were.');
    drawSync();
  };

  // ---- auto-align: listen to the audio files themselves
  const heard = {};
  const featuresOf = (mid) => {
    if (!heard[mid]) {
      heard[mid] = (async () => {
        const ref = ['audio', 'karaoke', 'vocals'].map((r) => song[r]).find((r) => r && (r.mediaId || r.assetId) === mid);
        const blob = blobs[mid] || (ref?.assetId ? await cloudMediaBlob(ref, song) : await getMedia(mid));
        if (!blob) throw new Error('the audio file is not in this browser any more');
        return features(await decodeMono(blob));
      })();
      heard[mid].catch(() => { delete heard[mid]; });
    }
    return heard[mid];
  };
  // Let the message show before the (second-long) listening starts.
  const working = (el, text) => { el.textContent = text; return new Promise((r) => setTimeout(r, 50)); };
  const hasAudioFile = () => song.source === 'audio' && song.audio && (song.audio.mediaId || song.audio.assetId);

  // The UltraStar melody against the song: move the lyrics to where it is sung.
  async function alignLyrics({ auto = false } = {}) {
    collect();
    const notes = song.synced.flatMap((l) => l.notes || []);
    if (!notes.some((n) => Number.isFinite(n[2]))) {
      if (!auto) toast('Auto-align listens for the melody, so it needs an UltraStar file. For other timing, use Tap to align.', 'bad');
      return;
    }
    if (!hasAudioFile()) {
      if (!auto) toast('Auto-align listens to the audio file: add one first. (YouTube cannot be listened to: use Tap to align.)', 'bad');
      return;
    }
    await working(syncStatus, '🪄 Listening for the melody in your audio…');
    let res;
    try {
      res = alignNotes(await featuresOf(song.audio.mediaId || song.audio.assetId), notes);
    } catch (e) {
      syncStatus.textContent = `Could not listen to the audio: ${e.message}.`;
      return;
    }
    if (!res.confident) {
      syncStatus.textContent = '🪄 Could not find the melody in this recording for sure, so nothing moved. Press ▶ on a line to check by ear, and Tap to align if it is off.';
    } else if (Math.abs(res.offset) < 0.03) {
      syncStatus.textContent = '🪄 Checked against your audio: the lyrics are already in time ✓';
    } else {
      shiftAll(res.offset, `🪄 Lined up with your audio: all lines moved ${Math.abs(res.offset).toFixed(2)} s ${res.offset < 0 ? 'earlier' : 'later'}. Press ▶ on a line to check.`);
    }
  }

  // The karaoke version against the song: how far apart the same music is.
  async function alignKaraoke() {
    if (!song.karaoke || !hasAudioFile()) return;
    const k = song.karaoke;
    await working(karNote, `🎤 ${k.name}: lining it up with the song…`);
    let res;
    try {
      res = alignRecordings(await featuresOf(song.audio.mediaId || song.audio.assetId), await featuresOf(k.mediaId || k.assetId));
    } catch (e) {
      karNote.textContent = `🎤 ${k.name}: could not listen to it (${e.message}).`;
      return;
    }
    if (song.karaoke !== k) return;
    if (!res.confident) {
      k.offset = 0;
      karNote.textContent = `⚠️ ${k.name} does not sound like the same recording as the song (or its speed is different), so the two may not stay together. Use an instrumental of this very recording.`;
      return;
    }
    k.offset = res.offset;
    const gap = Math.abs(res.offset) >= 0.03 ? ` (its music is ${Math.abs(res.offset).toFixed(2)} s ${res.offset > 0 ? 'later' : 'earlier'} in the file)` : '';
    karNote.textContent = `🎤 ${k.name}: lined up with the song${gap} ✓`;
  }

  async function afterMedia({ audio = false, karaoke = false, lyrics = false }) {
    if (audio || lyrics) await alignLyrics({ auto: true });
    if (audio || karaoke) await alignKaraoke();
  }

  async function startAlign() {
    collect();
    const first = song.synced.find((l) => Number.isFinite(l.start));
    if (!first) { toast('Nothing is synced yet: import a timing file or tap along first.', 'bad'); return; }
    try { await ensureTrack(); } catch { return; }
    sync = null;
    align = { start: first.start };
    tapBtn.textContent = `👆 TAP when “${first.text.slice(0, 40)}” starts (Space)`;
    tapBtn.disabled = false;
    syncStatus.textContent = 'Listen, and tap once when the first line starts: all the lines move to match.';
    track.seek(0);
    track.play();
    tapBtn.focus();
  }

  const tap = () => {
    if (align && track) {
      const d = Math.round((track.time() - 0.15 - align.start) * 100) / 100;
      align = null;
      tapBtn.textContent = TAP_LABEL;
      tapBtn.disabled = true;
      shiftAll(d);
      return;
    }
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

  // While the music plays, the line being sung lights up in the list.
  const follow = setInterval(() => {
    if (!track || !track.playing || align || (sync && sync.next < song.synced.length)) return;
    const t = track.time();
    let k = -1;
    song.synced.forEach((l, i) => { if (Number.isFinite(l.start) && l.start <= t) k = i; });
    [...syncList.children].forEach((li, i) => li.classList.toggle('active', i === k));
  }, 150);

  // ---- timing files (UltraStar, LRC, SRT, WebVTT) and dropped files
  // Resolves true when timed lines came in.
  async function importTiming(file, { withAudio = false, text = null } = {}) {
    if (text === null) {
      try {
        text = decodeText(await file.arrayBuffer());
      } catch (e) {
        toast(`Could not read ${file.name}: ${e.message}`, 'bad');
        return false;
      }
    }
    const res = readTimingFile(text, file.name);
    collect();
    if (res.format === 'text') {
      if (song.synced.length && !(await confirmDialog(`Replace the lyrics with the text of ${file.name}?`, { ok: 'Replace' }))) return;
      lyricsIn.value = text.trim();
      song.synced = parseLyrics(lyricsIn.value);
      importNote.textContent = `📜 Lyrics from ${file.name}. The file has no timing: tap along to sync.`;
      drawSync();
      return false;
    }
    if (!res.lines.length) { toast(`No timed lyrics found in ${file.name}.`, 'bad'); return false; }
    if (song.synced.length && !(await confirmDialog(`Replace the lyrics and timing with the ${res.lines.length} lines in ${file.name}?`, { ok: 'Replace' }))) return false;
    song.synced = res.lines;
    lyricsIn.value = lyricsText(song.synced);
    if (!titleIn.value.trim() && res.meta.title) titleIn.value = res.meta.title;
    if (!artistIn.value.trim() && res.meta.artist) artistIn.value = res.meta.artist;
    if (res.meta.youtubeId && song.source === 'youtube' && !youtubeId(ytIn.value)) ytIn.value = `https://youtu.be/${res.meta.youtubeId}`;
    moved = 0;
    sync = null;
    drawSync();
    const what = res.notes ? ', with every syllable and note: Pitch Pal can score this song' : res.words ? ', with word times' : '';
    const audio = res.meta.audio && !withAudio && !(song.audio && song.audio.name) ? ` It was timed for “${res.meta.audio}”.` : '';
    const check = res.notes ? ' Singing lines it up with your audio file by itself.' : ' Play the song and check the lines: if they are all early or late, move them below or tap to align.';
    importNote.textContent = `✅ ${res.lines.length} lines from the ${res.label} file${what}.${audio}${check}`;
    return true;
  }

  /*
   * Dropped files: the song, its karaoke version and the lyrics, in any mix.
   * Which audio is which: the names in the UltraStar file (#AUDIO/#MP3,
   * #INSTRUMENTAL), then words like "instrumental" in the names, then ask.
   */
  async function takeFiles(files) {
    const list = [...files];
    const audios = list.filter((f) => (f.type || '').startsWith('audio/') || AUDIO_FILE.test(f.name));
    const timing = list.find((f) => LYRICS_FILE.test(f.name));
    if (!audios.length && !timing) { toast('Drop an audio file (mp3...), its karaoke version and/or a lyrics file (UltraStar .txt, .lrc, .srt, .vtt).', 'bad'); return; }
    let text = null;
    let meta = {};
    if (timing) {
      try {
        text = decodeText(await timing.arrayBuffer());
        meta = readTimingFile(text, timing.name).meta;
      } catch (e) {
        toast(`Could not read ${timing.name}: ${e.message}`, 'bad');
      }
    }
    const selected = selectAudioFiles(audios, meta);
    let karFile = selected.karaoke;
    const vocFile = selected.vocals;
    let songFile = selected.audio;
    if (audios.filter((f) => f !== vocFile).length >= 2 && !karFile) {
      const pick = await choose('Which one is the karaoke version?', 'The karaoke version is the one without the singer.', [...audios.slice(0, 3).map((f) => f.name), 'Neither']);
      karFile = pick >= 0 && pick < Math.min(3, audios.length) ? audios[pick] : null;
      songFile = audios.find((f) => f !== karFile && f !== vocFile) || null;
    }
    if (!songFile && !song.audio) songFile = karFile || vocFile;
    if (songFile || karFile || vocFile) {
      song.source = 'audio';
      drawSrc();
    }
    const [gotSong, gotKar, gotVocals, gotLyrics] = await Promise.all([
      songFile ? setAudioFile(songFile) : false,
      karFile ? setKaraokeFile(karFile) : false,
      vocFile ? setVocalsFile(vocFile) : false,
      timing && text !== null ? importTiming(timing, { withAudio: !!songFile, text }) : false,
    ]);
    if (gotSong && songFile === karFile && gotVocals) song.audio.stems = true;
    if (gotSong || gotKar || gotVocals || gotLyrics) await afterMedia({ audio: gotSong, karaoke: gotKar, vocals: gotVocals, lyrics: gotLyrics });
  }
  const timingIn = h('input', { type: 'file', accept: '.txt,.lrc,.srt,.vtt,text/plain', class: 'hidden' });
  timingIn.addEventListener('change', async () => {
    const f = timingIn.files[0];
    timingIn.value = '';
    if (f && await importTiming(f)) afterMedia({ lyrics: true });
  });

  const onKey = (e) => {
    if (!sync && !align) return;
    if (align) {
      if (e.code === 'Space' && document.activeElement !== lyricsIn) { e.preventDefault(); tap(); }
      return;
    }
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

  let saving = false;
  const save = async () => {
    if (saving) return;
    collect();
    if (song.source === 'youtube' && !song.youtube.id) { toast('That YouTube link does not look right.', 'bad'); return; }
    if (!song.synced.length) { toast('Add the lyrics first.', 'bad'); return; }
    const timed = song.synced.filter((l) => Number.isFinite(l.start)).length;
    if (song.source !== 'none' && timed < song.synced.length) toast(`${song.synced.length - timed} lines are not synced yet - they get estimated times.`);
    saving = true;
    saveButton.disabled = true;
    try {
      const saved = song.source === 'audio' || song.cloud || ['audio', 'karaoke', 'vocals', 'sourceFile'].some((role) => song[role]?.mediaId)
        ? await saveCloudSong(song, { rightsConfirmed: rightsIn.checked, onProgress: (text) => { syncStatus.textContent = text; } })
        : saveUserSong(song);
      toast(saved.cloud ? 'Song saved to your private cloud library ☁' : 'Song saved ⭐', 'ok');
      location.hash = `#/song/${encodeURIComponent(saved.id)}`;
    } catch (e) { syncStatus.textContent = e.message; toast(e.message, 'bad'); }
    finally { saving = false; saveButton.disabled = false; }
  };
  const saveButton = h('button', { class: 'btn primary btn-lg', type: 'button', onclick: save }, '💾 Save song');

  drawSync();
  const shiftBtn = (d, label, title) => h('button', { class: 'btn btn-sm', type: 'button', title, onclick: () => shiftAll(d) }, label);
  const card = h('section', { class: 'card studio-card' },
    h('h1', { class: 'page-title' }, existing ? `✏️ ${song.title}` : '🎚️ Studio: add a song'),
    h('p', { class: 'muted' }, 'Any song your class loves: paste the lyrics, link the music, tap along to sync - or drop an mp3, its karaoke version and its lyrics file (UltraStar, LRC, SRT) here. Prefer a song with no copyright worries? ', h('a', { href: '#/chant' }, 'The Song maker'), ' writes a tune for any text.'),
    h('div', { class: 'studio-grid' },
      field('Title', titleIn), field('Artist', artistIn), field('Level', levelSel), field('Grammar focus', grammarIn), field('Key words', vocabIn)),
    field('Picture', emojiRow),
    field('Teacher notes', aboutIn),
    h('h3', { class: 'section-title' }, '🎵 Music'), srcRow, srcBox,
    h('h3', { class: 'section-title' }, '📜 Lyrics'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => timingIn.click() }, '📂 Import lyrics with timing'), timingIn,
      h('span', { class: 'small' }, 'UltraStar (.txt), LRC, SRT or WebVTT. UltraStar files also have the notes, for Pitch Pal.')),
    importNote,
    h('p', { class: 'small' }, 'One line per line of the song. [Chorus] starts a section · an emoji at the start is the picture · "A: " marks a part · " | " adds a translation.'),
    lyricsIn,
    h('h3', { class: 'section-title' }, '⏱️ Sync'),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: startSync }, '▶ Start syncing'), tapBtn, h('button', { class: 'btn', type: 'button', onclick: () => track && (track.playing ? track.pause() : track.play()) }, '⏯')),
    h('div', { class: 'row sync-shift' },
      h('span', { class: 'small' }, 'All lines earlier / later:'),
      shiftBtn(-1, '−1 s', '1 second earlier'), shiftBtn(-0.1, '−0.1 s', '0.1 seconds earlier'),
      shiftBtn(0.1, '+0.1 s', '0.1 seconds later'), shiftBtn(1, '+1 s', '1 second later'),
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Play the song and tap once when the first line starts', onclick: startAlign }, '🎯 Tap to align'),
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Listen to the audio file and find where the UltraStar melody is sung', onclick: () => alignLyrics() }, '🪄 Auto-align')),
    syncStatus,
    syncList,
    h('div', { class: 'row top-space' },
      h('label', { class: 'inline' }, rightsIn, ' I have permission to store and use this song.'),
      saveButton,
      existing ? h('a', { class: 'btn', href: `#/song/${encodeURIComponent(song.id)}` }, 'Cancel') : null),
  );
  card.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); card.classList.add('dropping'); } });
  card.addEventListener('dragleave', (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove('dropping'); });
  card.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    card.classList.remove('dropping');
    takeFiles(e.dataTransfer.files);
  });
  const folders = folderLibraryControls();
  el.append(folders, card, voiceLabCard(), importExport());
  return () => { folders.destroy(); clearInterval(follow); document.removeEventListener('keydown', onKey); if (track) track.destroy(); };
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
      h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        const s = check(); if (!s) return;
        try {
          const saved = song.cloud ? await saveCloudSong({ ...s, id: song.id, cloud: true, revision: song.revision }, { rightsConfirmed: true }) : saveUserSong(s);
          toast('Saved ⭐', 'ok'); location.hash = `#/song/${encodeURIComponent(saved.id)}`;
        } catch (e) { msg.textContent = e.message; }
      } }, '💾 Save'),
      h('a', { class: 'btn', href: `#/remix/${encodeURIComponent(song.id)}` }, '🪄 Remix words instead'),
      h('a', { class: 'btn', href: `#/voicelab?song=${encodeURIComponent(song.id)}` }, '🔬 Compare robot singers'))));
  return null;
}

// The voice lab: the robot singers side by side (views/voicelab.js).
function voiceLabCard() {
  return h('section', { class: 'card' },
    h('h3', { style: { marginTop: 0 } }, '🔬 Voice lab: compare the robot singers'),
    h('p', { class: 'small' }, 'Hear the original robot singer (A), the improved one (B) and Clear English (C) sing the same lines with identical melody and timing, matched in volume, with or without the band. Switch instantly, repeat single words, or run a blind listening test.'),
    h('a', { class: 'btn', href: '#/voicelab' }, '🔬 Open the voice lab'));
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
    h('p', { class: 'small' }, 'JSON contains song details only. To move old browser songs with their audio to the cloud app, open your account and choose Export local backup with audio. Cloud recordings already persist across devices.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: exportAll }, '⬇️ Download song details (JSON)'),
      h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, '⬆️ Import songs'),
      fileIn));
}

