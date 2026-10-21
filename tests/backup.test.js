import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSongBackup, readSongBackup } from '../js/media/backup.js';

test('portable backup preserves original bytes, lyrics and MIME types without duplicating shared stems', async () => {
  const original = new Blob([new Uint8Array([0, 1, 255, 4])], { type: 'audio/mp4' });
  const songs = [{ id: 'old', title: '🎵 Old song', source: 'audio', synced: [{ text: 'Original lyrics', start: 0 }], audio: { mediaId: 'shared', name: 'original.m4a' }, karaoke: { mediaId: 'shared' } }];
  const made = await createSongBackup(songs, async () => original);
  const backup = await readSongBackup(made.blob);
  assert.deepEqual(backup.songs, songs);
  assert.equal(backup.files.size, 1);
  assert.equal(backup.files.get('shared').type, 'audio/mp4');
  assert.deepEqual(await backup.files.get('shared').arrayBuffer(), await original.arrayBuffer());
  assert.deepEqual(made.missing, []);
});

test('damaged and truncated audio is detected before a backup can be imported', async () => {
  const made = await createSongBackup([{ id: 'old', title: 'Old', audio: { mediaId: 'a' } }], async () => new Blob(['original']));
  const damaged = new Uint8Array(await made.blob.arrayBuffer()); damaged[damaged.length - 1] ^= 1;
  await assert.rejects(readSongBackup(new Blob([damaged])), /damaged/);
  await assert.rejects(readSongBackup(made.blob.slice(0, made.blob.size - 1)), /incomplete/);
  await assert.rejects(readSongBackup(new Blob([made.blob, 'extra'])), /Unexpected data/);
});

test('invalid headers cannot request an unbounded metadata allocation', async () => {
  await assert.rejects(readSongBackup(new Blob(['This is not a backup file'])), /not a Singing backup/);
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, 0xffffffff);
  await assert.rejects(readSongBackup(new Blob(['SINGING1\n', length])), /header is incomplete or too large/);
});

test('missing legacy files are reported while other songs and originals remain in the backup', async () => {
  const songs = [{ id: 'missing', title: 'Missing', audio: { mediaId: 'gone', name: 'missing.mp3' } }, { id: 'kept', title: 'Kept', audio: { mediaId: 'present' } }];
  const made = await createSongBackup(songs, async (id) => id === 'present' ? new Blob(['music']) : undefined);
  const backup = await readSongBackup(made.blob);
  assert.equal(backup.songs.length, 2);
  assert.deepEqual(made.missing, ['Missing: missing.mp3']);
  assert.equal(await backup.files.get('present').text(), 'music');
});
