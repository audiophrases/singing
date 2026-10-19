/*
 * Watch a folder for new songs and make their karaoke versions (lab).
 *
 *   const w = new FolderWatcher(dirHandle, { make: (file) => makeKaraoke(file), onEvent });
 *   w.start();
 *
 * dirHandle comes from showDirectoryPicker() (File System Access, Chrome and
 * Edge). Results go to a "Karaoke versions" folder inside it:
 * "Song (Instrumental).wav" and "Song (Vocals).wav". A song counts as done
 * when both are there, so nothing is made twice, even after a restart. A
 * file is only taken once its size has stopped changing (still copying).
 */
export const OUT_DIR = 'Karaoke versions';
export const AUDIO = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|webm|mp4)$/i;

export function outputNames(name) {
  const base = name.replace(/\.[^.]+$/, '');
  return { karaoke: `${base} (Instrumental).wav`, vocals: `${base} (Vocals).wav` };
}

async function exists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function writeFile(dir, name, blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  // The browser writes to a temporary file and swaps it in on close, so a
  // half-written result never appears under the real name.
  const w = await fh.createWritable();
  try {
    await w.write(blob);
    await w.close();
  } catch (e) {
    try { await w.abort(); } catch { /* already closed */ }
    throw e;
  }
}

export class FolderWatcher {
  constructor(dir, { make, onEvent = () => {}, interval = 5000, canRun = () => true } = {}) {
    this.dir = dir;
    this.make = make;
    this.onEvent = onEvent;
    this.interval = interval;
    this.canRun = canRun;
    this.seen = new Map(); // name -> "size|lastModified" at the last scan
    this.failed = new Set(); // "name|size|lastModified" that went wrong: not retried until the file changes
    this.timer = null;
    this.stopped = false;
    this.busy = false;
    this.current = null;
  }

  // Songs ready to make now (stable since the last scan, results missing).
  async pending() {
    let out = null;
    const ready = [];
    const present = new Set();
    for await (const entry of this.dir.values()) {
      if (entry.kind !== 'file' || !AUDIO.test(entry.name)) continue;
      present.add(entry.name);
      const file = await entry.getFile();
      const stamp = `${file.size}|${file.lastModified}`;
      const before = this.seen.get(entry.name);
      this.seen.set(entry.name, stamp);
      if (!file.size || before !== stamp || this.failed.has(`${entry.name}|${stamp}`)) continue;
      if (!out) out = await this.dir.getDirectoryHandle(OUT_DIR, { create: true });
      const names = outputNames(entry.name);
      if (await exists(out, names.karaoke) && await exists(out, names.vocals)) continue;
      ready.push({ entry, stamp });
    }
    for (const name of this.seen.keys()) if (!present.has(name)) this.seen.delete(name);
    return ready.sort((a, b) => a.entry.name.localeCompare(b.entry.name));
  }

  // One look at the folder; makes every ready song, one after another.
  async scan() {
    if (this.busy) return 0;
    this.busy = true;
    let made = 0;
    try {
      for (const { entry, stamp } of await this.pending()) {
        if (this.stopped) break;
        while (!this.canRun() && !this.stopped) await new Promise((r) => setTimeout(r, 1000));
        if (this.stopped) break;
        this.current = entry.name;
        this.onEvent({ type: 'start', name: entry.name });
        try {
          const res = await this.make(await entry.getFile());
          const out = await this.dir.getDirectoryHandle(OUT_DIR, { create: true });
          const names = outputNames(entry.name);
          await writeFile(out, names.karaoke, res.karaoke);
          await writeFile(out, names.vocals, res.vocals);
          made += 1;
          this.onEvent({ type: 'done', name: entry.name, files: [names.karaoke, names.vocals], info: res.info });
        } catch (e) {
          this.failed.add(`${entry.name}|${stamp}`);
          this.onEvent({ type: 'error', name: entry.name, error: e });
        }
      }
    } catch (e) {
      this.onEvent({ type: 'error', name: '', error: e });
    } finally {
      this.current = null;
      this.busy = false;
    }
    return made;
  }

  start() {
    if (this.timer) return;
    this.stopped = false;
    const tick = () => this.scan();
    this.timer = setInterval(tick, this.interval);
    tick();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = null;
  }
}
