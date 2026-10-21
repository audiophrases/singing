import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { saveUserSong, deleteUserSong, localUserSongs, userSongs, setCloudSongs, markMigrated, getSong } from '../js/store.js';

let storage;
beforeEach(() => {
  storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  setCloudSongs([]);
});

test('changing an uploaded song to lyrics-only cannot save its files in browser-only storage', () => {
  const song = { id: 'uploaded', title: 'Uploaded recording', source: 'none', synced: [] };
  for (const role of ['audio', 'karaoke', 'vocals', 'sourceFile']) {
    assert.throws(() => saveUserSong({ ...song, [role]: { mediaId: 'temporary-file' } }), /private cloud library/);
  }
  assert.deepEqual(localUserSongs(), []);
  assert.throws(() => saveUserSong({ ...song, cloud: true }), /cloud library/);
  saveUserSong(song);
  assert.equal(localUserSongs().length, 1, 'public lyrics-only composition still works');
});

test('deleting a local song never writes in-memory cloud lyrics into localStorage', () => {
  saveUserSong({ id: 'local', title: 'Local composition', source: 'none', synced: [] });
  setCloudSongs([{ id: 'private', title: 'Private cloud song', cloud: true, synced: [{ text: 'Private lyrics' }], mine: false }]);
  deleteUserSong('local');
  assert.deepEqual(localUserSongs(), []);
  assert.equal(userSongs().length, 1);
  assert.equal(getSong('private').mine, false, 'assigned student songs stay read-only');
  assert.ok(![...storage.values()].join('').includes('Private lyrics'));
});

test('migration keeps the original and resolves old links only while the cloud copy is available', () => {
  storage.set('singing.songs.v1', JSON.stringify([{ id: 'legacy', title: 'Old song', source: 'audio', audio: { mediaId: 'legacy-original' } }]));
  setCloudSongs([{ id: 'cloud-copy', title: 'Cloud copy', cloud: true }]);
  markMigrated('legacy', 'teacher', 'cloud-copy');
  assert.equal(userSongs().length, 1);
  assert.equal(getSong('legacy').id, 'cloud-copy');
  assert.equal(localUserSongs()[0].audio.mediaId, 'legacy-original');
  setCloudSongs([]);
  assert.equal(getSong('legacy'), null, 'signing out does not show the old private lyrics');
  assert.equal(localUserSongs().length, 1, 'the original remains available for recovery');
});
