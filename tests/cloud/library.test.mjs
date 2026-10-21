import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

let mf, db;
const revoked = new Set();
const upstream = new Map();
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'singing',
    modules: [
      ...['worker.js', 'http.js', 'auth.js', 'songs.js', 'assignments.js'].map((name) => `cloudflare/${name}`),
      ...['lyrics/gaps.js', 'lyrics/text.js', 'lyrics/wordlists.js', 'lyrics/grammar.js', 'lyrics/rhymes.js', 'music/timeline.js', 'music/score.js', 'music/notes.js', 'ui.js'].map((name) => `js/${name}`),
    ].map((name) => ({ type: 'ESModule', path: fileURLToPath(new URL(`../../${name}`, import.meta.url)) })),
    compatibilityDate: '2026-10-21', d1Databases: ['DB'], r2Buckets: ['SONGS'],
    bindings: { OWNER_STORAGE_BYTES: '1048576', MAX_FILE_BYTES: '524288' },
    serviceBindings: { IDENTITY: async (request) => {
      const path = new URL(request.url).pathname; const body = await request.json();
      if (path === '/config') return Response.json({ googleClientId: 'test-client' });
      if (path === '/login') {
        if (!['alice', 'bob', 'student', 'outsider', 'quota'].includes(body.password)) return Response.json({ error: 'Wrong password.' }, { status: 401 });
        const credential = crypto.randomUUID() + crypto.randomUUID();
        const principal = { id: body.password, role: ['student', 'outsider'].includes(body.password) ? 'student' : 'teacher', displayName: body.password,
          classIds: [body.password === 'outsider' || body.password === 'bob' ? 'class_b' : 'class_a'] };
        upstream.set(credential, principal);
        return Response.json({ credential, principal });
      }
      const principal = upstream.get(body.credential);
      if (!principal || revoked.has(principal.id)) return Response.json({ error: 'Access revoked.' }, { status: 403 });
      if (path === '/classes') return Response.json({ classes: principal.classIds.map((id) => ({ id, name: id })) });
      return Response.json({ principal });
    } },
  }] }));
  db = await mf.getD1Database('DB');
  const sql = await readFile(new URL('../../cloudflare/migrations/0001_cloud_library.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  const assignments = await readFile(new URL('../../cloudflare/migrations/0002_assignments.sql', import.meta.url), 'utf8');
  for (const statement of assignments.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run();
});
after(async () => mf?.dispose());

async function call(path, { session, method = 'GET', body, headers = {}, origin = 'https://singing.test' } = {}) {
  const response = await mf.dispatchFetch(`https://singing.test${path}`, { method, headers: {
    Origin: origin, ...(session ? { Cookie: session.cookie, 'X-Singing-CSRF': session.csrf } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers,
  }, body: body instanceof Uint8Array ? body : body === undefined ? undefined : JSON.stringify(body) });
  const data = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : await response.arrayBuffer();
  return { status: response.status, data, headers: response.headers };
}
async function login(name) {
  const result = await call('/api/auth/login', { method: 'POST', body: { password: name } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.match(result.headers.get('Set-Cookie'), /Secure; HttpOnly; SameSite=Lax/);
  return { cookie: result.headers.get('Set-Cookie').split(';')[0], csrf: result.data.csrf };
}
async function song(session, clientId = crypto.randomUUID()) {
  const result = await call('/api/songs', { session, method: 'POST', body: { clientId } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}
async function upload(session, id, role = 'audio', bytes = new TextEncoder().encode('ID3-audio-test')) {
  const reserved = await call(`/api/songs/${id}/assets`, { session, method: 'POST', body: {
    role, name: 'Song.mp3', mime: 'audio/mpeg', size: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex'),
  } });
  assert.equal(reserved.status, 200, JSON.stringify(reserved.data));
  const put = await call(reserved.data.uploadUrl, { session, method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) } });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  return reserved.data.assetId;
}
async function commit(session, id, assets, baseRevision = 0) {
  return call(`/api/songs/${id}/commit`, { session, method: 'POST', body: {
    baseRevision, assets, rightsConfirmed: true,
    song: { title: 'Private song', source: 'audio', synced: [{ text: 'Hello world', start: 0, end: 3 }] },
  } });
}

test('login rejects cross-origin requests; students cannot create teacher songs; CSRF is enforced', async () => {
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { password: 'alice' }, origin: 'https://evil.test' })).status, 403);
  const student = await login('student');
  assert.equal((await call('/api/songs', { session: student, method: 'POST', body: { clientId: 'student-song' } })).status, 403);
  const alice = await login('alice');
  assert.equal((await call('/api/songs', { session: alice, method: 'POST', body: { clientId: 'csrf-test' }, headers: { 'X-Singing-CSRF': 'wrong' } })).status, 403);
  assert.equal((await call('/api/songs')).status, 401);
});

