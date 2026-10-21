import { api, cloudSession, requireTeacher, onCloudSession } from './session.js';
import { getMedia, putMedia, newMediaId, deleteMedia } from '../media/store.js';
import { readSongBackup, MEDIA_ROLES } from '../media/backup.js';
import { mp3Blob } from '../media/mp3.js';
import { setCloudSongs, localUserSongs, markMigrated, getSong } from '../store.js';

const digest = async (blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('');
const cloudSongs = new Map();
onCloudSession((s) => { if (!s.principal) { cloudSongs.clear(); setCloudSongs([]); } });

export async function refreshCloudLibrary() {
  const current = cloudSession().principal;
  if (!current || current.role === 'student') return;
  const { songs } = await api('/api/songs');
  // Fetch manifests with a small concurrency limit; do not cache private lyrics in localStorage.
  const documents = [];
  for (let i = 0; i < songs.length; i += 5) {
    const batch = await Promise.all(songs.slice(i, i + 5).map((s) => api(`/api/songs/${s.id}`)));
    documents.push(...batch.map((d) => d.song));
  }
  if (cloudSession().principal?.id !== current.id) return;
  cloudSongs.clear();
  for (const song of documents) cloudSongs.set(song.id, song);
  setCloudSongs([...cloudSongs.values()]);
}

async function asMp3(blob, name, onProgress) {
  if (/\.mp3$/i.test(name) || blob.type === 'audio/mpeg') return blob;
  onProgress(`Converting ${name} to MP3…`);
  const context = new OfflineAudioContext(2, 1, 44100);
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  const left = Float32Array.from(decoded.getChannelData(0));
  const right = Float32Array.from(decoded.getChannelData(decoded.numberOfChannels > 1 ? 1 : 0));
  return mp3Blob([left, right], { rate: decoded.sampleRate });
}

export async function saveCloudSong(input, { rightsConfirmed = false, onProgress = () => {}, clientId } = {}) {
  const principal = requireTeacher();
  if (!rightsConfirmed) throw new Error('Confirm you have permission to store and use this song.');
  const song = structuredClone(input);
  if (song.audio?.mediaId) delete song.sourceFile;
  const created = song.cloud
    ? { id: song.id, revision: song.revision }
    : await api('/api/songs', { method: 'POST', body: { clientId: clientId || song.id } });
  // A retry uses the server's draft identity. Once a saved revision exists, never
  // overwrite it using an old browser copy without an explicit migration decision.
  if (!song.cloud && created.revision > 0) {
    const existing = (await api(`/api/songs/${created.id}`)).song;
    if (existing.folderImport && song.folderImport) { song.revision = existing.revision; }
    else throw new Error('This song is already in your cloud library. Open the cloud copy to edit it.');
  }
  const assets = {};
  for (const role of ['audio', 'karaoke', 'vocals', 'sourceFile']) {
    if (role === 'sourceFile' && assets.sourceFile) continue;
    const ref = song[role];
    if (!ref) continue;
    if (ref.assetId && !ref.mediaId) { assets[role] = ref.assetId; continue; }
    const original = ref.mediaId ? await getMedia(ref.mediaId) : null;
    if (!original) throw new Error(`${ref.name || role} is missing from this browser. Select the file again before migration.`);
    if (original.size > 64 * 1024 * 1024) throw new Error(`${ref.name} exceeds the 64 MB file limit.`);
    // Preserve a non-MP3 source recording in R2 as well as its MP3 derivative.
    if (role === 'audio' && !/\.mp3$/i.test(ref.name || '') && original.type !== 'audio/mpeg') {
      assets.sourceFile = await uploadFile(created.id, 'sourceFile', original, ref.name, onProgress);
    }
    const blob = role === 'sourceFile' ? original : await asMp3(original, ref.name || role, onProgress);
    assets[role] = await uploadFile(created.id, role, blob, role === 'sourceFile' ? ref.name : (ref.name || role).replace(/\.[^.]+$/, '') + '.mp3', onProgress);
  }
  onProgress('Saving lyrics and song details…');
  const { song: saved } = await api(`/api/songs/${created.id}/commit`, { method: 'POST', body: {
    baseRevision: song.revision ?? created.revision, song, assets, rightsConfirmed,
  } });
  if (cloudSession().principal?.id !== principal.id) throw new Error('Your account changed while saving. Sign in again.');
  cloudSongs.set(saved.id, saved); setCloudSongs([...cloudSongs.values()]);
  // New uploads were temporary browser copies. Legacy migration keeps every
  // original referenced by the old local song records until the teacher removes it.
  const legacyFiles = new Set(localUserSongs().flatMap((s) => ['audio', 'karaoke', 'vocals', 'sourceFile'].map((r) => s[r]?.mediaId)).filter(Boolean));
  await Promise.allSettled(['audio', 'karaoke', 'vocals', 'sourceFile'].map((r) => input[r]?.mediaId).filter((id) => id && !legacyFiles.has(id)).map(deleteMedia));
  return saved;
}
async function uploadFile(id, role, blob, name, onProgress) {
  onProgress(`Uploading ${name}…`);
  const checksum = await digest(blob);
  const reserved = await api(`/api/songs/${id}/assets`, { method: 'POST', body: { role, name, size: blob.size, checksum, mime: role === 'sourceFile' ? 'application/octet-stream' : 'audio/mpeg' } });
  if (!reserved.uploaded) await api(reserved.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': 'application/octet-stream' } });
  return reserved.assetId;
}
export async function deleteCloudSong(song) {
  await api(`/api/songs/${song.id}`, { method: 'DELETE', body: {} });
  cloudSongs.delete(song.id); setCloudSongs([...cloudSongs.values()]);
}
export async function playbackSong(song) {
  if (!song.cloud) return song;
  const { urls, expiresAt } = await api(`/api/songs/${song.id}/playback`, { method: 'POST', body: { revision: song.revision } });
  const copy = structuredClone(song);
  for (const role of ['audio', 'karaoke', 'vocals', 'sourceFile']) if (copy[role] && urls[role]) copy[role].url = urls[role];
  copy.playbackExpiresAt = expiresAt;
  return copy;
}
export async function cloudMediaBlob(ref, song) {
  if (ref?.mediaId) return getMedia(ref.mediaId);
  if (!ref?.assetId || !song.cloud) return null;
  const prepared = await playbackSong(song);
  const role = ['audio', 'karaoke', 'vocals', 'sourceFile'].find((r) => song[r]?.assetId === ref.assetId);
  const response = await fetch(prepared[role].url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not read this audio file. Sign in again.');
  return response.blob();
}

export async function migrateLocalSongs({ rightsConfirmed, onProgress = () => {}, onSong = () => {} } = {}) {
  const principal = requireTeacher();
  const result = { migrated: 0, errors: [] };
  for (const song of localUserSongs()) {
    try {
      onProgress(`Migrating ${song.title}…`);
      let saved;
      const reserved = await api('/api/songs', { method: 'POST', body: { clientId: song.id } });
      if (reserved.revision > 0) saved = (await api(`/api/songs/${reserved.id}`)).song;
      else saved = await saveCloudSong(song, { rightsConfirmed, onProgress });
      markMigrated(song.id, principal.id, saved.id);
      cloudSongs.set(saved.id, saved); setCloudSongs([...cloudSongs.values()]);
      result.migrated += 1; onSong(song, saved);
    } catch (error) { result.errors.push(`${song.title}: ${error.message}`); }
  }
  return result;
}

export async function resolveCloudSong(id) {
  const cached = getSong(id);
  if (cached) return cached;
  if (!cloudSession().principal || !/^[a-zA-Z0-9_-]{1,96}$/.test(id)) return null;
  const { song } = await api(`/api/songs/${id}`);
  cloudSongs.set(song.id, song); setCloudSongs([...cloudSongs.values()]);
  return song;
}

export async function importSongBackup(file, { rightsConfirmed, onProgress = () => {} } = {}) {
  const principal = requireTeacher();
  if (!rightsConfirmed) throw new Error('Confirm permission to store the songs in this backup.');
  onProgress('Checking the backup and audio checksums…');
  const { songs, files } = await readSongBackup(file);
  const result = { migrated: 0, errors: [] };
  for (const original of songs) {
    const staged = new Map();
    try {
      if (!original || original.cloud || !/^[a-zA-Z0-9_-]{1,96}$/.test(original.id || '')) throw new Error('Invalid legacy song identifier.');
      onProgress(`Importing ${original.title}…`);
      const reserved = await api('/api/songs', { method: 'POST', body: { clientId: original.id } });
      let saved;
      if (reserved.revision > 0) saved = (await api(`/api/songs/${reserved.id}`)).song;
      else {
        const song = structuredClone(original);
        for (const role of MEDIA_ROLES) if (song[role]?.mediaId) {
          const oldId = song[role].mediaId;
          if (!files.has(oldId)) throw new Error(`${song[role].name || role} was missing from the original browser backup. Select that file again in Studio.`);
          if (!staged.has(oldId)) {
            const id = newMediaId(); staged.set(oldId, id);
            await putMedia(id, files.get(oldId));
          }
          song[role].mediaId = staged.get(oldId);
        }
        saved = await saveCloudSong(song, { rightsConfirmed, onProgress });
      }
      if (cloudSession().principal?.id !== principal.id) throw new Error('Your account changed while importing. Sign in again.');
      if (localUserSongs().some((s) => s.id === original.id)) markMigrated(original.id, principal.id, saved.id);
      cloudSongs.set(saved.id, saved); setCloudSongs([...cloudSongs.values()]); result.migrated += 1;
    } catch (e) { result.errors.push(`${original?.title || 'Song'}: ${e.message}`); }
    finally { await Promise.allSettled([...staged.values()].map(deleteMedia)); }
  }
  return result;
}
