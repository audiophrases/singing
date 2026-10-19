import test from 'node:test';
import assert from 'node:assert/strict';
import { FolderWatcher, outputNames, isResult } from '../js/media/folder-watch.js';

// A folder in memory with the File System Access calls the watcher uses.
function fakeDir() {
  const files = new Map();
  const dirs = new Map();
  const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
  const fileHandle = (name) => ({
    kind: 'file',
    name,
    async getFile() { const f = files.get(name); return { name, size: f.size, lastModified: f.lastModified, data: f.data }; },
    async createWritable() {
      let data = null;
      return {
        async write(b) { data = b; },
        async close() { files.set(name, { data, size: 1, lastModified: 1 }); },
        async abort() {},
      };
    },
  });
  const dir = {
    kind: 'directory',
    files,
    dirs,
    put(name, size = 100, lastModified = 1) { files.set(name, { data: name, size, lastModified }); },
    async* values() {
      for (const name of files.keys()) yield fileHandle(name);
      for (const [name, d] of dirs) yield d;
    },
    async getFileHandle(name, { create } = {}) {
      if (!files.has(name) && !create) throw notFound();
      return fileHandle(name);
    },
    async getDirectoryHandle(name, { create } = {}) {
      if (!dirs.has(name)) {
        if (!create) throw notFound();
        dirs.set(name, Object.assign(fakeDir(), { name }));
      }
      return dirs.get(name);
    },
  };
  return dir;
}

const fakeMake = (log) => async (file) => {
  log.push(file.name);
  return { karaoke: `inst:${file.data}`, vocals: `voc:${file.data}`, info: {} };
};

test('output names', () => {
  assert.deepEqual(outputNames('Sia - Chandelier.mp3'), { karaoke: 'Sia - Chandelier (Karaoke).wav', vocals: 'Sia - Chandelier (Vocals).wav' });
  assert.ok(isResult('Sia - Chandelier (Karaoke).wav'));
  assert.ok(isResult('Sia - Chandelier (vocals).WAV'));
  assert.ok(!isResult('Sia - Chandelier.mp3'));
  assert.ok(!isResult('Karaoke Night.mp3'));
});

test('a new song is made once its size stops changing, then never again', async () => {
  const dir = fakeDir();
  const made = [];
  const w = new FolderWatcher(dir, { make: fakeMake(made) });
  dir.put('song.mp3', 100);
  dir.put('notes.txt', 5);
  assert.equal(await w.scan(), 0); // first sight: maybe still copying
  dir.put('song.mp3', 200); // it grew
  assert.equal(await w.scan(), 0);
  assert.equal(await w.scan(), 1); // stable now
  assert.deepEqual(made, ['song.mp3']);
  // Results sit next to the song, and are not taken as new songs.
  assert.equal(dir.files.get('song (Karaoke).wav').data, 'inst:song.mp3');
  assert.equal(dir.files.get('song (Vocals).wav').data, 'voc:song.mp3');
  assert.equal(await w.scan(), 0);
  assert.equal(await w.scan(), 0);
  assert.deepEqual(made, ['song.mp3']);
  // A new session (new watcher) finds the results and skips the song.
  const again = new FolderWatcher(dir, { make: fakeMake(made) });
  await again.scan();
  assert.equal(await again.scan(), 0);
  assert.deepEqual(made, ['song.mp3']);
});

test('results are saved in the chosen format, and either format counts as done', async () => {
  const dir = fakeDir();
  const made = [];
  const w = new FolderWatcher(dir, { make: async (f) => { made.push(f.name); return { karaoke: 'k', vocals: 'v', ext: 'mp3' }; } });
  dir.put('Sia - Chandelier.mp3');
  dir.put('Old Song.mp3');
  dir.put('Old Song (Karaoke).wav');
  dir.put('Old Song (Vocals).wav');
  await w.scan();
  assert.equal(await w.scan(), 1);
  assert.deepEqual(made, ['Sia - Chandelier.mp3']);
  assert.ok(dir.files.has('Sia - Chandelier (Karaoke).mp3'));
  assert.ok(dir.files.has('Sia - Chandelier (Vocals).mp3'));
  assert.equal(outputNames('a.flac', 'mp3').vocals, 'a (Vocals).mp3');
});

test('a failed song is not retried until the file changes', async () => {
  const dir = fakeDir();
  let calls = 0;
  const events = [];
  const w = new FolderWatcher(dir, {
    make: async () => { calls += 1; throw new Error('bad file'); },
    onEvent: (e) => events.push(e.type),
  });
  dir.put('broken.wav');
  await w.scan();
  await w.scan();
  await w.scan();
  assert.equal(calls, 1);
  assert.deepEqual(events, ['start', 'error']);
  dir.put('broken.wav', 100, 2); // replaced
  await w.scan();
  await w.scan();
  assert.equal(calls, 2);
});

test('waits while another karaoke job runs', async () => {
  const dir = fakeDir();
  const made = [];
  let free = false;
  const w = new FolderWatcher(dir, { make: fakeMake(made), canRun: () => free });
  dir.put('a.mp3');
  await w.scan();
  const p = w.scan();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(made, []);
  free = true;
  assert.equal(await p, 1);
});
