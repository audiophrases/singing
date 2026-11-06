/*
 * Songs students make in the Song maker. A student signs in to save one, and
 * keeps their own copy: listed on any device and deletable. Every save also
 * puts a private copy in the owner's library, with the student's name and
 * class (songs.made_by), so the owner knows who made it. Saving the same song
 * again sends "Title (v2)" as a new song, leaving the owner's copy of version 1
 * as the owner edited it. Deleting their copy does not delete the owner's.
 */
import { bodyJson, hash, json, requireThat, safeId, HttpError } from './http.js';
import { identity } from './auth.js';
import { manifest, cleanSong } from './songs.js';

const MAX_SONGS = 200;

async function ownSong(env, id, principal) {
  const song = await env.DB.prepare('SELECT * FROM songs WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').bind(id, principal.id).first();
  requireThat(song, 404, 'Song not found.');
  return song;
}
const listed = (document) => ({ ...document, studentSong: true });

export async function studentSongRoutes(request, env, path, principal) {
  const match = /^\/api\/my-songs(?:\/([a-zA-Z0-9_-]+))?$/.exec(path);
  if (!match) return null;
  requireThat(principal.role === 'student', 403, 'Sign in with your school account to save songs.');
  const [, id] = match;
  if (!id && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, revision FROM songs WHERE owner_id = ? AND deleted_at IS NULL AND revision > 0 ORDER BY updated_at DESC LIMIT ?').bind(principal.id, MAX_SONGS).all();
    return json({ songs: (await Promise.all(results.map((row) => manifest(env, row.id, row.revision)))).map(listed) });
  }
  if (id && request.method === 'DELETE') {
    await ownSong(env, id, principal);
    await env.DB.prepare('UPDATE songs SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(Date.now(), Date.now(), id).run();
    return json({ ok: true });
  }
  if (id || request.method !== 'POST') return null;

  const body = await bodyJson(request);
  requireThat(!body.song?.protected && !body.song?.access && !body.song?.cloud, 403, 'Shared songs can only be saved as expiring bookmarks.');
  const clean = cleanSong(body.song);
  requireThat((clean.source || 'band') === 'band', 400, 'Only songs from the Song maker can be saved here.');
  delete clean.folderImport;
  delete clean.lesson; // lesson packs are the teacher's: the Song maker has none
  const owner = await env.DB.prepare('SELECT principal_id FROM site_owner WHERE id = 1').first();
  requireThat(owner, 503, 'Your teacher has not set up Singing yet. Try again later.');
  let song;
  if (body.id) song = await ownSong(env, body.id, principal);
  else {
    requireThat(safeId(body.clientId), 400, 'Invalid song identifier.');
    const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM songs WHERE owner_id = ? AND deleted_at IS NULL').bind(principal.id).first();
    requireThat(count < MAX_SONGS, 413, 'You have saved the most songs you can. Delete one first.');
    const now = Date.now();
    await env.DB.prepare('INSERT OR IGNORE INTO songs (id, owner_id, client_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), principal.id, body.clientId, now, now).run();
    song = await env.DB.prepare('SELECT * FROM songs WHERE owner_id = ? AND client_id = ? AND deleted_at IS NULL').bind(principal.id, body.clientId).first();
    requireThat(song, 409, 'This song was deleted. Make it again to save it.');
  }

  let classes = [];
  try { classes = (await identity(env, 'classes', { credential: principal.credential })).classes.map((c) => c.name); } catch { /* saved without the class */ }
  const now = Date.now(); const version = song.revision + 1;
  const mine = { ...clean, id: song.id, clientId: song.client_id, revision: version, status: 'ready', createdAt: song.created_at, updatedAt: now };
  const sentId = crypto.randomUUID();
  const sent = { ...clean, title: version > 1 ? `${clean.title.slice(0, 110)} (v${version})` : clean.title,
    id: sentId, clientId: `student-${(await hash(`${principal.id}:${song.id}`)).slice(0, 40)}-v${version}`, cloud: true, revision: 1, status: 'ready', createdAt: now, updatedAt: now };
  const madeBy = JSON.stringify({ name: principal.displayName || principal.email || 'A student', classes, version, at: now });
  const mineKey = `owners/${await hash(principal.id)}/songs/${song.id}/${version}-${crypto.randomUUID()}.json`;
  const sentKey = `owners/${await hash(owner.principal_id)}/songs/${sentId}/1-${crypto.randomUUID()}.json`;
  const put = (key, document) => env.SONGS.put(key, JSON.stringify(document), { httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' } });
  await Promise.all([put(mineKey, mine), put(sentKey, sent)]);
  try {
    const result = await env.DB.batch([
      env.DB.prepare("UPDATE songs SET revision = ?, title = ?, status = 'ready', updated_at = ? WHERE id = ? AND revision = ? AND deleted_at IS NULL").bind(version, mine.title, now, song.id, song.revision),
      env.DB.prepare('INSERT INTO song_versions (song_id,revision,manifest_key,created_at) SELECT id,revision,?,? FROM songs WHERE id = ? AND revision = ?').bind(mineKey, now, song.id, version),
      // The owner's copy exists only if the student's save above went through.
      env.DB.prepare("INSERT INTO songs (id, owner_id, client_id, revision, title, status, made_by, created_at, updated_at) SELECT ?, ?, ?, 1, ?, 'ready', ?, ?, ? WHERE EXISTS (SELECT 1 FROM songs WHERE id = ? AND revision = ?)")
        .bind(sentId, owner.principal_id, sent.clientId, sent.title, madeBy, now, now, song.id, version),
      env.DB.prepare('INSERT INTO song_versions (song_id,revision,manifest_key,created_at) SELECT id,1,?,? FROM songs WHERE id = ?').bind(sentKey, now, sentId),
    ]);
    requireThat(result[0].meta.changes === 1, 409, 'This song changed on another device. Reload before saving.');
  } catch (error) {
    await Promise.all([env.SONGS.delete(mineKey), env.SONGS.delete(sentKey)]);
    if (error.status) throw error;
    throw new HttpError(409, 'This song changed on another device. Reload before saving.');
  }
  return json({ song: listed(mine) });
}
