import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { STARTER_SONGS } from '../../js/data/songs/index.js';
import { addStarterSongs } from '../../js/cloud/starters.js';

let mf, db;
const revoked = new Set();
const upstream = new Map();
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'singing',
    modules: [
      ...['worker.js', 'http.js', 'auth.js', 'songs.js', 'student-songs.js', 'assignments.js'].map((name) => `cloudflare/${name}`),
      ...['lesson/pack.js', 'lyrics/gaps.js', 'lyrics/text.js', 'lyrics/wordlists.js', 'lyrics/grammar.js', 'lyrics/rhymes.js', 'music/timeline.js', 'music/score.js', 'music/notes.js', 'ui.js'].map((name) => `js/${name}`),
    ].map((name) => ({ type: 'ESModule', path: fileURLToPath(new URL(`../../${name}`, import.meta.url)) })),
    compatibilityDate: '2026-10-21', d1Databases: ['DB'], r2Buckets: ['SONGS'],
    bindings: { OWNER_STORAGE_BYTES: '1048576', MAX_FILE_BYTES: '524288' },
    serviceBindings: { IDENTITY: async (request) => {
      const path = new URL(request.url).pathname; const body = await request.json();
      if (path === '/config') return Response.json({ googleClientId: 'test-client' });
      if (path === '/login') {
        if (!['alice', 'bob', 'carol', 'owner', 'student', 'outsider', 'quota'].includes(body.password)) return Response.json({ error: 'Wrong password.' }, { status: 401 });
        const credential = crypto.randomUUID() + crypto.randomUUID();
        const principal = { id: body.password, role: ['student', 'outsider'].includes(body.password) ? 'student' : body.password === 'owner' ? 'owner' : 'teacher', displayName: body.password,
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
  for (const name of ['0003_public_songs.sql', '0004_student_songs.sql']) {
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

test('an assigned gap set is what students play, and the server marks it', async () => {
  const alice = await login('alice'); const student = await login('student'); const { id: songId } = await song(alice);
  const assets = { audio: await upload(alice, songId), karaoke: await upload(alice, songId, 'karaoke') };
  const lesson = {
    format: 'singing-lesson-pack', version: 1, teacher: { notes: 'Private plan' },
    gapSets: [{ id: 'verbs', name: 'Verbs', tier: 'core', gaps: [{ line: 1, words: 'sing', options: ['sang', 'sung'] }, { line: 2, words: 'dance', options: ['danced'] }] }],
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
