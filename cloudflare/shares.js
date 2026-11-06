import { bodyJson, hash, token, safeId, requireThat, json } from './http.js';
import { teacher, identity } from './auth.js';
import { ownedSong, manifest, visibleSong } from './songs.js';
import { SHARE_TTL, accessInfo, audience, studentAccess, savedStudentAccess } from './song-access.js';

async function targets(env, principal) {
  const [classes, roster] = await Promise.all([
    identity(env, 'classes', { credential: principal.credential }),
    identity(env, 'roster', { credential: principal.credential }),
  ]);
  return { classes: classes.classes || [], students: (roster.students || []).map(({ id, displayName, className }) => ({ id, displayName, className })) };
}

export async function shareRoutes(request, env, path, principal) {
  if (path === '/api/share-targets' && request.method === 'GET') {
    teacher(principal);
    return json(await targets(env, principal));
  }
  if (path === '/api/share-links') {
    teacher(principal);
    if (request.method === 'GET') {
      const songId = new URL(request.url).searchParams.get('songId');
      await ownedSong(env, songId, principal);
      const { results } = await env.DB.prepare('SELECT id, created_at, expires_at, revoked_at FROM share_links WHERE owner_id = ? AND song_id = ? ORDER BY created_at DESC LIMIT 100').bind(principal.id, songId).all();
      const selected = await env.DB.prepare(`SELECT share_id, kind, target_id FROM share_targets WHERE share_id IN
        (SELECT id FROM share_links WHERE owner_id = ? AND song_id = ? ORDER BY created_at DESC LIMIT 100)`).bind(principal.id, songId).all();
      const links = results.map((link) => ({ ...link, targets: selected.results.filter((target) => target.share_id === link.id) }));
      return json({ links, serverNow: Date.now() });
    }
    if (request.method === 'POST') {
      const body = await bodyJson(request, 16384);
      const song = await ownedSong(env, body.songId, principal);
      requireThat(song.revision > 0, 400, 'Save this song before sharing it.');
      requireThat(!song.is_public, 409, 'Make this song private before creating an expiring link.');
      const classIds = body.classIds ?? []; const studentIds = body.studentIds ?? [];
      requireThat(Array.isArray(classIds) && Array.isArray(studentIds) && classIds.length + studentIds.length > 0 && classIds.length + studentIds.length <= 30
        && classIds.every(safeId) && studentIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 320), 400, 'Choose up to 30 students or classes. Use a class to share with a larger group.');
      const allowed = await targets(env, principal);
      requireThat(classIds.every((id) => allowed.classes.some((c) => c.id === id))
        && studentIds.every((id) => allowed.students.some((s) => s.id === id)), 403, 'You can only share with your own students and classes.');
      const id = crypto.randomUUID(); const secret = token(); const now = Date.now(); const expiresAt = now + SHARE_TTL;
      const selected = [...new Set(classIds)].map((targetId) => ['class', targetId]).concat([...new Set(studentIds)].map((targetId) => ['student', targetId]));
      await env.DB.batch([
        env.DB.prepare('UPDATE songs SET access_controlled = 1, is_public = 0 WHERE id = ?').bind(song.id),
        env.DB.prepare('INSERT INTO share_links (id,owner_id,song_id,revision,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
          .bind(id, principal.id, song.id, song.revision, await hash(secret), now, expiresAt),
        ...selected.map(([kind, targetId]) => env.DB.prepare('INSERT INTO share_targets (share_id,kind,target_id) VALUES (?,?,?)').bind(id, kind, targetId)),
      ]);
      return json({ id, token: secret, expiresAt, serverNow: now }, 201);
    }
  }
  const revoke = /^\/api\/share-links\/([a-zA-Z0-9_-]+)\/revoke$/.exec(path);
  if (revoke && request.method === 'POST') {
    teacher(principal);
    const result = await env.DB.prepare('UPDATE share_links SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND owner_id = ?').bind(Date.now(), revoke[1], principal.id).run();
    requireThat(result.meta.changes > 0, 404, 'Share link not found.');
    return json({ ok: true });
  }
  if (['/api/shared/open', '/api/shared/access'].includes(path) && request.method === 'POST') {
    const body = await bodyJson(request, 1024);
    requireThat(typeof body.token === 'string' && /^[a-f0-9]{64}$/.test(body.token), 404, 'Share link not found.');
    const link = await env.DB.prepare(`SELECT l.* FROM share_links l JOIN songs s ON s.id = l.song_id
      WHERE l.token_hash = ? AND s.deleted_at IS NULL`).bind(await hash(body.token)).first();
    requireThat(link, 404, 'Share link not found.');
    requireThat(!link.revoked_at && link.expires_at > Date.now(), 410, 'This link has expired or been withdrawn. Ask your teacher for a new link.');
    if (principal.role === 'student') {
      const target = audience(principal);
      requireThat(await env.DB.prepare(`SELECT 1 FROM share_targets t WHERE t.share_id = ? AND ${target.sql}`).bind(link.id, ...target.values).first(), 403, 'This link is for another student or class.');
    } else requireThat(link.owner_id === principal.id, 403, 'This link belongs to another teacher.');
    if (path === '/api/shared/access') return json({ access: principal.role === 'student' ? accessInfo(link.expires_at) : null });
    const document = visibleSong(await manifest(env, link.song_id, link.revision), principal);
    return json({ song: principal.role === 'student' ? { ...document, protected: true, access: accessInfo(link.expires_at) } : document });
  }
  if (path === '/api/saved-songs' && request.method === 'GET') {
    requireThat(principal.role === 'student', 403, 'Student sign-in required.');
    const { results } = await env.DB.prepare(`SELECT s.id, s.title FROM saved_songs b JOIN songs s ON s.id = b.song_id
      WHERE b.student_id = ? ORDER BY b.created_at DESC LIMIT 200`).bind(principal.id).all();
    const permissions = await savedStudentAccess(env, principal);
    const songs = results.map((song) => {
      const access = permissions.get(song.id) ?? null;
      return { ...song, cloud: true, protected: true, savedSong: true, mine: false, bookmark: true,
        locked: !access, revision: access?.revision, access, emoji: access ? '🎵' : '🔒' };
    });
    return json({ songs });
  }
  if (path === '/api/saved-songs' && request.method === 'POST') {
    requireThat(principal.role === 'student', 403, 'Student sign-in required.');
    const { songId, revision } = await bodyJson(request, 2048);
    requireThat(safeId(songId), 400, 'Invalid song.');
    requireThat(revision == null || Number.isSafeInteger(revision) && revision > 0, 400, 'Invalid song version.');
    requireThat(await studentAccess(env, songId, revision ?? null, principal), 410, 'Access expired. Ask your teacher for a new link.');
    const existing = await env.DB.prepare('SELECT 1 FROM saved_songs WHERE student_id = ? AND song_id = ?').bind(principal.id, songId).first();
    const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM saved_songs WHERE student_id = ?').bind(principal.id).first();
    requireThat(existing || count < 200, 413, 'Remove a saved song before adding another.');
    await env.DB.prepare('INSERT OR IGNORE INTO saved_songs (student_id,song_id,created_at) VALUES (?,?,?)').bind(principal.id, songId, Date.now()).run();
    return json({ ok: true });
  }
  const remove = /^\/api\/saved-songs\/([a-zA-Z0-9_-]+)$/.exec(path);
  if (remove && request.method === 'DELETE') {
    requireThat(principal.role === 'student', 403, 'Student sign-in required.');
    await env.DB.prepare('DELETE FROM saved_songs WHERE student_id = ? AND song_id = ?').bind(principal.id, remove[1]).run();
    return json({ ok: true });
  }
  return null;
}
