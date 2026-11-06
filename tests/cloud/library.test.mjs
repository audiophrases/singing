import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { STARTER_SONGS } from '../../js/data/songs/index.js';
import { addStarterSongs } from '../../js/cloud/starters.js';
import { timelineFromSynced } from '../../js/music/timeline.js';
import { cleanTimeline } from '../../js/lesson/pack.js';
import { pickGaps } from '../../js/lyrics/gaps.js';

let mf, db;
const revoked = new Set();
const upstream = new Map();
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'singing',
    modules: [
      ...['worker.js', 'http.js', 'auth.js', 'songs.js', 'student-songs.js', 'assignments.js', 'shares.js', 'song-access.js'].map((name) => `cloudflare/${name}`),
      ...['lesson/pack.js', 'lyrics/gaps.js', 'lyrics/text.js', 'lyrics/wordlists.js', 'lyrics/grammar.js', 'lyrics/rhymes.js', 'music/timeline.js', 'music/score.js', 'music/notes.js', 'ui.js'].map((name) => `js/${name}`),
    ].map((name) => ({ type: 'ESModule', path: fileURLToPath(new URL(`../../${name}`, import.meta.url)) })),
    compatibilityDate: '2026-10-21', d1Databases: ['DB', 'LEGACY'], r2Buckets: ['SONGS'],
    bindings: { OWNER_STORAGE_BYTES: '1048576', MAX_FILE_BYTES: '524288' },
    serviceBindings: { IDENTITY: async (request) => {
      const path = new URL(request.url).pathname; const body = await request.json();
      if (path === '/config') return Response.json({ googleClientId: 'test-client' });
      if (path === '/login') {
        if (!['alice', 'bob', 'carol', 'owner', 'student', 'outsider', 'quota', 'painter'].includes(body.password)) return Response.json({ error: 'Wrong password.' }, { status: 401 });
        const credential = crypto.randomUUID() + crypto.randomUUID();
        const principal = { id: body.password, role: ['student', 'outsider'].includes(body.password) ? 'student' : body.password === 'owner' ? 'owner' : 'teacher', displayName: body.password,
          classIds: [body.password === 'outsider' || body.password === 'bob' ? 'class_b' : 'class_a'] };
        upstream.set(credential, principal);
        return Response.json({ credential, principal });
      }
      const principal = upstream.get(body.credential);
      if (!principal || revoked.has(principal.id)) return Response.json({ error: 'Access revoked.' }, { status: 403 });
      if (path === '/classes') return Response.json({ classes: principal.classIds.map((id) => ({ id, name: id })) });
      if (path === '/roster') return Response.json({ students: [
        ...(principal.classIds.includes('class_a') ? [{ id: 'student', displayName: 'Student', className: 'class_a' }] : []),
        ...(principal.classIds.includes('class_b') ? [{ id: 'outsider', displayName: 'Outsider', className: 'class_b' }] : []),
      ] });
      return Response.json({ principal });
    } },
  }] }));
  db = await mf.getD1Database('DB');
  const sql = await readFile(new URL('../../cloudflare/migrations/0001_cloud_library.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  const assignments = await readFile(new URL('../../cloudflare/migrations/0002_assignments.sql', import.meta.url), 'utf8');
  for (const statement of assignments.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  for (const name of ['0003_public_songs.sql', '0004_student_songs.sql', '0005_expiring_shares.sql']) {
    const sql = await readFile(new URL(`../../cloudflare/migrations/${name}`, import.meta.url), 'utf8');
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
});
after(async () => mf?.dispose());

async function call(path, { session, method = 'GET', body, headers = {}, origin = 'https://singing.test' } = {}) {
  const response = await mf.dispatchFetch(`https://singing.test${path}`, { method, headers: {
    Origin: origin, ...(session ? { Cookie: session.cookie, 'X-Singing-CSRF': session.csrf } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers,
  }, body: body instanceof Uint8Array ? body : body === undefined ? undefined : JSON.stringify(body) });
  const data = method === 'HEAD' ? null : response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : await response.arrayBuffer();
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

test('teachers get starter songs to edit and delete; a deleted one never comes back, on any device', async () => {
  const carol = await login('carol');
  const api = async (path, { method = 'GET', body } = {}) => {
    const { status, data } = await call(path, { session: carol, method, body });
    if (status >= 400) throw Object.assign(new Error(data.error), { status });
    return data;
  };
  const browser = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  const added = await addStarterSongs({ api, principalId: 'carol', documents: [], storage: browser() });
  assert.deepEqual(added.map((s) => s.clientId), STARTER_SONGS.map((s) => s.id));
  for (const original of STARTER_SONGS) {
    const copy = added.find((s) => s.clientId === original.id);
    for (const key of ['lines', 'bpm', 'meter', 'key', 'intro', 'pickup', 'outro', 'phrases', 'round']) {
      assert.deepEqual(copy[key], original[key], `${original.id}.${key} survives the cloud`);
    }
  }
  const birthday = added.find((s) => s.clientId === 'happy-birthday');
  const edited = await call(`/api/songs/${birthday.id}/commit`, { session: carol, method: 'POST', body: {
    baseRevision: 1, rightsConfirmed: true, assets: {}, song: { ...birthday, title: 'Happy Birthday, Carol' } } });
  assert.equal(edited.data.song.title, 'Happy Birthday, Carol');
  assert.equal((await call(`/api/songs/${birthday.id}`, { session: carol, method: 'DELETE', body: {} })).status, 200);
  const listed = async () => (await call('/api/songs', { session: carol })).data.songs;
  const documents = await Promise.all((await listed()).map(async (s) => (await call(`/api/songs/${s.id}`, { session: carol })).data.song));
  assert.deepEqual(await addStarterSongs({ api, principalId: 'carol', documents, storage: browser() }), [], 'a second device adds nothing');
  assert.equal((await listed()).length, STARTER_SONGS.length - 1);
});

const publicList = async () => (await call('/api/public/songs')).data.songs;
const saveBand = (session, id, song, baseRevision) => call(`/api/songs/${id}/commit`, { session, method: 'POST', body: { baseRevision, rightsConfirmed: true, assets: {}, song } });
const setPublic = (session, id, value) => call(`/api/songs/${id}/visibility`, { session, method: 'POST', body: { public: value } });
const band = { title: 'Public band song', source: 'band', bpm: 100, lines: [{ t: 'la la la', n: 'C4 D E' }] };

test('the owner chooses which band songs are public; edits show there and deletes remove them', async () => {
  const owner = await login('owner'); const alice = await login('alice');
  assert.equal((await call('/api/public/songs')).data.started, false, 'starter songs play until the owner opens the library');
  await call('/api/songs', { session: alice });
  assert.equal((await call('/api/public/songs')).data.started, false, 'other teachers do not start it');
  await call('/api/songs', { session: owner });
  assert.equal((await call('/api/public/songs')).data.started, true);
  const { id } = await song(owner);
  assert.equal((await saveBand(owner, id, band, 0)).data.song.public, false, 'songs start private');
  assert.ok(!(await publicList()).some((s) => s.id === id));
  assert.equal((await setPublic(owner, id, true)).status, 200);
  const shown = (await publicList()).find((s) => s.id === id);
  assert.equal(shown.title, 'Public band song');
  for (const key of ['cloud', 'revision', 'status', 'folderImport']) assert.ok(!(key in shown), `${key} is not on the public page`);
  assert.equal((await call(`/api/songs/${id}`, { session: owner })).data.song.public, true);
  assert.equal((await saveBand(owner, id, { ...band, title: 'Edited band song' }, 1)).data.song.public, true, 'an edit keeps the song public');
  assert.equal((await publicList()).find((s) => s.id === id).title, 'Edited band song');

  const { id: teacherSong } = await song(alice);
  await saveBand(alice, teacherSong, band, 0);
  assert.equal((await setPublic(alice, teacherSong, true)).status, 403, 'only the owner publishes');
  const { id: recording } = await song(owner);
  await commit(owner, recording, { audio: await upload(owner, recording) });
  assert.equal((await setPublic(owner, recording, true)).status, 400, 'recordings stay private');

  assert.equal((await saveBand(owner, id, { ...band, source: 'none', synced: [{ text: 'la la la' }] }, 2)).data.song.public, false, 'no longer a band song: private');
  assert.ok(!(await publicList()).some((s) => s.id === id));
  const { id: deleted } = await song(owner);
  await saveBand(owner, deleted, band, 0); await setPublic(owner, deleted, true);
  assert.ok((await publicList()).some((s) => s.id === deleted));
  await call(`/api/songs/${deleted}`, { session: owner, method: 'DELETE', body: {} });
  assert.ok(!(await publicList()).some((s) => s.id === deleted), 'deleting removes it from the public page');
});

test("the owner's starter songs start public; other teachers' stay private", async () => {
  const owner = await login('owner');
  const api = async (path, { method = 'GET', body } = {}) => {
    const { status, data } = await call(path, { session: owner, method, body });
    if (status >= 400) throw Object.assign(new Error(data.error), { status });
    return data;
  };
  const browser = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  const added = await addStarterSongs({ api, principalId: 'owner', documents: [], makePublic: true, storage: browser() });
  assert.ok(added.every((s) => s.public));
  const starterIds = new Set(STARTER_SONGS.map((s) => s.id));
  const shown = (await publicList()).filter((s) => starterIds.has(s.clientId));
  assert.deepEqual(shown.map((s) => s.clientId).sort(), [...starterIds].sort(), "only the owner's copies, once each");
  assert.deepEqual(shown.find((s) => s.clientId === 'happy-birthday').pickup, STARTER_SONGS.find((s) => s.id === 'happy-birthday').pickup);
});

test('students save Song maker songs; the owner gets a credited private copy, and version 2 as a new song', async () => {
  const owner = await login('owner'); const student = await login('student'); const outsider = await login('outsider'); const alice = await login('alice');
  await call('/api/songs', { session: owner }); // the owner opens the library
  const made = { ...band, title: 'My Morning', composed: { text: 'la la la', mood: 'pop', seed: 3, key: 'C' }, knobs: { rate: 0.8, transpose: 2, style: 'reggae', guide: 'robo' } };
  const save = (session, body) => call('/api/my-songs', { session, method: 'POST', body });
  const mine = async (session) => (await call('/api/my-songs', { session })).data.songs;
  const library = async () => Promise.all((await call('/api/songs', { session: owner })).data.songs.map(async (s) => (await call(`/api/songs/${s.id}`, { session: owner })).data.song));

  assert.equal((await save(alice, { clientId: 'teacher-song', song: made })).status, 403, 'teachers save in their own library');
  const first = await save(student, { clientId: 'my-morning-abc', song: made });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.deepEqual(first.data.song.knobs, made.knobs, 'Band, Key, Speed and Melody are saved with the song');
  assert.deepEqual((await mine(student)).map((s) => s.title), ['My Morning']);
  assert.deepEqual(await mine(outsider), [], 'students see only their own songs');
  const v1 = (await library()).find((s) => s.title === 'My Morning');
  assert.deepEqual({ ...v1.madeBy, at: undefined }, { name: 'student', classes: ['class_a'], version: 1, at: undefined });
  assert.equal(v1.public, false, 'student songs arrive private');
  assert.deepEqual(v1.composed, made.composed);
  assert.deepEqual(v1.knobs, made.knobs);
  assert.ok(!(await call('/api/songs', { session: alice })).data.songs.some((s) => s.title.startsWith('My Morning')), 'only the owner gets student songs');

  await saveBand(owner, v1.id, { ...v1, title: 'My Morning (edited)' }, 1);
  await setPublic(owner, v1.id, true);
  assert.ok(!('madeBy' in (await publicList()).find((s) => s.id === v1.id)), "the student's name is not on the public page");
  const second = await save(student, { id: first.data.song.id, song: { ...made, lines: [{ t: 'la la la la', n: 'C4 D E F' }] } });
  assert.equal(second.data.song.revision, 2);
  assert.equal((await mine(student)).length, 1, 'the student still has one song');
  const after = await library();
  const v2 = after.find((s) => s.title === 'My Morning (v2)');
  assert.equal(v2.madeBy.version, 2);
  assert.equal(v2.public, false);
  const kept = after.find((s) => s.id === v1.id);
  assert.deepEqual([kept.title, kept.public, kept.madeBy.name], ['My Morning (edited)', true, 'student'], 'version 1 stays as the owner edited it');

  assert.equal((await save(student, { clientId: 'recording', song: { title: 'Rec', source: 'audio', synced: [] } })).status, 400, 'recordings cannot be saved here');
  assert.equal((await call(`/api/my-songs/${first.data.song.id}`, { session: outsider, method: 'DELETE', body: {} })).status, 404);
  assert.equal((await call(`/api/my-songs/${first.data.song.id}`, { session: student, method: 'DELETE', body: {} })).status, 200);
  assert.deepEqual(await mine(student), []);
  assert.equal((await library()).filter((s) => s.title.startsWith('My Morning')).length, 2, "deleting the student's copy keeps the owner's");
});

test('a lesson pack saves with the song, and its teacher section stays with the teacher', async () => {
  const owner = await login('owner'); const alice = await login('alice'); const student = await login('student');
  await call('/api/songs', { session: owner }); // the owner opens the library
  const lesson = { format: 'singing-lesson-pack', version: 1, teacher: { notes: 'Private plan', cautions: [{ line: 1, note: 'Check this line' }] }, quiz: [{ when: 'after', q: 'Who?', answer: 'Us', wrong: ['Them'] }] };
  const { id } = await song(owner);
  const saved = await saveBand(owner, id, { ...band, lesson }, 0);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.song.lesson, lesson);
  assert.deepEqual((await call(`/api/songs/${id}`, { session: owner })).data.song.lesson, lesson, 'the teacher gets the whole pack back');
  const again = await saveBand(owner, id, { ...band, title: 'Renamed', lesson: saved.data.song.lesson }, 1);
  assert.deepEqual(again.data.song.lesson, lesson, 'saving the song again keeps the pack');

  await call(`/api/songs/${id}/visibility`, { session: owner, method: 'POST', body: { public: true } });
  const listed = (await call('/api/public/songs')).data.songs.find((s) => s.id === id);
  assert.deepEqual(listed.lesson.quiz, lesson.quiz, 'the public player can play the pack');
  assert.equal('teacher' in listed.lesson, false, 'but never receives the teacher section');
  assert.equal(JSON.stringify(listed).includes('Private plan'), false);

  // Too big, or not a pack: refused, not stored.
  assert.equal((await saveBand(owner, id, { ...band, lesson: 'not a pack' }, 2)).status, 400);
  assert.equal((await saveBand(owner, id, { ...band, lesson: { notes: 'x'.repeat(401 * 1024) } }, 2)).status, 400);

  // A student's Song maker song cannot carry one: packs are the teacher's.
  const made = await call('/api/my-songs', { session: student, method: 'POST', body: { clientId: 'student-pack-test', song: { ...band, lesson } } });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  assert.equal('lesson' in made.data.song, false);
  const sentCopies = await Promise.all((await call('/api/songs', { session: owner })).data.songs.map(async (s) => (await call(`/api/songs/${s.id}`, { session: owner })).data.song));
  assert.equal(sentCopies.find((s) => s.title === made.data.song.title && s.id !== id)?.lesson, undefined);
  assert.ok(alice);
});

test('a clean version reaches students, and the server marks the same gaps their browser shows', async () => {
  const alice = await login('alice'); const student = await login('student'); const { id: songId } = await song(alice);
  const assets = { audio: await upload(alice, songId), karaoke: await upload(alice, songId, 'karaoke') };
  const lesson = { format: 'singing-lesson-pack', version: 1, teacher: { notes: 'Private plan' }, clean: [{ words: 'damn' }], cleanOn: true };
  // Every line ends on the masked word: the word the easy level would hide first.
  const synced = ['So damn', 'You are damn', 'Sing it damn', 'Hold on damn'].map((text, i) => ({ text, start: i * 3, end: i * 3 + 2 }));
  assert.equal((await call(`/api/songs/${songId}/commit`, { session: alice, method: 'POST', body: { baseRevision: 0, assets, song: { title: 'Clean song', source: 'audio', lesson, synced }, rightsConfirmed: true } })).status, 200);
  const created = await call('/api/assignments', { session: alice, method: 'POST', body: { title: 'Clean homework', classIds: ['class_a'], attemptsLimit: 2, units: [{ songId, activity: 'gapfill', settings: { level: 'easy', input: 'type' } }] } });
  const { units } = (await call(`/api/assignments/${created.data.id}`, { session: student })).data;
  const started = await call(`/api/units/${units[0].id}/start`, { session: student, method: 'POST', body: {} });
  const attempt = await call(`/api/attempts/${started.data.attemptId}`, { session: student });
  assert.deepEqual(attempt.data.song.lesson.clean, lesson.clean, 'students get the clean version');
  assert.equal(attempt.data.song.lesson.cleanOn, true, 'and the tick that turns it on');
  assert.equal('teacher' in attempt.data.song.lesson, false);
  // What the student's browser does: mask, then pick the gaps.
  const timeline = timelineFromSynced(attempt.data.song.synced, 0);
  cleanTimeline(timeline, attempt.data.song.lesson);
  const gaps = pickGaps(timeline, { mode: attempt.data.settings.level, seed: attempt.data.settings.seed });
  const words = timeline.lines.flatMap((line) => [...(gaps.get(line.index) || [])].sort((a, b) => a - b).map((wi) => line.words[wi].text));
  assert.ok(words.length >= 3);
  assert.ok(words.every((word) => !word.includes('*')), words.join());
  for (const [itemId, answer] of words.entries()) assert.equal((await call(`/api/attempts/${started.data.attemptId}/answers`, { session: student, method: 'POST', body: { itemId, answer } })).status, 200);
  const done = await call(`/api/attempts/${started.data.attemptId}/submit`, { session: student, method: 'POST', body: {} });
  assert.deepEqual([done.data.score, done.data.max], [words.length, words.length], 'every right answer counts: the server hid the same words');
});

test('an assigned gap set is what students play, and the server marks it', async () => {
  const alice = await login('alice'); const student = await login('student'); const { id: songId } = await song(alice);
  const assets = { audio: await upload(alice, songId), karaoke: await upload(alice, songId, 'karaoke') };
  const lesson = {
    format: 'singing-lesson-pack', version: 1, teacher: { notes: 'Private plan' },
    gapSets: [{ id: 'verbs', name: 'Verbs', level: 'B1', gaps: [{ line: 1, words: 'sing', options: ['sang', 'sung'] }, { line: 2, words: 'dance', options: ['danced'] }] }],
  };
  const lyrics = { title: 'Lesson song', source: 'audio', lesson, synced: [{ text: 'We sing all night', start: 0, end: 3 }, { text: 'We dance all day', start: 3, end: 6 }, { text: 'We sing all night', start: 6, end: 9 }] };
  assert.equal((await call(`/api/songs/${songId}/commit`, { session: alice, method: 'POST', body: { baseRevision: 0, assets, song: lyrics, rightsConfirmed: true } })).status, 200);
  const created = await call('/api/assignments', { session: alice, method: 'POST', body: { title: 'Gap set homework', classIds: ['class_a'], attemptsLimit: 2, units: [
    { songId, activity: 'gapfill', settings: { level: 'hard', input: 'bank', focus: 'pack:verbs' } },
    { songId, activity: 'choose', settings: { focus: 'pack:no-such-set' } },
    { songId, activity: 'hunt', settings: { focus: 'pack:verbs' } },
  ] } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const { units } = (await call(`/api/assignments/${created.data.id}`, { session: student })).data;
  const settings = Object.fromEntries(units.map((u) => [u.activity, JSON.parse(u.settings_json)]));
  assert.equal(settings.gapfill.focus, 'pack:verbs');
  assert.equal(settings.choose.focus, '', 'a set that does not exist is ignored');
  assert.equal(settings.hunt.focus, '', 'only gap activities take a gap set');

  const unit = units.find((u) => u.activity === 'gapfill');
  const started = await call(`/api/units/${unit.id}/start`, { session: student, method: 'POST', body: {} });
  const attempt = await call(`/api/attempts/${started.data.attemptId}`, { session: student });
  assert.equal(attempt.data.settings.focus, 'pack:verbs');
  assert.deepEqual(attempt.data.song.lesson.gapSets, lesson.gapSets, 'the student can play the set');
  assert.equal('teacher' in attempt.data.song.lesson, false);
  assert.equal(JSON.stringify(attempt.data).includes('Private plan'), false);

  // Three gaps: "sing" twice (the line repeats) and "dance". One word is wrong.
  const answer = (itemId, text) => call(`/api/attempts/${started.data.attemptId}/answers`, { session: student, method: 'POST', body: { itemId, answer: text } });
  assert.equal((await answer(0, 'sing')).status, 200);
  assert.equal((await answer(1, 'danced')).status, 200);
  assert.equal((await answer(2, 'sing')).status, 200);
  assert.equal((await answer(3, 'sing')).status, 400, 'no gap beyond the set');
  const done = await call(`/api/attempts/${started.data.attemptId}/submit`, { session: student, method: 'POST', body: { score: 999, max: 999 } });
  assert.deepEqual([done.data.score, done.data.max, done.data.kind], [2, 3, 'checked-answers'], 'the server marks it, whatever the browser says');
});

test('a song picture stays with the song, costs no revision, and a browser can keep it', async () => {
  const painter = await login('painter'); const bob = await login('bob'); const student = await login('student');
  const { id } = await song(painter);
  const jpeg = (fill) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(fill)]);
  const put = (session, bytes, headers = {}, songId = id) => call(`/api/songs/${songId}/artwork`, { session, method: 'PUT', body: bytes, headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.length), ...headers } });
  assert.equal((await put(painter, jpeg(1))).status, 404, 'a song is saved first');
  const assets = { audio: await upload(painter, id), karaoke: await upload(painter, id, 'karaoke') };
  await commit(painter, id, assets);

  assert.equal((await put(painter, new TextEncoder().encode('<svg onload="alert(1)"></svg>'))).status, 415, 'nothing that could run on this site');
  assert.equal((await put(painter, new Uint8Array(512 * 1024 + 1).fill(0xff))).status, 413);
  assert.equal((await put(bob, jpeg(1))).status, 404, 'another teacher cannot change it');
  assert.equal((await put(student, jpeg(1))).status, 403);
  assert.equal((await put(painter, jpeg(1), { 'X-Singing-CSRF': 'wrong' })).status, 403);
  assert.equal((await call(`/api/songs/${id}/artwork`, { method: 'PUT', body: jpeg(1), headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '68' } })).status, 401);
  assert.equal((await call(`/api/songs/${id}`, { session: painter })).data.song.artwork, undefined);

  const saved = await put(painter, jpeg(1));
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const url = saved.data.artwork;
  assert.match(url, /^\/api\/art\/[a-f0-9-]{36}$/);

  // A song open in the Studio keeps the revision it started from.
  const opened = (await call(`/api/songs/${id}`, { session: painter })).data.song;
  assert.equal(opened.artwork, url);
  assert.equal(opened.revision, 1, 'no new revision');
  const edited = await commit(painter, id, assets, 1);
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.song.artwork, url, 'a save keeps the picture on screen');

  const picture = await call(url, { session: painter });
  assert.equal(picture.status, 200);
  assert.deepEqual(new Uint8Array(picture.data), jpeg(1));
  assert.equal(picture.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(picture.headers.get('Cache-Control'), 'private, max-age=31536000, immutable');
  assert.equal(picture.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal((await call(url)).status, 401);

  // A class on an older revision sees it too.
  const made = await call('/api/assignments', { session: painter, method: 'POST', body: { title: 'Pictures', classIds: ['class_a'], attemptsLimit: 1, units: [{ songId: id, activity: 'karaoke' }] } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const pinned = await call(`/api/songs/${id}?revision=2`, { session: student });
  assert.equal(pinned.status, 200, JSON.stringify(pinned.data));
  assert.equal(pinned.data.song.artwork, url);

  assert.equal((await put(painter, jpeg(1))).data.artwork, url, 'the same picture is not stored twice');
  const row = () => db.prepare("SELECT id, object_key FROM assets WHERE song_id = ? AND role = 'artwork'").bind(id).all();
  const before = (await row()).results;
  assert.equal(before.length, 1);
  const replaced = (await put(painter, jpeg(2))).data.artwork;
  assert.notEqual(replaced, url, 'a new picture needs a new address, or browsers keep the old one');
  assert.equal((await call(url, { session: painter })).status, 404);
  assert.deepEqual(new Uint8Array((await call(replaced, { session: painter })).data), jpeg(2));
  assert.equal((await row()).results.length, 1);
  assert.equal(await (await mf.getR2Bucket('SONGS')).head(before[0].object_key), null, 'the old file does not use up storage');

  // With the allowance full, the old picture stays.
  const reserve = (size, c) => call(`/api/songs/${id}/assets`, { session: painter, method: 'POST', body: { role: 'audio', size, name: 'full.mp3', mime: 'audio/mpeg', checksum: c.repeat(64) } });
  assert.equal((await reserve(524288, 'a')).status, 200);
  const { used } = await db.prepare('SELECT SUM(size) AS used FROM assets WHERE owner_id = ?').bind('painter').first();
  assert.equal((await reserve(1048576 - used - 10, 'b')).status, 200);
  assert.equal((await put(painter, jpeg(3))).status, 413);
  assert.equal((await call(`/api/songs/${id}`, { session: painter })).data.song.artwork, replaced);
  assert.equal((await call(replaced, { session: painter })).status, 200);

  assert.equal((await call(`/api/songs/${id}`, { session: painter, method: 'DELETE', body: {} })).status, 200);
  assert.equal((await call(replaced, { session: painter })).status, 404, 'a deleted song takes its picture with it');
});

async function sharedRecording() {
  const teacher = await login('alice'); const student = await login('student'); const outsider = await login('outsider');
  const { id } = await song(teacher);
  const assets = {};
  for (const role of ['audio', 'karaoke', 'vocals', 'sourceFile']) assets[role] = await upload(teacher, id, role);
  assert.equal((await commit(teacher, id, assets)).status, 200);
  return { teacher, student, outsider, id, assets };
}
const createShare = (teacher, id, targets = { classIds: ['class_a'] }) => call('/api/share-links', { session: teacher, method: 'POST', body: { songId: id, ...targets } });
const openShare = (session, token) => call('/api/shared/open', { session, method: 'POST', body: { token } });

test('expiring shares bind recipients, hash tokens, pin revisions and save metadata-only bookmarks', async () => {
  const { teacher, student, outsider, id, assets } = await sharedRecording();
  assert.equal((await createShare(teacher, id, { classIds: ['class_b'] })).status, 403);
  assert.equal((await createShare(teacher, id, { studentIds: ['outsider'] })).status, 403);
  assert.equal((await createShare(student, id)).status, 403);
  const created = await createShare(teacher, id);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.expiresAt - created.data.serverNow, 604800000);
  const row = await db.prepare('SELECT * FROM share_links WHERE id = ?').bind(created.data.id).first();
  assert.notEqual(row.token_hash, created.data.token);
  assert.equal(row.token_hash, createHash('sha256').update(created.data.token).digest('hex'));
  assert.equal((await openShare(undefined, created.data.token)).status, 401);
  assert.equal((await openShare(outsider, created.data.token)).status, 403);
  const opened = await openShare(student, created.data.token);
  assert.equal(opened.status, 200, JSON.stringify(opened.data));
  assert.equal(opened.data.song.protected, true);
  assert.equal(opened.data.song.cloud, true);
  assert.equal(opened.data.song.revision, 1);
  assert.equal(opened.data.song.sourceFile, undefined);
  assert.equal(opened.data.song.access.expiresAt, created.data.expiresAt);
  assert.equal((await commit(teacher, id, assets, 1)).status, 200);
  assert.equal((await openShare(student, created.data.token)).data.song.revision, 1, 'a link retains its shared version after teacher edits');
  assert.equal((await call(`/api/songs/${id}?revision=2`, { session: student })).status, 404);
  assert.equal((await call(`/api/songs/${id}?revision=invalid`, { session: student })).status, 400);
  assert.equal((await call('/api/saved-songs', { session: student, method: 'POST', body: { songId: id } })).status, 200);
  const saved = (await call('/api/saved-songs', { session: student })).data.songs.find((s) => s.id === id);
  assert.equal(saved.locked, false);
  assert.equal(saved.access.expiresAt, created.data.expiresAt, 'saving does not restart access');
  for (const key of ['lines', 'synced', 'audio', 'karaoke', 'vocals', 'lesson']) assert.equal(key in saved, false);
  assert.equal((await call('/api/my-songs', { session: student, method: 'POST', body: { clientId: 'forbidden-shared-copy', song: opened.data.song } })).status, 403);
  const bob = await login('bob');
  assert.equal((await call(`/api/share-links?songId=${id}`, { session: bob })).status, 404);
  assert.equal((await call(`/api/share-links/${created.data.id}/revoke`, { session: bob, method: 'POST', body: {} })).status, 404);
});

test('expiry blocks saved songs, lyrics and every audio stem even with an existing playback pass', async () => {
  const { teacher, student, id } = await sharedRecording();
  const created = await createShare(teacher, id);
  const expiry = Date.now() + 30000;
  await db.prepare('UPDATE share_links SET expires_at = ? WHERE id = ?').bind(expiry, created.data.id).run();
  await call('/api/saved-songs', { session: student, method: 'POST', body: { songId: id } });
  const playback = await call(`/api/songs/${id}/playback`, { session: student, method: 'POST', body: {} });
  assert.equal(playback.status, 200, JSON.stringify(playback.data));
  assert.ok(playback.data.expiresAt <= expiry, 'a playback pass never outlasts its permission');
  assert.deepEqual(Object.keys(playback.data.urls).sort(), ['audio', 'karaoke', 'vocals']);
  for (const url of Object.values(playback.data.urls)) {
    assert.equal((await call(url, { session: student, headers: { Range: 'bytes=0-3' } })).status, 206);
  }
  await db.prepare('UPDATE share_links SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, created.data.id).run();
  assert.equal((await openShare(student, created.data.token)).status, 410);
  assert.equal((await call(`/api/songs/${id}`, { session: student })).status, 404);
  assert.equal((await call(`/api/songs/${id}/access`, { session: student })).status, 410);
  assert.equal((await call(`/api/songs/${id}/playback`, { session: student, method: 'POST', body: {} })).status, 404);
  for (const url of Object.values(playback.data.urls)) {
    assert.equal((await call(url, { session: student })).status, 403);
    assert.equal((await call(url, { session: student, method: 'HEAD' })).status, 403);
  }
  const saved = (await call('/api/saved-songs', { session: student })).data.songs.find((s) => s.id === id);
  assert.equal(saved.locked, true);
  assert.equal(saved.access, null);
  assert.equal((await call(`/api/songs/${id}`, { session: teacher })).status, 200, 'the teacher retains the original');
});

test('replacement links restore the same bookmark for selected students while old URLs remain expired', async () => {
  const { teacher, student, outsider, id } = await sharedRecording();
  const original = await createShare(teacher, id);
  await call('/api/saved-songs', { session: student, method: 'POST', body: { songId: id } });
  await db.prepare('UPDATE share_links SET expires_at = 0 WHERE id = ?').bind(original.data.id).run();
  const replacement = await createShare(teacher, id, { studentIds: ['student'] });
  assert.equal(replacement.status, 201, JSON.stringify(replacement.data));
  assert.notEqual(replacement.data.token, original.data.token);
  assert.equal((await openShare(student, original.data.token)).status, 410);
  assert.equal((await openShare(student, replacement.data.token)).status, 200);
  assert.equal((await openShare(outsider, replacement.data.token)).status, 403);
  const entries = (await call('/api/saved-songs', { session: student })).data.songs.filter((s) => s.id === id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].locked, false);
  assert.equal(entries[0].access.expiresAt, replacement.data.expiresAt);
  assert.equal((await call(`/api/share-links/${replacement.data.id}/revoke`, { session: teacher, method: 'POST', body: {} })).status, 200);
  assert.equal((await openShare(student, replacement.data.token)).status, 410);
  assert.equal((await call(`/api/songs/${id}`, { session: student })).status, 404);
  assert.equal((await call(`/api/saved-songs/${id}`, { session: student, method: 'DELETE', body: {} })).status, 200);
  assert.equal((await call('/api/saved-songs', { session: student })).data.songs.some((s) => s.id === id), false);
});

test('revocation and current class membership also control existing media URLs and artwork', async () => {
  const { teacher, student, id } = await sharedRecording();
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const art = await call(`/api/songs/${id}/artwork`, { session: teacher, method: 'PUT', body: jpeg, headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(jpeg.length) } });
  const created = await createShare(teacher, id);
  const playback = await call(`/api/songs/${id}/playback`, { session: student, method: 'POST', body: {} });
  assert.equal((await call(art.data.artwork, { session: student })).headers.get('Cache-Control'), 'private, no-store');
  const credential = student.cookie.slice(student.cookie.indexOf('=') + 1);
  const principal = upstream.get(credential); const previous = principal.classIds;
  try {
    principal.classIds = ['class_b'];
    assert.equal((await openShare(student, created.data.token)).status, 403);
    assert.equal((await call(playback.data.urls.audio, { session: student })).status, 403);
    assert.equal((await call(art.data.artwork, { session: student })).status, 403);
  } finally { principal.classIds = previous; }
  await call(`/api/share-links/${created.data.id}/revoke`, { session: teacher, method: 'POST', body: {} });
  assert.equal((await call(playback.data.urls.audio, { session: student })).status, 403);
  assert.equal((await call(art.data.artwork, { session: student })).status, 403);
});

test('assignment expiry and deadlines close lyrics, attempt contexts, saved access and media', async () => {
  const { teacher, student, id } = await sharedRecording();
  const created = await call('/api/assignments', { session: teacher, method: 'POST', body: { title: 'Seven days', classIds: ['class_a'], attemptsLimit: 1, units: [{ songId: id, activity: 'karaoke' }] } });
  const detail = await call(`/api/assignments/${created.data.id}`, { session: student });
  assert.equal(detail.data.assignment.expires_at - detail.data.assignment.created_at, 604800000);
  const started = await call(`/api/units/${detail.data.units[0].id}/start`, { session: student, method: 'POST', body: {} });
  const attempt = await call(`/api/attempts/${started.data.attemptId}`, { session: student });
  assert.equal(attempt.data.song.protected, true);
  const playback = await call(`/api/songs/${id}/playback`, { session: student, method: 'POST', body: {} });
  await call('/api/saved-songs', { session: student, method: 'POST', body: { songId: id } });
  for (const field of ['due_at', 'expires_at']) {
    await db.prepare(`UPDATE assignments SET ${field} = ? WHERE id = ?`).bind(Date.now() - 1, created.data.id).run();
    assert.equal((await call(`/api/songs/${id}`, { session: student })).status, 404);
    assert.equal((await call(`/api/attempts/${started.data.attemptId}`, { session: student })).status, 410);
    assert.equal((await call(`/api/attempts/${started.data.attemptId}/access`, { session: student })).status, 410);
    assert.equal((await call(playback.data.urls.audio, { session: student })).status, 403);
    await db.prepare('UPDATE assignments SET due_at = NULL WHERE id = ?').bind(created.data.id).run();
  }
  assert.equal((await call('/api/saved-songs', { session: student })).data.songs.find((s) => s.id === id).locked, true);
});

test('a protected song cannot be republished to bypass its expiry', async () => {
  const owner = await login('owner'); const { id } = await song(owner);
  const band = { ...structuredClone(STARTER_SONGS[0]), title: 'Protected band song', source: 'band' };
  assert.equal((await call(`/api/songs/${id}/commit`, { session: owner, method: 'POST', body: { song: band, assets: {}, baseRevision: 0, rightsConfirmed: true } })).status, 200);
  assert.equal((await call(`/api/songs/${id}/visibility`, { session: owner, method: 'POST', body: { public: true } })).status, 200);
  assert.equal((await createShare(owner, id)).status, 409);
  await call(`/api/songs/${id}/visibility`, { session: owner, method: 'POST', body: { public: false } });
  assert.equal((await createShare(owner, id)).status, 201);
  assert.equal((await call(`/api/songs/${id}/visibility`, { session: owner, method: 'POST', body: { public: true } })).status, 409);
  assert.equal((await call('/api/public/songs')).data.songs.some((s) => s.id === id), false);
});

test('upgrading an existing database expires old assignments and preserves songs and results', async () => {
  const legacy = await mf.getD1Database('LEGACY');
  const apply = async (name) => {
    const sql = await readFile(new URL(`../../cloudflare/migrations/${name}`, import.meta.url), 'utf8');
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await legacy.prepare(statement).run();
  };
  for (const name of ['0001_cloud_library.sql', '0002_assignments.sql', '0003_public_songs.sql', '0004_student_songs.sql']) await apply(name);
  const created = Date.now() - 604800000 - 1000;
  await legacy.batch([
    legacy.prepare("INSERT INTO songs (id,owner_id,client_id,revision,title,is_public,created_at,updated_at) VALUES ('legacy','owner','legacy',1,'Keep this song',1,?,?)").bind(created, created),
    legacy.prepare("INSERT INTO song_versions (song_id,revision,manifest_key,created_at) VALUES ('legacy',1,'keep-this-object',?)").bind(created),
    legacy.prepare("INSERT INTO assignments (id,owner_id,title,attempts_limit,created_at) VALUES ('legacy-assignment','owner','Older assignment',1,?)").bind(created),
    legacy.prepare("INSERT INTO assignment_units (id,assignment_id,song_id,revision,activity,settings_json) VALUES ('legacy-unit','legacy-assignment','legacy',1,'karaoke','{}')"),
    legacy.prepare("INSERT INTO attempts (id,unit_id,student_id,student_name,ordinal,seed,started_at,score,max_score) VALUES ('legacy-result','legacy-unit','student','Student',1,1,?,5,5)").bind(created),
  ]);
  await apply('0005_expiring_shares.sql');
  const assignment = await legacy.prepare("SELECT * FROM assignments WHERE id = 'legacy-assignment'").first();
  assert.equal(assignment.expires_at, created + 604800000);
  assert.ok(assignment.expires_at < Date.now());
  assert.equal(assignment.active, 1, 'expiry does not delete assignment history');
  const saved = await legacy.prepare("SELECT * FROM songs WHERE id = 'legacy'").first();
  assert.equal(saved.title, 'Keep this song'); assert.equal(saved.revision, 1);
  assert.equal(saved.is_public, 0); assert.equal(saved.access_controlled, 1); assert.equal(saved.deleted_at, null);
  assert.equal((await legacy.prepare("SELECT manifest_key FROM song_versions WHERE song_id = 'legacy'").first()).manifest_key, 'keep-this-object');
  assert.equal((await legacy.prepare("SELECT score FROM attempts WHERE id = 'legacy-result'").first()).score, 5);
});