test('song bundles persist across sessions and keep lyrics and all stems private', async () => {
  const alice = await login('alice'); const { id } = await song(alice);
  const assets = { audio: await upload(alice, id), karaoke: await upload(alice, id, 'karaoke'), vocals: await upload(alice, id, 'vocals') };
  const saved = await commit(alice, id, assets);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.song.status, 'ready');
  const otherDevice = await login('alice');
  assert.equal((await call(`/api/songs/${id}`, { session: otherDevice })).data.song.synced[0].text, 'Hello world');
  const bob = await login('bob');
  assert.equal((await call(`/api/songs/${id}`, { session: bob })).status, 404);
  assert.equal((await call(`/api/songs/${id}`)).status, 401);
  const playback = await call(`/api/songs/${id}/playback`, { session: alice, method: 'POST', body: {} });
  const url = playback.data.urls.audio;
  const media = await call(url, { session: alice, headers: { Range: 'bytes=1-4' } });
  assert.equal(media.status, 206, JSON.stringify(media.data));
  assert.equal(new TextDecoder().decode(media.data), 'D3-a');
  assert.equal(media.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await call(url, { session: bob })).status, 403);
  assert.equal((await call(url, { session: otherDevice })).status, 403, 'grants are bound to one session');
  assert.equal((await call(url)).status, 401);
  assert.equal((await call(url, { session: alice, headers: { Range: 'bytes=99999-' } })).status, 416);
  assert.equal((await call(`/api/songs/${id}`, { session: alice, method: 'DELETE', body: {} })).status, 200);
  assert.equal((await call(url, { session: alice })).status, 403, 'deletion revokes playback immediately');
});

test('incomplete and foreign uploads cannot become committed song versions', async () => {
  const alice = await login('alice'); const bob = await login('bob');
  const { id } = await song(alice); const other = await song(bob);
  assert.equal((await commit(alice, id, {})).status, 400);
  const foreign = await upload(bob, other.id);
  assert.equal((await commit(alice, id, { audio: foreign })).status, 400);
  const asset = await upload(alice, id);
  assert.equal((await commit(alice, id, { audio: asset })).data.song.status, 'draft');
  assert.equal((await commit(alice, id, { audio: asset }, 0)).status, 409, 'stale browser edits cannot overwrite a saved revision');
});

test('retry identity is stable, reservations enforce quotas, and checksum mismatch is refused', async () => {
  const alice = await login('alice');
  const a = await song(alice, 'migration-identity'); const b = await song(alice, 'migration-identity');
  assert.equal(a.id, b.id);
  const reserve = await call(`/api/songs/${a.id}/assets`, { session: alice, method: 'POST', body: { role: 'audio', name: 'bad.mp3', size: 4, mime: 'audio/mpeg', checksum: 'a'.repeat(64) } });
  const bad = await call(reserve.data.uploadUrl, { session: alice, method: 'PUT', body: new Uint8Array([1, 2, 3, 4]), headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '4' } });
  assert.equal(bad.status, 400);
  const oversized = await call(`/api/songs/${a.id}/assets`, { session: alice, method: 'POST', body: { role: 'audio', name: 'big.mp3', size: 1048577, mime: 'audio/mpeg', checksum: 'b'.repeat(64) } });
  assert.equal(oversized.status, 400);
});

test('expired grants, logout and shared-directory revocation prevent further playback', async () => {
  const alice = await login('alice'); const { id } = await song(alice);
  await commit(alice, id, { audio: await upload(alice, id) });
  const playback = await call(`/api/songs/${id}/playback`, { session: alice, method: 'POST', body: {} });
  await db.prepare('UPDATE playback_grants SET expires_at = 0').run();
  assert.equal((await call(playback.data.urls.audio, { session: alice })).status, 403);
  revoked.add('alice');
  assert.equal((await call(`/api/songs/${id}`, { session: alice })).status, 403);
  revoked.delete('alice');
  assert.equal((await call('/api/auth/logout', { session: alice, method: 'POST', body: {} })).status, 200);
  assert.equal((await call('/api/auth/session', { session: alice })).status, 401);
});

