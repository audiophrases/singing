import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addStarterSongs } from '../js/cloud/starters.js';

const starters = ['first', 'second', 'third'].map((id) => ({ id, title: id, source: 'band', starter: true, lines: [{ t: 'la la' }] }));
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

// The server's rules: one song per teacher and clientId, and a deleted
// song's clientId is never given a new song.
function fakeServer() {
  const songs = new Map(); const created = []; const calls = [];
  const conflict = (message) => Object.assign(new Error(message), { status: 409 });
  const api = async (path, { method = 'GET', body } = {}) => {
    calls.push(`${method} ${path}`);
    if (path === '/api/songs' && method === 'POST') {
      let s = songs.get(body.clientId);
      if (!s) songs.set(body.clientId, s = { id: `cloud-${body.clientId}`, clientId: body.clientId, revision: 0 });
      if (s.deleted) throw conflict('This imported song was deleted.');
      return { id: s.id, revision: s.revision };
    }
    const s = [...songs.values()].find((x) => path.startsWith(`/api/songs/${x.id}`));
    if (path.endsWith('/visibility')) { s.public = body.public; return { public: body.public }; }
    if (path.endsWith('/commit')) {
      if (body.baseRevision !== s.revision) throw conflict('This song changed on another device.');
      created.push(s.clientId); s.body = body; s.revision += 1;
      s.doc = { ...body.song, id: s.id, clientId: s.clientId, cloud: true, revision: s.revision };
    }
    return { song: s.doc };
  };
  return { songs, created, calls, api };
}

test('a teacher gets one copy of every starter song, in songbook order', async () => {
  const { api, songs, created, calls } = fakeServer(); const storage = memory();
  const added = await addStarterSongs({ api, principalId: 'teacher', documents: [], starters, storage });
  assert.deepEqual(added.map((s) => s.clientId), ['first', 'second', 'third']);
  assert.deepEqual(created, ['third', 'second', 'first'], 'the newest-first library starts with the first song');
  for (const s of songs.values()) {
    assert.equal(s.body.rightsConfirmed, true);
    assert.ok(!('id' in s.body.song) && !('starter' in s.body.song), 'the copy is an ordinary song');
  }
  calls.length = 0;
  assert.deepEqual(await addStarterSongs({ api, principalId: 'teacher', documents: added, starters, storage }), []);
  assert.deepEqual(calls, [], 'nothing to do once the library has them');
});

test('a deleted starter song stays deleted, and this browser stops asking for it', async () => {
  const { api, songs, calls } = fakeServer();
  songs.set('first', { id: 'cloud-first', clientId: 'first', revision: 3, doc: { id: 'cloud-first', clientId: 'first', title: 'My first' } });
  songs.set('second', { id: 'cloud-second', clientId: 'second', revision: 1, deleted: true });
  const storage = memory();
  const added = await addStarterSongs({ api, principalId: 'teacher', documents: [songs.get('first').doc], starters, storage });
  assert.deepEqual(added.map((s) => s.clientId), ['third']);
  assert.equal(songs.get('first').revision, 3, "the teacher's edited copy is untouched");
  calls.length = 0;
  await addStarterSongs({ api, principalId: 'teacher', documents: [songs.get('first').doc, songs.get('third').doc], starters, storage });
  assert.deepEqual(calls, []);
  await addStarterSongs({ api, principalId: 'another-teacher', documents: [], starters, storage });
  assert.ok(calls.length > 0, 'each teacher on a shared computer gets their own songs');
});

test('a copy saved meanwhile in another tab is used, not duplicated', async () => {
  const server = fakeServer();
  let otherTab = true;
  const api = async (path, options) => {
    if (otherTab && path.endsWith('/commit')) {
      otherTab = false;
      await server.api(path, { ...options, body: { ...options.body, song: { ...options.body.song, title: 'From the other tab' } } });
    }
    return server.api(path, options);
  };
  const added = await addStarterSongs({ api, principalId: 'teacher', documents: [], starters, storage: memory() });
  assert.equal(server.songs.size, 3);
  assert.equal(added.find((s) => s.clientId === 'third').title, 'From the other tab');
});

test("the owner's new copies start public; existing copies keep their setting", async () => {
  const { api, songs } = fakeServer();
  songs.set('first', { id: 'cloud-first', clientId: 'first', revision: 2, public: false, doc: { id: 'cloud-first', clientId: 'first' } });
  const added = await addStarterSongs({ api, principalId: 'owner', documents: [songs.get('first').doc], makePublic: true, starters, storage: memory() });
  assert.deepEqual(added.map((s) => [s.clientId, s.public]), [['second', true], ['third', true]]);
  assert.equal(songs.get('second').public, true);
  assert.equal(songs.get('first').public, false, 'a song the owner already has is left alone');
  const teacher = fakeServer();
  await addStarterSongs({ api: teacher.api, principalId: 'teacher', documents: [], starters, storage: memory() });
  assert.ok([...teacher.songs.values()].every((s) => !s.public), "other teachers' copies stay private");
});
