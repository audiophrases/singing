/*
 * Watch a folder for new songs and make their karaoke versions (lab).
 *
 *   const w = new FolderWatcher(dirHandle, { make, onEvent });
 *   w.start();
 *
 * make(file) resolves { karaoke, vocals, ext }: two Blobs and 'mp3' or 'wav'.
 * dirHandle comes from showDirectoryPicker() (File System Access, Chrome and
 * Edge). Results go next to the song: "Sia - Chandelier.mp3" gets
 * "Sia - Chandelier (Karaoke).mp3" and "Sia - Chandelier (Vocals).mp3". A
 * song counts as done when both are there (as MP3 or WAV), so nothing is
 * made twice, even after a restart; results are never taken as new songs. A
 * file is only taken once its size has stopped changing (still copying).
 */
export const AUDIO = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|webm|mp4)$/i;
const RESULT = /\((karaoke|vocals|instrumental)\)\.[^.]+$/i;

export const FORMATS = ['mp3', 'wav'];

export function outputNames(name, ext = 'wav') {
  const base = name.replace(/\.[^.]+$/, '');
  return { karaoke: `${base} (Karaoke).${ext}`, vocals: `${base} (Vocals).${ext}` };
}

// Done in any format: both results there as MP3, or both as WAV.
async function made(dir, name) {
  for (const ext of FORMATS) {
    const names = outputNames(name, ext);
    if (await exists(dir, names.karaoke) && await exists(dir, names.vocals)) return true;
  }
  return false;
}

export const isResult = (name) => RESULT.test(name);

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
    const ready = [];
    const present = new Set();
    for await (const entry of this.dir.values()) {
      if (entry.kind !== 'file' || !AUDIO.test(entry.name) || isResult(entry.name)) continue;
      present.add(entry.name);
      const file = await entry.getFile();
      const stamp = `${file.size}|${file.lastModified}`;
      const before = this.seen.get(entry.name);
      this.seen.set(entry.name, stamp);
      if (!file.size || before !== stamp || this.failed.has(`${entry.name}|${stamp}`)) continue;
      if (await made(this.dir, entry.name)) continue;
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
          const names = outputNames(entry.name, res.ext || 'wav');
          await writeFile(this.dir, names.karaoke, res.karaoke);
          await writeFile(this.dir, names.vocals, res.vocals);
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