test('native assignments enforce class access, server grading, attempt limits and separate results', async () => {
  const alice = await login('alice'); const student = await login('student'); const outsider = await login('outsider'); const bob = await login('bob');
  const { id: songId } = await song(alice);
  await commit(alice, songId, { audio: await upload(alice, songId), karaoke: await upload(alice, songId, 'karaoke') });
  const created = await call('/api/assignments', { session: alice, method: 'POST', body: {
    title: 'Native listening', classIds: ['class_a'], attemptsLimit: 1,
    units: [{ songId, activity: 'choose', settings: { level: 'all' } }, { songId, activity: 'karaoke' }],
  } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.id;
  const detail = await call(`/api/assignments/${id}`, { session: student });
  assert.equal(detail.status, 200);
  assert.equal((await call(`/api/assignments/${id}`, { session: outsider })).status, 404);
  assert.equal((await call(`/api/assignments/${id}/results`, { session: bob })).status, 404);
  assert.equal((await call(`/api/assignments/${id}/results`, { session: student })).status, 403);
  const unit = detail.data.units.find((u) => u.activity === 'choose');
  const starts = await Promise.all([1, 2].map(() => call(`/api/units/${unit.id}/start`, { session: student, method: 'POST', body: { studentId: 'impostor' } })));
  assert.ok(starts.every((r) => r.status === 200), JSON.stringify(starts));
  assert.equal(starts[0].data.attemptId, starts[1].data.attemptId, 'parallel starts resume the same attempt');
  const attemptId = starts[0].data.attemptId;
  const attempt = await call(`/api/attempts/${attemptId}`, { session: student });
  assert.equal(attempt.data.attempt.student_id, 'student');
  assert.equal(attempt.data.settings.level, 'all');
  assert.equal((await call(`/api/attempts/${attemptId}`, { session: outsider })).status, 404);
  await call(`/api/attempts/${attemptId}/answers`, { session: student, method: 'POST', body: { itemId: 0, answer: 'Hello' } });
  await call(`/api/attempts/${attemptId}/answers`, { session: student, method: 'POST', body: { itemId: 1, answer: 'wrong' } });
  const submitted = await call(`/api/attempts/${attemptId}/submit`, { session: student, method: 'POST', body: { score: 9999, max: 9999 } });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  assert.equal(submitted.data.score, 1, 'client supplied score is ignored for word activities');
  assert.equal(submitted.data.max, 2);
  assert.equal(submitted.data.kind, 'checked-answers');
  assert.deepEqual((await call(`/api/attempts/${attemptId}/submit`, { session: student, method: 'POST', body: { score: 0 } })).data, submitted.data);
  assert.equal((await call(`/api/attempts/${attemptId}/answers`, { session: student, method: 'POST', body: { itemId: 1, answer: 'world' } })).status, 409);
  assert.equal((await call(`/api/units/${unit.id}/start`, { session: student, method: 'POST', body: {} })).status, 409);
  const results = await call(`/api/assignments/${id}/results`, { session: alice });
  assert.equal(results.data.attempts[0].score, 1);
  const playback = await call(`/api/songs/${songId}/playback`, { session: student, method: 'POST', body: { revision: 1 } });
  assert.equal(playback.status, 200, JSON.stringify(playback.data));
  assert.equal((await call(playback.data.urls.audio, { session: student })).status, 200);
  assert.equal((await call(`/api/songs/${songId}`, { session: outsider })).status, 404);
  await call(`/api/assignments/${id}/close`, { session: alice, method: 'POST', body: {} });
  assert.equal((await call(playback.data.urls.audio, { session: student })).status, 403, 'closing the assignment invalidates existing media access');
});

test('deadlines are checked at start and submission and completion-only activities stay ungraded', async () => {
  const alice = await login('alice'); const student = await login('student'); const { id: songId } = await song(alice);
  await commit(alice, songId, { audio: await upload(alice, songId), karaoke: await upload(alice, songId, 'karaoke') });
  const made = await call('/api/assignments', { session: alice, method: 'POST', body: { title: 'Singing practice', classIds: ['class_a'], attemptsLimit: 2, dueAt: Date.now() + 600000, units: [{ songId, activity: 'karaoke' }] } });
  const id = made.data.id; const unit = (await call(`/api/assignments/${id}`, { session: student })).data.units[0];
  const started = await call(`/api/units/${unit.id}/start`, { session: student, method: 'POST', body: {} });
  const result = await call(`/api/attempts/${started.data.attemptId}/submit`, { session: student, method: 'POST', body: { title: 'Sung', stars: 3 } });
  assert.equal(result.data.kind, 'completion'); assert.equal(result.data.score, null);
  const second = await call(`/api/units/${unit.id}/start`, { session: student, method: 'POST', body: {} });
  await db.prepare('UPDATE assignments SET due_at = ? WHERE id = ?').bind(Date.now() - 1000, id).run();
  assert.equal((await call(`/api/units/${unit.id}/start`, { session: student, method: 'POST', body: {} })).status, 410);
  assert.equal((await call(`/api/attempts/${second.data.attemptId}/submit`, { session: student, method: 'POST', body: {} })).status, 410);
});

test('assignments pin revisions, hide teacher-only metadata and revoke media when a student changes class', async () => {
  const alice = await login('alice'); const student = await login('student'); const { id: songId } = await song(alice);
  const assets = { audio: await upload(alice, songId), karaoke: await upload(alice, songId, 'karaoke'), sourceFile: await upload(alice, songId, 'sourceFile') };
  const original = { title: 'Pinned recording', source: 'audio', synced: [{ text: 'Original lyrics', start: 0, end: 3 }], about: 'Teacher notes', folderImport: { key: 'private/path' } };
  const save = (baseRevision, song) => call(`/api/songs/${songId}/commit`, { session: alice, method: 'POST', body: { baseRevision, assets, song, rightsConfirmed: true } });
  assert.equal((await save(0, original)).status, 200);
  const created = await call('/api/assignments', { session: alice, method: 'POST', body: { title: 'Pinned practice', classIds: ['class_a'], attemptsLimit: 1, units: [{ songId, activity: 'karaoke' }] } });
  const unit = (await call(`/api/assignments/${created.data.id}`, { session: student })).data.units[0];
  assert.equal((await save(1, { ...original, synced: [{ text: 'Later lyrics', start: 0, end: 3 }] })).status, 200);
  const started = await call(`/api/units/${unit.id}/start`, { session: student, method: 'POST', body: {} });
  const context = await call(`/api/attempts/${started.data.attemptId}`, { session: student });
  assert.equal(context.data.song.revision, 1);
  assert.equal(context.data.song.synced[0].text, 'Original lyrics');
  for (const key of ['folderImport', 'sourceFile', 'about', 'clientId']) assert.equal(key in context.data.song, false);
  assert.equal(context.data.song.mine, false);
  assert.equal((await call(`/api/songs/${songId}?revision=2`, { session: student })).status, 404);
  const playback = await call(`/api/songs/${songId}/playback`, { session: student, method: 'POST', body: { revision: 1 } });
  assert.equal(playback.status, 200);
  assert.equal('sourceFile' in playback.data.urls, false);
  assert.equal((await call(playback.data.urls.audio.replace('/audio?', '/sourceFile?'), { session: student })).status, 403);
  assert.equal((await call(playback.data.urls.audio, { session: student })).status, 200);
  const credential = student.cookie.slice(student.cookie.indexOf('=') + 1);
  const principal = upstream.get(credential);
  const oldClasses = principal.classIds;
  try {
    principal.classIds = ['class_b'];
    assert.equal((await call(playback.data.urls.audio, { session: student })).status, 403);
    assert.equal((await call(`/api/attempts/${started.data.attemptId}`, { session: student })).status, 404);
  } finally { principal.classIds = oldClasses; }
});

test('logout works when the shared service has revoked the account', async () => {
  const session = await login('alice');
  revoked.add('alice');
  try {
    assert.equal((await call('/api/auth/logout', { session, method: 'POST', body: {} })).status, 200);
    assert.equal((await call('/api/auth/session', { session })).status, 401);
  } finally { revoked.delete('alice'); }
});

test('quota reservations are atomic across concurrent uploads', async () => {
  const session = await login('quota'); const { id } = await song(session);
  const reserve = (c) => call(`/api/songs/${id}/assets`, { session, method: 'POST', body: { role: 'audio', size: 524288, name: 'quota.mp3', mime: 'audio/mpeg', checksum: c.repeat(64) } });
  const results = await Promise.all(['a', 'b', 'c'].map(reserve));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 413]);
});
