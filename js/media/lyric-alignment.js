/* Original, karaoke and vocals share a recording timeline. Align the lyrics
 * once to that timeline; never move the companion recordings independently. */
import { decodeMono, features, alignNotes } from './align.js';
import { shiftSynced } from './timing.js';
import { getMedia } from './store.js';
import { cloudMediaBlob } from '../cloud/library.js';

export function lyricAudio(song) {
  if (song?.source !== 'audio') return null;
  // With no original, isolated vocals contain the melody; the backing does not.
  return song.audio?.stems ? song.vocals || song.audio : song.audio || song.vocals;
}

export async function audioFeatures(ref, song) {
  const blob = ref.assetId ? await cloudMediaBlob(ref, song) : await getMedia(ref.mediaId);
  if (!blob) throw new Error('The recording is missing. Select the audio file again.');
  return features(await decodeMono(blob));
}

// Return new timing without mutating the song. Callers can discard an obsolete
// result if the teacher changes the lyrics while decoding is in progress.
export async function alignSongLyrics(song, { readFeatures = audioFeatures, onProgress = () => {} } = {}) {
  const synced = structuredClone(song.synced || []);
  const notes = synced.flatMap((line) => line.notes || []);
  if (!notes.some((note) => Number.isFinite(note[2]))) return { status: 'no-notes', synced, offset: 0 };
  const ref = lyricAudio(song);
  if (!ref || !(ref.mediaId || ref.assetId)) return { status: 'no-audio', synced, offset: 0 };
  onProgress('Listening for the melody in your audio…');
  try {
    const match = alignNotes(await readFeatures(ref, song), notes);
    if (!match.confident) return { status: 'uncertain', synced, offset: 0 };
    if (Math.abs(match.offset) < 0.03) return { status: 'unchanged', synced, offset: 0 };
    return { status: 'aligned', synced: shiftSynced(synced, match.offset), offset: match.offset };
  } catch (error) {
    return { status: 'error', synced, offset: 0, error: error.message };
  }
}

export function lyricAlignmentMessage(result) {
  if (result.status === 'aligned') return `All lyrics moved ${Math.abs(result.offset).toFixed(2)} s ${result.offset < 0 ? 'earlier' : 'later'} to match the recording. Play a line to check.`;
  if (result.status === 'unchanged') return 'Checked against your audio: the lyrics are already in time ✓';
  if (result.status === 'uncertain') return 'Could not find the melody for sure. Timing was kept; check it in Studio and use Tap to align if needed.';
  if (result.status === 'error') return `Could not listen to the audio: ${result.error}. Timing was kept; check it in Studio.`;
  if (result.status === 'no-audio') return 'Add an audio file to align automatically. For YouTube, use Tap to align.';
  return 'Automatic alignment needs UltraStar melody notes. For other lyrics, use All lines earlier / later or Tap to align.';
}

// Remember the timing produced by folder import, so replacing the recording
// cannot silently overwrite subsequent Studio corrections.
export async function lyricsSignature(synced) {
  const canonical = JSON.stringify(synced || [], (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
