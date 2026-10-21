/* Read-only folder import. Poll while the app is open and save to private R2. */
import { userSongs, saveUserSong, newSongId, getSettings, setSettings } from '../store.js';
import { putMedia, getMedia, newMediaId, deleteMedia } from './store.js';
import { parseLyrics } from '../lyrics/lines.js';
import { AUDIO_FILE, LYRICS_FILE, filePath, fileStamp, groupSongFiles } from './song-files.js';
import { saveCloudSong } from '../cloud/library.js';
import { requireTeacher } from '../cloud/session.js';
import { alignSongLyrics, lyricAudio, lyricAlignmentMessage, lyricsSignature } from './lyric-alignment.js';

const FOLDER_KEY = 'library-folder-v1';
const listeners = new Set();
let folder = null;
let timer = null;
let busy = false;
let seen = new Map();
let state = { name: '', watching: false, busy: false, message: 'Choose a folder to add songs together with their karaoke, vocals and lyrics files.' };
let initialized;
const uploadRights = () => getSettings().songUploadPermission === true;
export function setFolderUploadRights(value) { setSettings({ songUploadPermission: !!value }); }

export const folderStatus = () => ({ ...state });
export function onFolderStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function update(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(folderStatus());
}

export async function directoryFiles(dir, prefix = '') {
  const files = [];
  for await (const entry of dir.values()) {
    const path = prefix + entry.name;
    if (entry.kind === 'directory') files.push(...await directoryFiles(entry, `${path}/`));
    else if (AUDIO_FILE.test(entry.name) || LYRICS_FILE.test(entry.name)) {
      const file = await entry.getFile();
      Object.defineProperty(file, 'webkitRelativePath', { value: path });
      files.push(file);
    }
  }
  return files;
}

export async function stableSongFiles(files, previous) {
  const groups = await groupSongFiles(files);
  const stable = groups.filter((g) => g.files.every((f) => f.size && previous.get(filePath(f)) === fileStamp(f)));
  return { files: stable.flatMap((g) => g.files), waiting: groups.length - stable.length };
}

// Components have separate stamps: adding a karaoke file must keep edited lyrics.
export async function importSongFiles(files, sourceId, {
  listSongs = userSongs, saveSong = saveUserSong, putFile = putMedia, removeFile = deleteMedia,
  readFeatures, onProgress = () => {},
} = {}) {
  const groups = await groupSongFiles(files);
  const result = { added: 0, updated: 0, unchanged: 0, errors: [], warnings: [] };
  for (const group of groups) {
    const created = [];
    try {
      if (group.error) throw group.error;
      const existing = listSongs().find((s) => s.folderImport?.key === group.key && (s.cloud || s.folderImport.sourceId === sourceId));
      const meta = group.timing?.meta || {};
      const fallback = /^(.*?)\s+-\s+(.+)$/.exec(group.base);
      const song = existing ? structuredClone(existing) : {
        id: newSongId(meta.title || group.base), title: meta.title || fallback?.[2] || group.base,
        artist: meta.artist || fallback?.[1] || '', source: 'none', synced: [],
        level: 'A1', ages: 'all', emoji: '🎵', hue: 245, grammar: [], vocab: [], themes: [],
      };
      const stamps = { ...existing?.folderImport?.stamps };
      let changed = false;
      let audioChanged = false;
      let lyricsChanged = false;
      for (const role of ['audio', 'karaoke', 'vocals']) {
        const file = group[role];
        if (!file || stamps[role] === fileStamp(file)) continue;
        const mediaId = newMediaId();
        await putFile(mediaId, file);
        created.push(mediaId);
        song[role] = { mediaId, name: file.name, ...(role === 'audio' ? {} : { offset: 0 }) };
        stamps[role] = fileStamp(file);
        changed = true;
        if (role === 'audio') audioChanged = true;
      }
      if (group.lyrics && stamps.lyrics !== fileStamp(group.lyrics)) {
        song.synced = group.timing.format === 'text' ? parseLyrics(group.text.trim()) : group.timing.lines;
        stamps.lyrics = fileStamp(group.lyrics);
        changed = true;
        lyricsChanged = true;
      }
      // A pair of stems is playable even without the original recording.
      if (!stamps.audio && (song.karaoke || song.vocals)) {
        song.audio = song.karaoke
          ? { ...song.karaoke, stems: !!song.vocals }
          : { ...song.vocals };
      }
      if (song.audio) song.source = 'audio';
      if (!changed) { result.unchanged += 1; continue; }
      song.folderImport = { ...song.folderImport, sourceId, key: group.key, stamps };
      const referenceAdded = !lyricAudio(existing) && lyricAudio(song);
      if (lyricsChanged || audioChanged || referenceAdded) {
        const previousSignature = existing?.folderImport?.timing?.signature;
        const edited = existing && !lyricsChanged && (!previousSignature || previousSignature !== await lyricsSignature(existing.synced));
        if (edited) {
          result.warnings.push(`${group.base}: Lyrics kept with your edits. Open Studio to check or repair their timing.`);
        } else {
          const aligned = await alignSongLyrics(song, { readFeatures, onProgress: (message) => onProgress(`${song.title}: ${message}`) });
          song.synced = aligned.synced;
          song.folderImport.timing = { signature: await lyricsSignature(song.synced), status: aligned.status };
          if (['uncertain', 'error'].includes(aligned.status)) result.warnings.push(`${group.base}: ${lyricAlignmentMessage(aligned)}`);
        }
      }
      await saveSong(song);
      result[existing ? 'updated' : 'added'] += 1;
    } catch (error) {
      await Promise.allSettled(created.map((id) => removeFile(id)));
      result.errors.push(`${group.base}: ${error.message}`);
    }
  }
  return result;
}

