import test from 'node:test';
import assert from 'node:assert/strict';
import { describeFile, selectAudioFiles, groupSongFiles, filePath, fileStamp } from '../js/media/song-files.js';
import { importSongFiles, stableSongFiles, directoryFiles } from '../js/media/folder-library.js';
import { packableSong } from '../js/share.js';

function file(path, text = 'audio', lastModified = 1) {
  const f = new File([text], path.split('/').pop(), { lastModified });
  Object.defineProperty(f, 'webkitRelativePath', { value: path, configurable: true });
  return f;
}

function storage() {
  const songs = new Map();
  const media = new Map();
  return {
    songs, media,
    options: {
      listSongs: () => [...songs.values()],
      saveSong: (s) => songs.set(s.id, structuredClone(s)),
      putFile: async (id, f) => media.set(id, f),
      removeFile: async (id) => media.delete(id),
    },
  };
}

test('the pictured folder becomes two songs, with the original distinct from vocals', async () => {
  const files = ['Coldplay - Viva La Vida', 'Sia - Chandelier'].flatMap((name) => [
    file(`${name} (Karaoke).mp3`), file(`${name} (Vocals).mp3`), file(`${name}.m4a`), file(`${name}.txt`, 'First line\nSecond line'),
  ]);
  const groups = await groupSongFiles(files);
  assert.equal(groups.length, 2);
  for (const g of groups) {
    assert.match(g.audio.name, /\.m4a$/);
    assert.match(g.vocals.name, /\(Vocals\)/);
    assert.match(g.karaoke.name, /\(Karaoke\)/);
  }
  const db = storage();
  assert.equal((await importSongFiles(files, 'folder', db.options)).added, 2);
  assert.equal(db.media.size, 6);
  const sia = [...db.songs.values()].find((s) => s.title === 'Chandelier');
  assert.equal(sia.artist, 'Sia');
  assert.equal(sia.synced.length, 2);
});

test('rescanning skips copies and new stems preserve Studio edits and song identity', async () => {
  const files = [file('Sia - Chandelier.m4a'), file('Sia - Chandelier.lrc', '[00:01]First line')];
  const db = storage();
  await importSongFiles(files, 'folder', db.options);
  const song = [...db.songs.values()][0];
  song.title = 'My class song';
  song.synced[0].text = 'Edited in Studio';
  db.songs.set(song.id, song);
  const originalMediaId = song.audio.mediaId;
  assert.equal((await importSongFiles(files, 'folder', db.options)).unchanged, 1);
  assert.equal(db.media.size, 1);
  files.push(file('Sia - Chandelier (Karaoke).mp3'));
  assert.equal((await importSongFiles(files, 'folder', db.options)).updated, 1);
  assert.equal(db.songs.size, 1);
  assert.equal(db.songs.get(song.id).title, 'My class song');
  assert.equal(db.songs.get(song.id).synced[0].text, 'Edited in Studio');
  assert.equal(db.songs.get(song.id).audio.mediaId, originalMediaId);
  files[1] = file('Sia - Chandelier.lrc', '[00:02]Changed on disk', 2);
  await importSongFiles(files, 'folder', db.options);
  assert.equal(db.songs.get(song.id).synced[0].text, 'Changed on disk');
  assert.equal(db.songs.get(song.id).synced[0].start, 2);
  await importSongFiles([files[0]], 'folder', db.options);
  assert.ok(db.songs.get(song.id).karaoke, 'missing source files do not remove imported media');
});

test('a pair of stems works without an original, which can be added later', async () => {
  const files = [file('Song (Karaoke).mp3'), file('Song (Vocals).mp3')];
  const db = storage();
  await importSongFiles(files, 'folder', db.options);
  let song = [...db.songs.values()][0];
  const id = song.id;
  assert.equal(song.audio.mediaId, song.karaoke.mediaId);
  assert.equal(song.audio.stems, true);
  files.push(file('Song.m4a'));
  await importSongFiles(files, 'folder', db.options);
  song = db.songs.get(id);
  assert.equal(song.audio.name, 'Song.m4a');
  assert.equal(song.audio.stems, undefined);
  assert.equal(db.songs.size, 1);
});

test('UltraStar references associate different file names in the same subfolder', async () => {
  const files = [file('Artist/Song.txt', '#TITLE:Song\n#ARTIST:Artist\n#AUDIO:mix.m4a\n#INSTRUMENTAL:backing.mp3\n#VOCALS:lead.mp3\n#BPM:120\n: 0 4 0 Hello\nE'),
    file('Artist/mix.m4a'), file('Artist/backing.mp3'), file('Artist/lead.mp3')];
  const groups = await groupSongFiles(files);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].audio.name, 'mix.m4a');
  assert.equal(groups[0].karaoke.name, 'backing.mp3');
  assert.equal(groups[0].vocals.name, 'lead.mp3');
  assert.equal(groups[0].timing.lines[0].text, 'Hello');
});

test('same names in different subfolders stay separate and known suffixes are case insensitive', async () => {
  assert.equal(describeFile(file('Song (VOCALS).MP3')).role, 'vocals');
  assert.equal(describeFile(file('Song (no vocals).wav')).role, 'karaoke');
  assert.equal(describeFile(file('Karaoke Night.mp3')).role, 'audio');
  assert.equal((await groupSongFiles([file('A/Song.mp3'), file('B/Song.mp3')])).length, 2);
  const vocals = file('Song (Vocals).mp3');
  assert.equal(selectAudioFiles([vocals]).audio, null);
});

test('a growing or newly appearing companion holds the whole group until it is stable', async () => {
  const files = [file('Song.mp3'), file('Song (Vocals).mp3')];
  assert.equal((await stableSongFiles(files, new Map())).files.length, 0);
  const seen = new Map(files.map((f) => [filePath(f), fileStamp(f)]));
  assert.equal((await stableSongFiles(files, seen)).files.length, 2);
  files[1] = file('Song (Vocals).mp3', 'still copying', 2);
  assert.equal((await stableSongFiles(files, seen)).files.length, 0);
  files.push(file('Other song.mp3'));
  const stable = await stableSongFiles(files, seen);
  assert.equal(stable.waiting, 2);
});

test('failed saves clean up new media and do not stop other songs', async () => {
  const db = storage();
  const saveSong = db.options.saveSong;
  db.options.saveSong = (s) => { if (s.title === 'Bad') throw new Error('storage full'); saveSong(s); };
  const result = await importSongFiles([file('Bad.mp3'), file('Good.mp3')], 'folder', db.options);
  assert.equal(result.added, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(db.media.size, 1);
  assert.equal([...db.songs.values()][0].title, 'Good');
});

test('recursive folder reads use no create or write operations', async () => {
  const handle = (name) => ({ kind: 'file', name, getFile: async () => file(name) });
  const dir = { async* values() {
    yield handle('Song.mp3');
    yield handle('cover.jpg');
    yield { kind: 'directory', name: 'More', async* values() { yield handle('Other (Vocals).mp3'); } };
  } };
  assert.deepEqual((await directoryFiles(dir)).map(filePath), ['Song.mp3', 'More/Other (Vocals).mp3']);
});

test('share links omit local folder provenance and all three media identifiers', () => {
  const song = packableSong({ folderImport: { sourceId: 'secret' }, audio: { mediaId: 'a' }, karaoke: { mediaId: 'k' }, vocals: { mediaId: 'v' } });
  assert.equal(song.folderImport, undefined);
  assert.deepEqual([song.audio, song.karaoke, song.vocals], [{}, {}, {}]);
});
