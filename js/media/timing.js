/*
 * Timing files for real recordings: read UltraStar (.txt), LRC, SRT and
 * WebVTT into the Studio's synced lines, so a song bought or ripped by the
 * teacher can be played with lyrics in time instead of tapped along.
 *
 *   readTimingFile(text, name) -> { format, label, meta, lines, notes, words }
 *
 * lines: [{ text, start, end?, section?, part?, words?: [{ start? }],
 *           notes?: [[start, end, midi|null, syllable, golden?]] }]
 *
 * UltraStar files are the richest: every syllable has its time and pitch, so
 * the karaoke wipe is exact and Pitch Pal can score real songs.
 */
import { notesText, guessSyllables } from '../music/timeline.js';

const r2 = (x) => Math.round(x * 100) / 100;

// Text files come in UTF-8, UTF-16 or (older UltraStar and SRT files) Windows-1252.
export function decodeText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
  let s;
  try {
    s = new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch {
    s = new TextDecoder('windows-1252').decode(u8);
  }
  return s.replace(/^﻿/, '');
}

export function detectFormat(text, name = '') {
  const s = String(text || '');
  const ext = (/\.(\w+)$/.exec(name) || [])[1];
  if (/^\s*WEBVTT/.test(s)) return 'vtt';
  if (/^#(TITLE|ARTIST|BPM|GAP|MP3|AUDIO|VERSION)\s*:/im.test(s) && /^[:*FRG]\s+-?\d+\s+\d+\s+-?\d+/m.test(s)) return 'ultrastar';
  if (/\d+:\d+[,.]\d+\s*-->/.test(s)) return ext && ext.toLowerCase() === 'vtt' ? 'vtt' : 'srt';
  if (/^\s*\[\d+:\d+(?:[.:]\d+)?\]/m.test(s)) return 'lrc';
  return 'text';
}

const LABELS = { ultrastar: 'UltraStar', lrc: 'LRC', srt: 'SRT subtitles', vtt: 'WebVTT subtitles', text: 'lyrics' };

export function readTimingFile(text, name = '') {
  const format = detectFormat(text, name);
  let res;
  if (format === 'ultrastar') res = parseUltraStar(text);
  else if (format === 'lrc') res = parseLrc(text);
  else if (format === 'srt' || format === 'vtt') res = parseSubtitles(text);
  else res = { meta: {}, lines: [] };
  const meta = { ...res.meta };
  // "Artist - Title.srt"
  if (!meta.title && name) {
    const base = name.replace(/\.\w+$/, '').replace(/[_]+/g, ' ').trim();
    const m = /^(.+?)\s+-\s+(.+)$/.exec(base);
    if (m) { meta.artist = meta.artist || m[1].trim(); meta.title = m[2].trim(); } else meta.title = base;
  }
  return {
    format,
    label: LABELS[format],
    meta,
    lines: res.lines,
    notes: res.lines.some((l) => Array.isArray(l.notes) && l.notes.some((n) => Number.isFinite(n[2]))),
    words: res.lines.some((l) => Array.isArray(l.words) && l.words.some((w) => w && Number.isFinite(w.start))),
  };
}

// Move every time in the lines by d seconds (never before 0).
export function shiftSynced(lines, d) {
  const sh = (x) => (Number.isFinite(x) ? Math.max(0, r2(x + d)) : x);
  return lines.map((l) => {
    const c = { ...l, start: sh(l.start), end: sh(l.end) };
    if (!Number.isFinite(l.start)) delete c.start;
    if (!Number.isFinite(l.end)) delete c.end;
    if (Array.isArray(l.words)) c.words = l.words.map((w) => (w && Number.isFinite(w.start) ? { ...w, start: sh(w.start) } : w));
    if (Array.isArray(l.notes)) c.notes = l.notes.map((n) => [sh(n[0]), sh(n[1]), ...n.slice(2)]);
    return c;
  });
}

// Music symbols are not lyrics.
function cleanLine(s) {
  return String(s || '')
    .replace(/[♪♫♬#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/*
 * Lines that are not lyrics: "[Chorus]" names the section of the next line
 * (the name), "[Music]" or "(Instrumental)" is just skipped (''). Anything else
 * is a lyric (null).
 */
const SECTION = /^(verse|chorus|pre-?chorus|bridge|intro|outro|hook|refrain|interlude|break|coda|solo)\b/i;
function sectionOf(s) {
  const sq = /^\[(.*)\]$/.exec(s);
  const pa = /^\((.*)\)$/.exec(s);
  const inner = sq ? sq[1].trim() : pa ? pa[1].trim() : null;
  if (inner === null) return null;
  if (SECTION.test(inner)) return inner;
  if (sq || /^(music|instrumental|applause|laughter)\b/i.test(inner)) return '';
  return null;
}

/*
 * Words of a line with times from inline tags (<00:12.34> in enhanced LRC and
 * WebVTT). A tag in the middle of a word belongs to a syllable and is skipped;
 * a tag after the last word is when the line ends.
 */
function timedWords(raw, tagRe, toSec) {
  const tags = [];
  let text = '';
  let last = 0;
  tagRe.lastIndex = 0;
  let m;
  while ((m = tagRe.exec(raw))) {
    text += raw.slice(last, m.index);
    tags.push({ pos: text.length, t: toSec(m[1]) });
    last = m.index + m[0].length;
  }
  text += raw.slice(last);
  const words = [];
  const re = /\S+/g;
  let prevEnd = 0;
  let w;
  while ((w = re.exec(text))) {
    const at = tags.filter((tg) => tg.pos >= prevEnd && tg.pos <= w.index);
    words.push({ text: w[0], start: at.length ? at[at.length - 1].t : undefined });
    prevEnd = w.index + w[0].length;
  }
  const after = tags.filter((tg) => tg.pos >= prevEnd);
  return { words, end: after.length ? after[after.length - 1].t : undefined, tagged: tags.length > 0 };
}

// --------------------------------------------------------------- UltraStar

/*
 * #BPM, #GAP (ms), then ": beat length pitch syllable" notes ("*" golden,
 * "F" freestyle, "R"/"G" rap), "- beat" line breaks, "P1"/"P2" duet parts,
 * "E" the end. A beat is a quarter of the BPM; pitch 0 is middle C.
 */
export function parseUltraStar(text) {
  const meta = {};
  const tracks = new Map();
  let singer = 1;
  const cur = () => {
    if (!tracks.has(singer)) tracks.set(singer, { lines: [[]], rel: 0 });
    return tracks.get(singer);
  };
  const rows = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  for (const row of rows) {
    if (!row.trim()) continue;
    if (row[0] === '#') {
      const m = /^#([^:]+):(.*)$/.exec(row.trim());
      if (m) meta[m[1].trim().toUpperCase()] = m[2].trim();
      continue;
    }
    const c = row[0];
    if (c === 'E') break;
    if (c === 'P') {
      const n = parseInt(row.slice(1), 10);
      if (Number.isFinite(n)) singer = n;
      continue;
    }
    if (c === '-') {
      const tr = cur();
      const nums = row.slice(1).trim().split(/\s+/).map(Number);
      if (tr.lines[tr.lines.length - 1].length) tr.lines.push([]);
      if (relative(meta)) tr.rel += Number.isFinite(nums[1]) ? nums[1] : Number.isFinite(nums[0]) ? nums[0] : 0;
      continue;
    }
    // One space after the pitch; the syllable keeps its own spaces (word ends).
    const m = /^([:*FRG])\s+(-?\d+)\s+(\d+)\s+(-?\d+)(?: (.*))?$/.exec(row);
    if (!m) continue;
    const tr = cur();
    tr.lines[tr.lines.length - 1].push({ type: m[1], beat: Number(m[2]) + tr.rel, len: Number(m[3]), pitch: Number(m[4]), text: m[5] ?? '' });
  }
  const bpm = num(meta.BPM);
  const gap = num(meta.GAP) || 0;
  if (!bpm) return { meta: usMeta(meta), lines: [] };
  const sec = (beat) => gap / 1000 + (beat * 60) / (bpm * 4);
  const names = {};
  for (const k of [1, 2]) {
    const n = meta[`P${k}`] || meta[`DUETSINGERP${k}`] || '';
    names[k] = /^[A-Za-z][\w]{0,11}$/.test(n) ? n : k === 1 ? 'A' : 'B';
  }
  const duet = [...tracks.keys()].some((k) => k === 2);
  let lines = [];
  for (const [k, tr] of tracks) {
    for (const notes of tr.lines) {
      if (!notes.length) continue;
      const out = notes.map((n) => {
        const pitched = n.type === ':' || n.type === '*';
        const note = [r2(sec(n.beat)), r2(sec(n.beat + n.len)), pitched ? 60 + n.pitch : null, n.text];
        if (n.type === '*' || n.type === 'G') note.push(1);
        return note;
      });
      const textOf = notesText(out);
      if (!textOf) continue;
      const line = { text: textOf, start: out[0][0], notes: out };
      if (duet) line.part = k === 3 ? '' : names[k] || '';
      lines.push(line);
    }
  }
  lines.sort((a, b) => a.start - b.start);
  // In duets both singers often share a line: keep it once, for everyone.
  if (duet) {
    lines = lines.filter((l, i) => {
      const twin = lines.slice(0, i).find((o) => o.text === l.text && Math.abs(o.start - l.start) < 0.4);
      if (twin) { twin.part = ''; return false; }
      return true;
    });
  }
  lines.forEach((l, i) => {
    const lastEnd = l.notes[l.notes.length - 1][1];
    const next = lines[i + 1];
    l.end = r2(next && next.start > lastEnd ? Math.min(next.start, lastEnd + 0.6) : lastEnd + 0.6);
  });
  return { meta: usMeta(meta), lines };
}

function relative(meta) {
  return /^(yes|true|1)$/i.test(meta.RELATIVE || '');
}

function num(s) {
  const n = parseFloat(String(s || '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function usMeta(meta) {
  const video = meta.VIDEO || '';
  const yt = /(?:^|[,\s])v=([\w-]{11})(?:[,\s]|$)/.exec(video) || /(?:youtu\.be\/|[?&]v=)([\w-]{11})/.exec(video);
  return {
    title: meta.TITLE || '',
    artist: meta.ARTIST || '',
    audio: meta.AUDIO || meta.MP3 || '',
    language: meta.LANGUAGE || '',
    youtubeId: yt ? yt[1] : '',
  };
}

// --------------------------------------------------------------------- LRC

function lrcTime(s) {
  const m = /^(\d+):(\d+)(?:[.:](\d+))?$/.exec(s);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0);
}

/*
 * [mm:ss.xx]line (several stamps for repeated lines), [ti:], [ar:],
 * [offset:ms], and enhanced <mm:ss.xx> word times. A stamp with no text
 * ends the line before it.
 */
export function parseLrc(text) {
  const meta = {};
  const entries = [];
  for (const row of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = row.trim();
    if (!line) continue;
    const tag = /^\[([a-z#]+)\s*:(.*)\]$/i.exec(line);
    if (tag && !/^\d/.test(tag[1])) { meta[tag[1].toLowerCase()] = tag[2].trim(); continue; }
    const stamps = [];
    let rest = line;
    let m;
    while ((m = /^\[(\d+:\d+(?:[.:]\d+)?)\]/.exec(rest))) {
      stamps.push(lrcTime(m[1]));
      rest = rest.slice(m[0].length);
    }
    if (!stamps.length) continue;
    const tw = timedWords(rest, /<(\d+:\d+(?:[.:]\d+)?)>/g, lrcTime);
    const words = tw.words.map((w) => w.text);
    for (const t of stamps) {
      if (!Number.isFinite(t)) continue;
      const e = { start: r2(t), text: cleanLine(words.join(' ')) };
      if (tw.tagged && stamps.length === 1) {
        e.words = tw.words.map((w) => (Number.isFinite(w.start) ? { start: r2(w.start) } : {}));
        if (Number.isFinite(tw.end)) e.end = r2(tw.end);
      }
      entries.push(e);
    }
  }
  const off = (Number(meta.offset) || 0) / 1000;
  entries.sort((a, b) => a.start - b.start);
  const lines = [];
  let section = '';
  for (const e of entries) {
    const prev = lines[lines.length - 1];
    const sec = e.text ? sectionOf(e.text) : '';
    if (sec !== null) {
      if (prev && !Number.isFinite(prev.end)) prev.end = e.start;
      if (sec) section = sec;
      continue;
    }
    if (e.words && e.words.length !== e.text.split(' ').length) delete e.words;
    if (section) { e.section = section; section = ''; }
    lines.push(e);
  }
  return { meta: { title: meta.ti || '', artist: meta.ar || '' }, lines: off ? shiftSynced(lines, -off) : lines };
}

// --------------------------------------------------------------- SRT / VTT

function subTime(s) {
  const m = /^(?:(\d+):)?(\d+):(\d+)[,.](\d+)$/.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`);
}

/*
 * SRT and WebVTT cues. A cue with two lines of text becomes two lyric lines
 * sharing its time; formatting tags and music symbols go; captions that roll
 * (each cue repeating the line before, as YouTube's do) are not doubled.
 */
export function parseSubtitles(text) {
  const blocks = String(text || '').replace(/^﻿/, '').replace(/\r/g, '').split(/\n\s*\n/);
  const lines = [];
  let section = '';
  const T = '((?:\\d+:)?\\d+:\\d+[,.]\\d+)';
  for (const block of blocks) {
    const rows = block.split('\n');
    const at = rows.findIndex((r) => r.includes('-->'));
    if (at < 0) continue;
    const tm = new RegExp(`${T}\\s*-->\\s*${T}`).exec(rows[at]);
    if (!tm) continue;
    const start = subTime(tm[1]);
    const end = subTime(tm[2]);
    if (!(end - start > 0.05)) continue;
    const texts = rows.slice(at + 1)
      .map((r) => {
        // Formatting ({\an8}, <i>, <c>) goes; inline <00:01.234> word times stay.
        const bare = r.replace(/\{\\[^}]*\}/g, '').replace(/<(?!\d)[^>]*>/g, '');
        const tw = timedWords(bare, /<((?:\d+:)?\d+:\d+\.\d+)>/g, subTime);
        return { text: cleanLine(tw.words.map((w) => w.text).join(' ').replace(/^-\s*/, '')), words: tw.tagged ? tw.words : null };
      })
      .filter((x) => x.text);
    // Rolling captions: the first of two lines is the line before, again.
    const prev = lines[lines.length - 1];
    if (texts.length > 1 && prev && texts[0].text === prev.text && prev.start < start) texts.shift();
    const fresh = texts.filter((x) => {
      const sec = sectionOf(x.text);
      if (sec === null) return true;
      if (sec) section = sec;
      return false;
    });
    if (!fresh.length) continue;
    const weights = fresh.map((x) => x.text.split(' ').reduce((a, w) => a + guessSyllables(w), 0) || 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = start;
    fresh.forEach((x, k) => {
      const len = ((end - start) * weights[k]) / total;
      const s0 = t;
      t += len;
      const line = { text: x.text, start: r2(s0), end: r2(s0 + len) };
      if (x.words && x.words.some((w) => Number.isFinite(w.start)) && x.words.length === x.text.split(' ').length) {
        line.words = x.words.map((w) => (Number.isFinite(w.start) ? { start: r2(w.start) } : {}));
      }
      if (section) { line.section = section; section = ''; }
      lines.push(line);
    });
  }
  lines.sort((a, b) => a.start - b.start);
  return { meta: {}, lines };
}
