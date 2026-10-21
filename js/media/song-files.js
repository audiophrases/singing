/* Match a recording, its stems and its lyrics without confusing vocals with the song. */
import { decodeText, readTimingFile } from './timing.js';

export const AUDIO_FILE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba|webm|mp4)$/i;
export const LYRICS_FILE = /\.(txt|lrc|srt|vtt)$/i;
const KARAOKE = /(?:\s*[-_]\s*|\s*[([]\s*|\s+)(karaoke|instrumental|backing(?: track)?|minus[ -]?one|no[ -]?vocals?|without[ -]?vocals?|off[ -]?vocal|inst)\s*[)\]]?$/i;
const VOCALS = /(?:\s*[-_]\s*|\s*[([]\s*|\s+)(vocals?|acapella|a[ -]?cappella)\s*[)\]]?$/i;
const normal = (s) => s.normalize('NFC').toLowerCase();
export const filePath = (file) => (file.webkitRelativePath || file.name).replace(/\\/g, '/');
export const fileStamp = (file) => `${filePath(file)}|${file.size}|${file.lastModified}`;

export function describeFile(file) {
  const path = filePath(file);
  const slash = path.lastIndexOf('/');
  const directory = path.slice(0, slash + 1);
  let base = path.slice(slash + 1).replace(/\.[^.]+$/, '');
  const role = LYRICS_FILE.test(file.name) ? 'lyrics' : KARAOKE.test(base) ? 'karaoke' : VOCALS.test(base) ? 'vocals' : 'audio';
  if (role === 'karaoke') base = base.replace(KARAOKE, '');
  if (role === 'vocals') base = base.replace(VOCALS, '');
  return { key: normal(directory + base.trim()), directory, base: base.trim(), role };
}

export function selectAudioFiles(files, meta = {}) {
  const audios = files.filter((f) => AUDIO_FILE.test(f.name) || (f.type || '').startsWith('audio/'));
  const named = (name) => name && audios.find((f) => normal(f.name) === normal(name.replace(/\\/g, '/').split('/').pop()));
  const karaoke = named(meta.instrumental) || audios.find((f) => describeFile(f).role === 'karaoke') || null;
  const vocals = named(meta.vocals) || audios.find((f) => f !== karaoke && describeFile(f).role === 'vocals') || null;
  const preferred = named(meta.audio);
  const audio = preferred && preferred !== karaoke && preferred !== vocals ? preferred
    : audios.find((f) => f !== karaoke && f !== vocals && describeFile(f).role === 'audio') || null;
  return { audio, karaoke, vocals };
}

// UltraStar may name audio with a different stem; its explicit references win.
export async function groupSongFiles(files) {
  const supported = [...files].filter((f) => AUDIO_FILE.test(f.name) || LYRICS_FILE.test(f.name));
  const assigned = new Map(supported.map((f) => [f, describeFile(f).key]));
  const parsed = new Map();
  for (const file of supported.filter((f) => LYRICS_FILE.test(f.name))) {
    try {
      const text = decodeText(await file.arrayBuffer());
      const timing = readTimingFile(text, file.name);
      parsed.set(file, { text, timing });
      const { directory, key } = describeFile(file);
      for (const name of [timing.meta.audio, timing.meta.instrumental, timing.meta.vocals].filter(Boolean)) {
        const target = normal(directory + name.replace(/\\/g, '/').replace(/^\.\//, ''));
        const match = supported.find((f) => AUDIO_FILE.test(f.name) && normal(filePath(f)) === target);
        if (match) assigned.set(match, key);
      }
    } catch (error) {
      parsed.set(file, { error });
    }
  }
  const groups = new Map();
  for (const file of supported) {
    const key = assigned.get(file);
    if (!groups.has(key)) groups.set(key, { key, base: describeFile(file).base, files: [] });
    groups.get(key).files.push(file);
  }
  const priority = (f) => ({ txt: 0, lrc: 1, vtt: 2, srt: 3 })[f.name.split('.').pop().toLowerCase()] ?? 4;
  return [...groups.values()].map((group) => {
    const lyrics = group.files.filter((f) => LYRICS_FILE.test(f.name)).sort((a, b) => priority(a) - priority(b))[0] || null;
    const data = parsed.get(lyrics);
    return { ...group, lyrics, ...data, ...selectAudioFiles(group.files, data?.timing?.meta) };
  });
}
