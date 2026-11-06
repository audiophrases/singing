import { bodyJson, hash, token, safeId, requireThat, json, HttpError } from './http.js';
import { teacher } from './auth.js';

const ROLES = ['audio', 'karaoke', 'vocals', 'sourceFile'];
const MAX_FILE = 64 * 1024 * 1024;
const MAX_LESSON = 400 * 1024;
const MAX_ARTWORK = 512 * 1024;
const isJpeg = (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
const artworkUrl = (assetId) => `/api/art/${assetId}`;
export async function ownedSong(env, id, principal) {
  teacher(principal);
  const song = await env.DB.prepare('SELECT * FROM songs WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').bind(id, principal.id).first();
  requireThat(song, 404, 'Song not found.');
  return song;
}
export async function manifest(env, id, revision) {
  const row = await env.DB.prepare('SELECT manifest_key FROM song_versions WHERE song_id = ? AND revision = ?').bind(id, revision).first();
  requireThat(row, 404, 'Song version not found.');
  const object = await env.SONGS.get(row.manifest_key);
  requireThat(object, 503, 'Song data is temporarily unavailable.');
  return object.json();
}
// A lesson pack without its teacher section (js/lesson/pack.js): the plan and
// the content warnings are not for students or the public player.
const forStudents = (song) => {
  if (!song.lesson) return song;
  const { teacher, ...lesson } = song.lesson;
  return { ...song, lesson };
};
export function visibleSong(document, principal) {
  if (principal.role !== 'student') return document;
  const { folderImport, sourceFile, about, clientId, ...song } = document;
  return { ...forStudents(song), mine: false };
}
// The public player: band songs the owner switched to public. Only the owner
// can switch a song to public, and only while it is played by the band. Until
// the owner first opens their library (started), it plays the starter songs.
export async function publicSongs(env) {
  const started = !!(await env.DB.prepare('SELECT 1 FROM public_library WHERE id = 1').first());
  if (!started) return json({ songs: [], started });
  const { results } = await env.DB.prepare('SELECT id, revision FROM songs WHERE is_public = 1 AND deleted_at IS NULL AND revision > 0 ORDER BY updated_at DESC LIMIT 500').all();
  const documents = await Promise.all(results.map((row) => manifest(env, row.id, row.revision)));
  const songs = documents.filter((doc) => (doc.source || 'band') === 'band').map(({ folderImport, sourceFile, audio, karaoke, vocals, cloud, revision, status, createdAt, ...song }) => ({ ...forStudents(song), public: true }));
  return json({ songs, started });
}
// A song's picture belongs to the song, not to a revision: saving one must not
// make a song open in the Studio out of date, and an assignment pinned to an
// older revision shows it too.
async function withArtwork(env, document) {
  const row = await env.DB.prepare("SELECT id FROM assets WHERE song_id = ? AND role = 'artwork' ORDER BY created_at DESC LIMIT 1").bind(document.id).first();
  return row ? { ...document, artwork: artworkUrl(row.id) } : document;
}
// Who made a song a student saved (cloudflare/student-songs.js): for the owner only.
const madeBy = (row) => (row.made_by ? { madeBy: JSON.parse(row.made_by) } : {});
export function cleanSong(input) {
  requireThat(input && typeof input === 'object' && !Array.isArray(input), 400, 'Song required.');
  requireThat(typeof input.title === 'string' && input.title.trim().length > 0 && input.title.length <= 120, 400, 'A song title is required (120 characters maximum).');
  requireThat(['audio', 'youtube', 'none', 'band'].includes(input.source || 'band'), 400, 'Invalid song source.');
  requireThat(Array.isArray(input.synced) || Array.isArray(input.lines), 400, 'Lyrics required.');
  const clean = {};
  for (const key of ['title', 'artist', 'credit', 'level', 'ages', 'emoji', 'hue', 'grammar', 'themes', 'vocab', 'about', 'source', 'youtube', 'synced', 'lines', 'bpm', 'meter', 'key', 'style', 'intro', 'pickup', 'outro', 'phrases', 'round', 'duration', 'composed', 'knobs', 'folderImport', 'lesson']) {
    if (input[key] !== undefined) clean[key] = input[key];
  }
  if (clean.lesson !== undefined) requireThat(clean.lesson && typeof clean.lesson === 'object' && !Array.isArray(clean.lesson) && JSON.stringify(clean.lesson).length <= MAX_LESSON, 400, 'This lesson pack is too large.');
  return clean;
}

export async function songRoutes(request, env, path, principal, canReadAssigned = async () => false) {
  if (path === '/api/songs' && request.method === 'GET') {
    teacher(principal);
    if (principal.role === 'owner') await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO public_library (id, started_at) VALUES (1, ?)').bind(Date.now()),
      env.DB.prepare('INSERT INTO site_owner (id, principal_id, seen_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET principal_id = excluded.principal_id, seen_at = excluded.seen_at').bind(principal.id, Date.now()),
    ]);
    const { results } = await env.DB.prepare('SELECT id, revision, title, status, created_at, updated_at FROM songs WHERE owner_id = ? AND deleted_at IS NULL AND revision > 0 ORDER BY updated_at DESC LIMIT 1000').bind(principal.id).all();
    return json({ songs: results });
  }
  if (path === '/api/songs' && request.method === 'POST') {
    teacher(principal);
    const { clientId } = await bodyJson(request, 4096);
    requireThat(safeId(clientId), 400, 'Invalid song identifier.');
    const id = crypto.randomUUID(); const now = Date.now();
    await env.DB.prepare('INSERT OR IGNORE INTO songs (id, owner_id, client_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, principal.id, clientId, now, now).run();
    const song = await env.DB.prepare('SELECT * FROM songs WHERE owner_id = ? AND client_id = ? AND deleted_at IS NULL').bind(principal.id, clientId).first();
    requireThat(song, 409, 'This imported song was deleted. Make a new copy to restore it.');
    return json({ id: song.id, revision: song.revision });
  }
  const match = /^\/api\/songs\/([a-zA-Z0-9_-]+)(?:\/(assets|commit|playback|visibility|artwork))?$/.exec(path);
  if (!match) return null;
  const [, id, action] = match;
  let song;
  if (principal.role === 'student' && (request.method === 'GET' || action === 'playback')) {
    song = await env.DB.prepare('SELECT * FROM songs WHERE id = ? AND deleted_at IS NULL').bind(id).first();
    requireThat(song, 404, 'Song not found.');
  } else song = await ownedSong(env, id, principal);
  if (!action && request.method === 'GET') {
    const revision = Number(new URL(request.url).searchParams.get('revision')) || song.revision;
    if (principal.role === 'student') requireThat(await canReadAssigned(env, id, revision, principal), 404, 'Song not assigned to your class.');
    const document = await withArtwork(env, visibleSong(await manifest(env, id, revision), principal));
    return json({ song: principal.role === 'student' ? document : { ...document, public: song.is_public === 1, ...madeBy(song) } });
  }
  if (action === 'visibility' && request.method === 'POST') {
    const body = await bodyJson(request, 1024);
    requireThat(typeof body.public === 'boolean', 400, 'Choose public or private.');
    if (body.public) {
      requireThat(principal.role === 'owner', 403, 'Only the owner account can put songs on the public page.');
      requireThat(song.revision > 0 && ((await manifest(env, id, song.revision)).source || 'band') === 'band', 400, 'Only songs played by the band can be public.');
    }
    await env.DB.prepare('UPDATE songs SET is_public = ? WHERE id = ?').bind(body.public ? 1 : 0, id).run();
    return json({ public: body.public });
  }
  if (!action && request.method === 'DELETE') {
    // Keep referenced objects and immutable revisions; media access is revoked immediately.
    await env.DB.prepare('UPDATE songs SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(Date.now(), Date.now(), id).run();
    return json({ ok: true });
  }
  if (action === 'assets' && request.method === 'POST') {
    const body = await bodyJson(request, 8192);
    const { role, checksum, size } = body;
    const maxFile = Math.min(MAX_FILE, Number(env.MAX_FILE_BYTES) || MAX_FILE);
    requireThat(ROLES.includes(role) && /^[a-f0-9]{64}$/.test(checksum || '') && Number.isSafeInteger(size) && size > 0 && size <= maxFile, 400, 'Invalid audio file or file exceeds the upload limit.');
    requireThat(role === 'sourceFile' || body.mime === 'audio/mpeg', 415, 'Playback files must be MP3.');
    const mime = role === 'sourceFile' ? 'application/octet-stream' : 'audio/mpeg';
    const assetId = crypto.randomUUID(); const key = `owners/${await hash(principal.id)}/assets/${assetId}`;
    // Atomic quota reservation includes pending uploads and retained revisions.
    await env.DB.prepare(`INSERT OR IGNORE INTO assets (id,song_id,owner_id,role,object_key,name,mime,size,checksum,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(size),0) FROM assets WHERE owner_id = ?) + ? <= ?`)
      .bind(assetId, id, principal.id, role, key, String(body.name || 'audio.mp3').slice(0, 160), mime, size, checksum, Date.now(), principal.id, size, Number(env.OWNER_STORAGE_BYTES) || 1024 * 1024 * 1024).run();
    const asset = await env.DB.prepare('SELECT * FROM assets WHERE song_id = ? AND role = ? AND checksum = ?').bind(id, role, checksum).first();
    requireThat(asset, 413, 'Your storage allowance is full. Contact the administrator.');
    return json({ assetId: asset.id, uploaded: asset.state === 'uploaded', uploadUrl: `/api/assets/${asset.id}` });
  }
  if (action === 'artwork' && request.method === 'PUT') return await saveArtwork(request, env, song, principal);
  if (action === 'commit' && request.method === 'POST') {
    const body = await bodyJson(request);
    requireThat(body.baseRevision === song.revision, 409, 'This song changed on another device. Reload before saving.');
    requireThat(body.rightsConfirmed === true, 400, 'Confirm you have permission to store and use this song.');
    const clean = cleanSong(body.song); const refs = {};
    for (const role of ROLES) {
      const ref = body.assets?.[role];
      if (!ref) continue;
      const asset = await env.DB.prepare("SELECT * FROM assets WHERE id = ? AND song_id = ? AND owner_id = ? AND role = ? AND state = 'uploaded'").bind(ref, id, principal.id, role).first();
      requireThat(asset, 400, `The ${role} upload is incomplete.`);
      requireThat(await env.SONGS.head(asset.object_key), 503, 'An uploaded file is unavailable. Try again.');
      const offset = Number(body.song[role]?.offset) || 0;
      requireThat(Math.abs(offset) <= 3600, 400, 'Invalid audio offset.');
      refs[role] = asset;
      clean[role] = { assetId: asset.id, name: asset.name, offset, ...(role === 'audio' && body.song.audio?.stems ? { stems: true } : {}) };
    }
    requireThat(clean.source !== 'audio' || refs.audio, 400, 'An original MP3 is required for an audio song.');
    const revision = song.revision + 1;
    const ready = clean.source !== 'audio' || !!(refs.audio && refs.karaoke && clean.synced?.length && clean.synced.every((l) => Number.isFinite(l.start)));
    const document = { ...clean, id, clientId: song.client_id, cloud: true, revision, status: ready ? 'ready' : 'draft', createdAt: song.created_at, updatedAt: Date.now() };
    const key = `owners/${await hash(principal.id)}/songs/${id}/${revision}-${crypto.randomUUID()}.json`;
    await env.SONGS.put(key, JSON.stringify(document), { httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' } });
    // The conditional update and following inserts are one D1 transaction. A racing save
    // fails the version foreign key / uniqueness constraint and rolls back the batch.
    try {
      const result = await env.DB.batch([
        // A public song stays public through edits, unless it stops being a band song.
        env.DB.prepare("UPDATE songs SET revision = ?, title = ?, status = ?, updated_at = ?, is_public = CASE WHEN ? = 'band' THEN is_public ELSE 0 END WHERE id = ? AND revision = ? AND deleted_at IS NULL").bind(revision, document.title, document.status, document.updatedAt, document.source || 'band', id, body.baseRevision),
        env.DB.prepare('INSERT INTO song_versions (song_id,revision,manifest_key,created_at) SELECT id,revision,?,? FROM songs WHERE id = ? AND revision = ?').bind(key, Date.now(), id, revision),
        ...Object.entries(refs).map(([role, asset]) => env.DB.prepare('INSERT INTO version_assets (song_id,revision,role,asset_id) VALUES (?,?,?,?)').bind(id, revision, role, asset.id)),
      ]);
      requireThat(result[0].meta.changes === 1, 409, 'This song changed on another device. Reload before saving.');
    } catch (error) {
      // Only our uncommitted manifest is removed, never media referenced by a revision.
      await env.SONGS.delete(key);
      if (error.status) throw error;
      throw new HttpError(409, 'This song changed on another device. Reload before saving.');
    }
    return json({ song: { ...await withArtwork(env, document), public: song.is_public === 1 && (document.source || 'band') === 'band', ...madeBy(song) } });
  }
  if (action === 'playback' && request.method === 'POST') {
    requireThat(song.revision > 0, 404, 'Save this song first.');
    const body = await bodyJson(request, 4096);
    const revision = Number(body.revision) || song.revision;
    requireThat(Number.isInteger(revision) && revision > 0 && revision <= song.revision, 404, 'Song version not found.');
    if (principal.role === 'student') requireThat(await canReadAssigned(env, id, revision, principal), 404, 'Song not assigned to your class.');
    const grant = token(); const expiresAt = Date.now() + 10 * 60 * 1000;
    await env.DB.prepare('INSERT INTO playback_grants (token_hash,session_hash,song_id,revision,expires_at) VALUES (?,?,?,?,?)').bind(await hash(grant), principal.sessionHash, id, revision, expiresAt).run();
    const doc = await manifest(env, id, revision); const urls = {};
    for (const role of ROLES) if (doc[role]?.assetId && (role !== 'sourceFile' || principal.role !== 'student')) urls[role] = `/api/media/${id}/${role}?grant=${grant}`;
    return json({ urls, expiresAt });
  }
  return null;
}

async function saveArtwork(request, env, song, principal) {
  requireThat(song.revision > 0, 404, 'Save this song first.');
  const size = Number(request.headers.get('Content-Length'));
  requireThat(size > 0 && size <= MAX_ARTWORK, 413, 'This picture is too large.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  // Only JPEG: a teacher's file must not be able to run as a page on this site.
  requireThat(bytes.length === size && isJpeg(bytes), 415, 'Use a JPEG picture.');
  const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const { results: previous } = await env.DB.prepare("SELECT id, object_key, checksum FROM assets WHERE song_id = ? AND role = 'artwork'").bind(song.id).all();
  const same = previous.find((asset) => asset.checksum === checksum);
  if (same) return json({ artwork: artworkUrl(same.id) });
  const assetId = crypto.randomUUID(); const key = `owners/${await hash(principal.id)}/assets/${assetId}`;
  await env.SONGS.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg', cacheControl: 'private, max-age=31536000, immutable' } });
  // One transaction, so a full storage allowance leaves the old picture in place.
  const [added] = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO assets (id,song_id,owner_id,role,object_key,name,mime,size,checksum,state,created_at)
      SELECT ?,?,?,'artwork',?,'cover.jpg','image/jpeg',?,?,'uploaded',? WHERE (SELECT COALESCE(SUM(size),0) FROM assets WHERE owner_id = ?) + ? <= ?`)
      .bind(assetId, song.id, principal.id, key, size, checksum, Date.now(), principal.id, size, Number(env.OWNER_STORAGE_BYTES) || 1024 * 1024 * 1024),
    env.DB.prepare("DELETE FROM assets WHERE song_id = ? AND role = 'artwork' AND id != ? AND EXISTS (SELECT 1 FROM assets WHERE id = ?)").bind(song.id, assetId, assetId),
  ]);
  if (!added.meta.changes) {
    await env.SONGS.delete(key);
    // Another device saved this same picture a moment ago.
    const saved = await env.DB.prepare("SELECT id FROM assets WHERE song_id = ? AND role = 'artwork' AND checksum = ?").bind(song.id, checksum).first();
    requireThat(saved, 413, 'Your storage allowance is full. Contact the administrator.');
    return json({ artwork: artworkUrl(saved.id) });
  }
  await Promise.allSettled(previous.map((asset) => env.SONGS.delete(asset.object_key)));
  return json({ artwork: artworkUrl(assetId) });
}

// A new picture gets a new address, so a browser can keep this one for good.
// The address is random and appears only in the song, for those who can read it.
export async function serveArtwork(request, env, assetId) {
  const asset = await env.DB.prepare("SELECT a.object_key, a.size FROM assets a JOIN songs s ON s.id = a.song_id WHERE a.id = ? AND a.role = 'artwork' AND s.deleted_at IS NULL").bind(assetId).first();
  requireThat(asset, 404, 'Picture not found.');
  const object = await env.SONGS.get(asset.object_key);
  requireThat(object, 404, 'Picture not found.');
  return new Response(request.method === 'HEAD' ? null : object.body, { headers: {
    'Content-Type': 'image/jpeg', 'Content-Length': String(asset.size), 'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Disposition': 'inline',
  } });
}

export async function uploadAsset(request, env, assetId, principal) {
  teacher(principal);
  const asset = await env.DB.prepare('SELECT a.* FROM assets a JOIN songs s ON s.id = a.song_id WHERE a.id = ? AND a.owner_id = ? AND s.deleted_at IS NULL').bind(assetId, principal.id).first();
  requireThat(asset, 404, 'Upload not found.');
  if (asset.state === 'uploaded') return json({ ok: true });
  requireThat(Number(request.headers.get('Content-Length')) === asset.size, 400, 'File size does not match the reserved upload.');
  requireThat(request.body, 400, 'Audio file required.');
  const stream = new FixedLengthStream(asset.size);
  try {
    await Promise.all([
      request.body.pipeTo(stream.writable),
      env.SONGS.put(asset.object_key, stream.readable, { sha256: asset.checksum, httpMetadata: { contentType: asset.mime, cacheControl: 'private, no-store' } }),
    ]);
  } catch { throw new HttpError(400, 'The upload was interrupted or its checksum did not match. Retry the file.'); }
  await env.DB.prepare("UPDATE assets SET state = 'uploaded' WHERE id = ?").bind(assetId).run();
  return json({ ok: true });
}

export async function serveMedia(request, env, id, role, principal, canReadAssigned = async () => false) {
  const grant = new URL(request.url).searchParams.get('grant') || '';
  const row = await env.DB.prepare(`SELECT g.revision,s.owner_id FROM playback_grants g JOIN songs s ON s.id = g.song_id
    WHERE g.token_hash = ? AND g.session_hash = ? AND g.song_id = ? AND g.expires_at > ? AND s.deleted_at IS NULL`)
    .bind(await hash(grant), principal.sessionHash, id, Date.now()).first();
  requireThat(row, 403, 'Playback access expired. Reload the song.');
  requireThat(principal.role === 'student'
    ? role !== 'sourceFile' && await canReadAssigned(env, id, row.revision, principal)
    : row.owner_id === principal.id, 403, 'Playback is no longer authorized.');
  const asset = await env.DB.prepare('SELECT a.* FROM version_assets v JOIN assets a ON a.id = v.asset_id WHERE v.song_id = ? AND v.revision = ? AND v.role = ?').bind(id, row.revision, role).first();
  requireThat(asset, 404, 'Audio file not found.');
  const range = request.headers.get('Range');
  requireThat(!range || /^bytes=\d*-\d*$/.test(range), 416, 'Invalid byte range.');
  if (range) {
    const [, first, last] = /^bytes=(\d*)-(\d*)$/.exec(range);
    requireThat((first || last) && (!first || Number(first) < asset.size) && (!first || !last || Number(last) >= Number(first)) && (first || Number(last) > 0), 416, 'Byte range is outside this file.');
  }
  const object = await env.SONGS.get(asset.object_key, range ? { range: request.headers } : undefined);
  requireThat(object, 404, 'Audio file not found.');
  const headers = { 'Content-Type': asset.mime, 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Disposition': 'inline' };
  let status = 200;
  if (range && object.range) {
    const r = object.range; const offset = r.suffix != null ? Math.max(0, object.size - r.suffix) : r.offset || 0;
    const length = r.suffix != null ? object.size - offset : r.length;
    headers['Content-Range'] = `bytes ${offset}-${offset + length - 1}/${object.size}`;
    headers['Content-Length'] = String(length); status = 206;
  } else headers['Content-Length'] = String(object.size);
  return new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
}
