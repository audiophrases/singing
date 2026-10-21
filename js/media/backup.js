// Portable legacy-song transfer. Binary blobs stay binary (no base64 expansion).
const encoder = new TextEncoder();
const magic = encoder.encode('SINGING1\n');
const MAX_HEADER = 4 * 1024 * 1024;
export const MEDIA_ROLES = ['audio', 'karaoke', 'vocals', 'sourceFile'];
const checksum = async (blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((n) => n.toString(16).padStart(2, '0')).join('');
const requireValid = (condition, message) => { if (!condition) throw new Error(message); };

export async function createSongBackup(songs, readMedia) {
  const files = [], blobs = [], missing = [], seen = new Set();
  const originals = structuredClone(songs.filter((song) => !song.cloud));
  for (const song of originals) for (const role of MEDIA_ROLES) {
    const id = song[role]?.mediaId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const blob = await readMedia(id);
    if (!(blob instanceof Blob)) { missing.push(`${song.title}: ${song[role].name || role}`); continue; }
    requireValid(blob.size > 0 && blob.size <= 64 * 1024 * 1024, `Cannot back up ${song.title}: each audio file must be between 1 byte and 64 MB.`);
    files.push({ id, size: blob.size, type: blob.type || 'application/octet-stream', checksum: await checksum(blob) });
    blobs.push(blob);
  }
  const header = encoder.encode(JSON.stringify({ app: 'singing', version: 1, songs: originals, files, missing }));
  requireValid(header.length <= MAX_HEADER && originals.length <= 1000 && files.length <= 4000, 'This backup is too large. Export fewer local songs at a time.');
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, header.length);
  return { blob: new Blob([magic, length, header, ...blobs], { type: 'application/octet-stream' }), missing, count: originals.length };
}

export async function readSongBackup(blob) {
  requireValid(blob instanceof Blob && blob.size >= magic.length + 4, 'Choose a Singing backup (.singing) file.');
  const prefix = new Uint8Array(await blob.slice(0, magic.length + 4).arrayBuffer());
  requireValid(magic.every((n, i) => prefix[i] === n), 'This is not a Singing backup.');
  const size = new DataView(prefix.buffer).getUint32(magic.length);
  let offset = magic.length + 4 + size;
  requireValid(size > 0 && size <= MAX_HEADER && offset <= blob.size, 'The backup header is incomplete or too large.');
  let header;
  try { header = JSON.parse(await blob.slice(magic.length + 4, offset).text()); }
  catch { throw new Error('The backup header cannot be read.'); }
  requireValid(header.app === 'singing' && header.version === 1 && Array.isArray(header.songs) && header.songs.length <= 1000 && Array.isArray(header.files) && header.files.length <= 4000, 'Unsupported Singing backup.');
  const files = new Map();
  for (const entry of header.files) {
    requireValid(typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length <= 256 && !files.has(entry.id) && Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= 64 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(entry.checksum || '') && typeof entry.type === 'string' && entry.type.length <= 160, 'Invalid audio entry in backup.');
    requireValid(offset + entry.size <= blob.size, 'An audio file in this backup is incomplete.');
    const audio = blob.slice(offset, offset + entry.size, entry.type); offset += entry.size;
    requireValid(await checksum(audio) === entry.checksum, 'An audio file in this backup is damaged. Keep the original backup and export again.');
    files.set(entry.id, audio);
  }
  requireValid(offset === blob.size, 'Unexpected data at the end of this backup.');
  return { songs: header.songs, files, missing: header.missing || [] };
}