function report(result) {
  const parts = [];
  if (result.added) parts.push(`${result.added} song${result.added === 1 ? '' : 's'} added`);
  if (result.updated) parts.push(`${result.updated} updated`);
  if (!parts.length) parts.push('No new or changed songs');
  if (result.errors.length) parts.push(`${result.errors.length} could not be imported: ${result.errors[0]}`);
  if (result.warnings.length) parts.push(`${result.warnings.length} timing checks need attention: ${result.warnings[0]}`);
  update({ message: parts.join(' · '), changed: result.added + result.updated });
  return result;
}

export async function scanFolder() {
  if (!folder || busy) return;
  busy = true;
  const current = folder;
  update({ busy: true, changed: 0, message: 'Checking for new and changed songs…' });
  try {
    const files = await directoryFiles(current.handle);
    if (folder !== current) return;
    const next = new Map(files.map((f) => [filePath(f), fileStamp(f)]));
    // Wait for the whole group to stop changing, including files still copying.
    const stable = await stableSongFiles(files, seen);
    seen = next;
    const result = await importCloudFiles(stable.files, current.id);
    if (folder !== current) return;
    report(result);
    if (stable.waiting) update({ message: `${state.message}. Waiting for ${stable.waiting} song group${stable.waiting === 1 ? '' : 's'} to finish copying; scan again shortly.` });
  } catch (error) {
    if (folder === current) {
      stopWatching();
      update({ message: `Could not read the folder: ${error.message}. Use Reconnect folder to try again.` });
    }
  } finally {
    busy = false;
    update({ busy: false });
  }
}

export function stopWatching() {
  clearInterval(timer);
  timer = null;
  update({ watching: false });
}

export async function startWatching() {
  if (!folder) return;
  requireTeacher();
  if (!uploadRights()) { update({ message: 'Confirm permission to store these songs, then reconnect the folder.' }); return; }
  const current = folder;
  if (await current.handle.requestPermission({ mode: 'read' }) !== 'granted') {
    update({ message: 'Folder access was not granted. Reconnect when you are ready.' });
    return;
  }
  if (folder !== current) return;
  clearInterval(timer);
  timer = setInterval(scanFolder, 5000);
  update({ watching: true });
  await scanFolder();
}

export async function chooseSongFolder() {
  requireTeacher();
  if (!uploadRights()) throw new Error('Confirm permission to store and use these songs before choosing the folder.');
  const handle = await window.showDirectoryPicker({ mode: 'read', id: 'singing-songs' });
  stopWatching();
  seen = new Map();
  const same = folder && await handle.isSameEntry(folder.handle);
  folder = { id: same ? folder.id : newMediaId(), handle };
  await putMedia(FOLDER_KEY, folder);
  update({ name: handle.name });
  await startWatching();
}

export function initFolderLibrary() {
  if (initialized) return initialized;
  initialized = (async () => {
    try {
      folder = await getMedia(FOLDER_KEY);
      if (!folder) return;
      update({ name: folder.handle.name });
      update({ message: 'Sign in, confirm permission to upload, and reconnect this folder to check for new songs.' });
    } catch (error) {
      update({ message: `Could not restore the folder: ${error.message}` });
    }
  })();
  return initialized;
}

// Browsers without directory handles can still import a whole folder at once.
export async function importFolderSelection(files) {
  if (busy) return;
  requireTeacher();
  if (!uploadRights()) throw new Error('Confirm permission to store and use these songs before importing.');
  busy = true;
  update({ busy: true, changed: 0, message: 'Importing songs…' });
  try {
    const root = files[0]?.webkitRelativePath?.split('/')[0] || 'Selected files';
    return report(await importCloudFiles(files, `selection:${root}`));
  } finally {
    busy = false;
    update({ busy: false });
  }
}

async function importCloudFiles(files, sourceId) {
  requireTeacher();
  if (!uploadRights()) throw new Error('Confirm permission to upload these songs.');
  return importSongFiles(files, sourceId, { onProgress: (message) => update({ message }), saveSong: async (song) => {
    const key = song.folderImport.key;
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    const clientId = `folder-${[...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    return saveCloudSong(song, { rightsConfirmed: true, clientId, onProgress: (message) => update({ message }) });
  } });
}
