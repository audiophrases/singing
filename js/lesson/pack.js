/*
 * Lesson packs: the JSON an external AI sends back after reading the prompt
 * from js/lesson/prompt.js, saved with the song as song.lesson. readPack()
 * checks a reply against the lyrics and keeps what will work; the rest of this
 * file turns a saved pack into what each game needs.
 *
 * Whatever points at the lyrics is an anchor: { line, words }. line counts the
 * sung lines from 1 and words is quoted from that line. AIs quote well and
 * count badly, so anchors hold the words rather than positions, and a wrong
 * line number is corrected when the quote is somewhere else in the song.
 * Anchors are looked up again whenever a game starts, so a pack survives new
 * timing, and only the items whose words were edited away drop out. A line
 * that repeats (a chorus) shares its anchors with every repeat.
 *
 * A pack arrives in batches, one reply each, as PinPlay's quizzes do: each reply
 * is read here and joined to the pack with mergePacks().
 *
 * Teacher-only material lives under pack.teacher: the Worker removes it from
 * the copies students and the public player receive (cloudflare/songs.js).
 * pack.clean is not teacher-only, because students must get the clean version.
 *
 * This module runs in the browser and in the Worker: no DOM here.
 */
import { normWord } from '../lyrics/text.js';
import { sungLines } from '../music/timeline.js';

export const PACK_FORMAT = 'singing-lesson-pack';
export const PACK_VERSION = 1;
export const LEVELS = ['Pre-A1', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
// The moods of music/composer.js and the ids of games/index.js. They are listed
// here because those modules do not belong in the Worker; tests keep them equal.
export const CHANT_MOODS = ['pop', 'folk', 'calm', 'rock', 'sad', 'reggae', 'march', 'disco', 'chant'];
export const ACTIVITY_IDS = ['karaoke', 'echo', 'round', 'pitch', 'gapfill', 'choose', 'wrongword', 'order', 'bingo', 'finish', 'builder', 'hotmic', 'freeze', 'rhyme', 'hunt', 'speak', 'quiz'];
export const POPUP_KINDS = { grammar: '🧩', word: '📖', sound: '👄', culture: '🌍', 'song-english': '🎸' };
export const CARD_KINDS = ['discuss', 'personal', 'roleplay', 'language', 'sing'];
export const MAX_REPLY = 400 * 1024;

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const strings = (v, max, each = 80) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, each)).filter(Boolean))].slice(0, max) : []);
const emoji = (v) => { const s = str(v, 16); return /\p{Extended_Pictographic}/u.test(s) ? s : ''; };
const oneOf = (v, allowed, fallback = '') => (allowed.includes(v) ? v : fallback);

// Drop the empty fields, so saved packs stay small.
function compact(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === '' || v === null || v === undefined) continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out;
}

// ------------------------------------------------------------------ anchors

const quoted = (words) => String(words || '').split(/\s+/).map(normWord).filter(Boolean);
const lineKey = (line) => line.words.map((w) => normWord(w.text)).join(' ');
const bare = (text) => String(text).replace(/^[^A-Za-z0-9'’]+|[^A-Za-z0-9'’]+$/g, '');

// Every place the quoted words appear in a line: [{ from, to }] word positions.
function matches(line, words) {
  const want = quoted(words);
  const have = line.words.map((w) => normWord(w.text));
  const out = [];
  if (!want.length) return out;
  for (let i = 0; i + want.length <= have.length; i += 1) {
    if (want.every((w, k) => have[i + k] === w)) out.push({ from: i, to: i + want.length - 1 });
  }
  return out;
}

// The sung line an anchor belongs to: the numbered one, or the nearest with the words.
function homeLine(sung, number, words) {
  const n = Number(number);
  const wanted = Number.isInteger(n) ? n - 1 : 0;
  if (sung[wanted] && matches(sung[wanted], words).length) return { line: sung[wanted], number: wanted + 1 };
  let best = null;
  sung.forEach((line, i) => {
    if (matches(line, words).length && (!best || Math.abs(i - wanted) < Math.abs(best.number - 1 - wanted))) best = { line, number: i + 1 };
  });
  return best;
}

/*
 * Where an anchor lands in this timeline, on the line and on each repeat of it:
 * [{ line, from, to }]. every: all the places in each line, not just the first.
 */
export function spots(timeline, item, { every = false } = {}) {
  const sung = sungLines(timeline);
  const home = homeLine(sung, item.line, item.words);
  if (!home) return [];
  const key = lineKey(home.line);
  const out = [];
  for (const line of sung) {
    if (lineKey(line) !== key) continue;
    const found = matches(line, item.words);
    for (const m of every ? found : found.slice(0, 1)) out.push({ line, ...m });
  }
  return out;
}

// ----------------------------------------------------------- reading a reply

// The JSON inside an AI's reply, whatever it wrote around it.
function jsonIn(text) {
  let s = String(text ?? '').replace(/^﻿/, '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const from = s.indexOf('{');
  const to = s.lastIndexOf('}');
  return from >= 0 && to > from ? s.slice(from, to + 1) : from >= 0 ? s.slice(from) : '';
}

// Does the text stop inside an object or a string? Then the reply was cut off.
function cutOff(s) {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
  }
  return inString || depth > 0;
}

function parseReply(text) {
  if (String(text ?? '').length > MAX_REPLY) return { fatal: 'This reply is too long to be one lesson pack. Ask the AI for a smaller pack.' };
  const source = jsonIn(text);
  if (!source) return { fatal: 'There is no JSON in this reply. Paste the whole reply from the AI.' };
  try {
    return { data: JSON.parse(source) };
  } catch (first) {
    if (cutOff(source)) return { fatal: 'The reply stops before the JSON ends: it was cut off. Ask the AI to send it again, or choose a smaller amount and make a new prompt.', cut: true };
    // The usual slip: a comma after the last item.
    try { return { data: JSON.parse(source.replace(/,(\s*[}\]])/g, '$1')) }; } catch { /* report the first error */ }
    return { fatal: `This is not valid JSON: ${first.message}` };
  }
}

function checker(timeline) {
  const c = {
    sung: sungLines(timeline),
    problems: [],
    moved: 0,
    tried: 0,
    missed: 0,
    problem(where, why) { c.problems.push(`${where}: ${why}`); },
    // One item pointing at the lyrics, or null.
    anchor(raw, where, { oneWord = false } = {}) {
      const words = str(raw.words ?? raw.word, 160);
      if (!words) { c.problem(where, 'it needs "words", quoted from the line'); return null; }
      c.tried += 1;
      const home = homeLine(c.sung, raw.line, words);
      if (!home) {
        c.missed += 1;
        c.problem(where, `"${words}" is not in ${Number.isInteger(raw.line) ? `L${raw.line} or any other line` : 'the lyrics'}`);
        return null;
      }
      const m = matches(home.line, words)[0];
      if (oneWord && m.to !== m.from) { c.problem(where, `use one word, not "${words}"`); return null; }
      if (home.number !== raw.line) c.moved += 1;
      return { line: home.number, words: home.line.words.slice(m.from, m.to + 1).map((w) => bare(w.text)).join(' ') };
    },
    // Wrong word and Finish the line have one moment on each line.
    onePerLine(spot, where, seen) {
      const key = lineKey(c.sung[spot.line - 1]);
      if (seen.has(key)) { c.problem(where, `L${spot.line} already has one: use one for each line`); return false; }
      seen.add(key);
      return true;
    },
    list(value, name, max, read) {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value)) { c.problem(name, 'it must be a list'); return []; }
      if (value.length > max) c.problem(name, `only the first ${max} of ${value.length} were kept`);
      const out = [];
      value.slice(0, max).forEach((item, i) => {
        const where = `${name} ${i + 1}`;
        if (!isObject(item)) { c.problem(where, 'it must be an object'); return; }
        const got = read(item, where);
        if (got) out.push(got);
      });
      return out;
    },
  };
  return c;
}

const slug = (s) => str(s, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function uniqueId(raw, taken) {
  const base = slug(raw.id) || slug(raw.name) || 'set';
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

const SECTIONS = ['format', 'version', 'batch', 'progress', 'song', 'profile', 'teacher', 'clean', 'cleanOff', 'lines', 'words', 'popups', 'hunts', 'gapSets', 'swaps', 'stops', 'quiz', 'cards', 'pairs', 'moves', 'say', 'echo', 'chant'];

/*
 * text: the AI's reply. -> { pack, batch, problems, moved, fatal, cut }
 * pack is null with a fatal message when nothing can be used. problems name
 * every item that was left out; moved counts anchors corrected to another line.
 */
export function readPack(text, timeline, { title = '' } = {}) {
  const parsed = parseReply(text);
  if (parsed.fatal) return { pack: null, problems: [], moved: 0, fatal: parsed.fatal, cut: !!parsed.cut };
  const raw = parsed.data;
  if (!isObject(raw)) return { pack: null, problems: [], moved: 0, fatal: 'The reply must be one JSON object.' };
  const c = checker(timeline);
  if (raw.format !== PACK_FORMAT) c.problem('format', `expected "${PACK_FORMAT}"`);
  if (Number(raw.version) > PACK_VERSION) c.problem('version', `this app reads version ${PACK_VERSION}, so newer fields are ignored`);
  for (const key of Object.keys(raw)) if (!SECTIONS.includes(key)) c.problem(key, 'this is not a section of the format, so it was ignored');
  if (isObject(raw.song)) {
    const same = (a, b) => str(a).toLowerCase() === str(b).toLowerCase();
    if (title && raw.song.title && !same(raw.song.title, title)) c.problem('song', `this pack was written for "${str(raw.song.title, 80)}"`);
    if (Number.isInteger(raw.song.lines) && raw.song.lines !== c.sung.length) c.problem('song', `it counted ${raw.song.lines} lines, the song has ${c.sung.length}`);
  }

  const profile = isObject(raw.profile) ? compact({
    level: oneOf(raw.profile.level, LEVELS),
    grammar: strings(raw.profile.grammar, 6),
    themes: strings(raw.profile.themes, 5),
    vocab: strings(raw.profile.vocab, 16),
    summary: str(raw.profile.summary, 400),
  }) : {};

  const clean = c.list(raw.clean, 'clean', 30, (item, where) => {
    const words = str(item.words, 60);
    if (!words) { c.problem(where, 'it needs "words"'); return null; }
    if (!c.sung.some((line) => matches(line, words).length)) { c.problem(where, `"${words}" is not in the lyrics`); return null; }
    return compact({ words, why: str(item.why, 160) });
  });

  const lines = c.list(raw.lines, 'lines', 300, (item, where) => {
    if (!Number.isInteger(item.line) || !c.sung[item.line - 1]) { c.problem(where, `L${item.line} does not exist`); return null; }
    const row = compact({ line: item.line, emoji: emoji(item.emoji), translation: str(item.translation), plain: str(item.plain) });
    return Object.keys(row).length > 1 ? row : null;
  });

  const words = c.list(raw.words, 'words', 80, (item, where) => {
    const word = str(item.word, 60);
    const meaning = str(item.meaning, 200);
    if (!word || !meaning) { c.problem(where, 'it needs "word" and "meaning"'); return null; }
    return compact({ word, meaning, translation: str(item.translation, 80), emoji: emoji(item.emoji), example: str(item.example, 160), ipa: str(item.ipa, 40) });
  });

  const popups = c.list(raw.popups, 'popups', 200, (item, where) => {
    const spot = c.anchor(item, where);
    const note = str(item.text, 160);
    if (!spot) return null;
    if (!note) { c.problem(where, 'it needs "text"'); return null; }
    return { ...spot, kind: POPUP_KINDS[item.kind] ? item.kind : 'word', text: note };
  });

  const taken = new Set();
  const setName = (item, where) => {
    const name = str(item.name, 60);
    if (!name) c.problem(where, 'it needs a "name"');
    return name;
  };

  const hunts = c.list(raw.hunts, 'hunts', 16, (item, where) => {
    const name = setName(item, where);
    if (!name) return null;
    const targets = c.list(item.targets, `${where} target`, 200, (t, w) => {
      const spot = c.anchor(t, w);
      return spot && compact({ ...spot, why: str(t.why, 200) });
    });
    if (!targets.length) { c.problem(where, 'none of its targets are in the lyrics'); return null; }
    return compact({ id: uniqueId(item, taken), name, emoji: emoji(item.emoji), level: oneOf(item.level, LEVELS), rule: str(item.rule, 200), targets });
  });

  const gapSets = c.list(raw.gapSets, 'gapSets', 16, (item, where) => {
    const name = setName(item, where);
    if (!name) return null;
    const gaps = c.list(item.gaps, `${where} gap`, 120, (g, w) => {
      const spot = c.anchor(g, w);
      if (!spot) return null;
      const options = strings(g.options, 3, 40).filter((o) => normWord(o) !== normWord(spot.words));
      return compact({ ...spot, options, why: str(g.why, 200) });
    });
    if (!gaps.length) { c.problem(where, 'none of its gaps are in the lyrics'); return null; }
    return compact({ id: uniqueId(item, taken), name, emoji: emoji(item.emoji), level: oneOf(item.level, LEVELS), rule: str(item.rule, 200), gaps });
  });

  const swapped = new Set();
  const swaps = c.list(raw.swaps, 'swaps', 120, (item, where) => {
    const spot = c.anchor(item, where, { oneWord: true });
    const wrong = str(item.wrong, 40);
    if (!spot) return null;
    if (!wrong || /\s/.test(wrong) || normWord(wrong) === normWord(spot.words)) { c.problem(where, 'it needs one "wrong" word that differs from the lyric'); return null; }
    if (!c.onePerLine(spot, where, swapped)) return null;
    return compact({ ...spot, wrong, why: str(item.why, 200) });
  });

  const stopped = new Set();
  const stops = c.list(raw.stops, 'stops', 60, (item, where) => {
    const spot = c.anchor(item, where);
    const ask = str(item.ask, 160);
    if (!spot) return null;
    if (!ask) { c.problem(where, 'it needs "ask"'); return null; }
    if (!c.onePerLine(spot, where, stopped)) return null;
    return { ...spot, ask };
  });

  const quiz = c.list(raw.quiz, 'quiz', 120, (item, where) => {
    const q = str(item.q, 240);
    const answer = str(item.answer, 120);
    const wrong = strings(item.wrong, 3, 120).filter((w) => w.toLowerCase() !== answer.toLowerCase());
    if (!q || !answer) { c.problem(where, 'it needs "q" and "answer"'); return null; }
    if (!wrong.length) { c.problem(where, 'it needs wrong answers'); return null; }
    const line = Number.isInteger(item.line) && c.sung[item.line - 1] ? item.line : '';
    return compact({ when: oneOf(item.when, ['before', 'after'], 'after'), level: oneOf(item.level, LEVELS), q, answer, wrong, line, explain: str(item.explain, 240) });
  });

  const cards = c.list(raw.cards, 'cards', 150, (item, where) => {
    const body = str(item.body, 240);
    if (!body) { c.problem(where, 'it needs "body"'); return null; }
    return compact({ kind: oneOf(item.kind, CARD_KINDS, 'discuss'), level: oneOf(item.level, LEVELS), emoji: emoji(item.emoji), title: str(item.title, 60), body, answer: str(item.answer, 200) });
  });

  const pairs = c.list(raw.pairs, 'pairs', 16, (item, where) => {
    const name = setName(item, where);
    if (!name) return null;
    // AIs put "translated" on the set or on each pair: either counts.
    let translated = item.translated === true;
    const rows = c.list(item.pairs, `${where} pair`, 24, (p, w) => {
      const a = str(p.a, 60);
      const b = str(p.b, 60);
      if (!a || !b || a === b) { c.problem(w, 'it needs two different sides, "a" and "b"'); return null; }
      if (p.translated === true) translated = true;
      return { a, b };
    });
    if (rows.length < 3) { c.problem(where, 'a memory game needs at least 3 pairs'); return null; }
    return compact({ id: uniqueId(item, taken), name, emoji: emoji(item.emoji), level: oneOf(item.level, LEVELS), translated: translated ? true : '', pairs: rows });
  });

  const moves = c.list(raw.moves, 'moves', 40, (item, where) => {
    const word = normWord(str(item.word, 40));
    const moveText = str(item.text, 60);
    if (!word || /\s/.test(word) || !moveText) { c.problem(where, 'it needs one "word" and "text"'); return null; }
    if (!c.sung.some((l) => l.words.some((w) => normWord(w.text) === word))) { c.problem(where, `"${word}" is not in the lyrics`); return null; }
    return compact({ word, text: moveText, emoji: emoji(item.emoji) });
  });

  const say = c.list(raw.say, 'say', 60, (item, where) => {
    const spot = c.anchor(item, where);
    const tip = str(item.tip, 200);
    if (!spot) return null;
    if (!tip) { c.problem(where, 'it needs "tip"'); return null; }
    return compact({ ...spot, skill: str(item.skill, 30), tip });
  });

  const echo = c.list(raw.echo, 'echo', 30, (item, where) => {
    const { from, to } = item;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || !c.sung[to - 1]) { c.problem(where, `L${from}–L${to} are not lines of this song`); return null; }
    if (to - from > 3) { c.problem(where, 'a step can have at most 4 lines'); return null; }
    return compact({ from, to, why: str(item.why, 200) });
  });

  const chantText = isObject(raw.chant) && typeof raw.chant.text === 'string' ? raw.chant.text.replace(/\r/g, '').trim().slice(0, 1600) : '';
  const chant = chantText ? compact({ title: str(raw.chant.title, 60), mood: oneOf(raw.chant.mood, CHANT_MOODS, 'pop'), text: chantText, teaches: str(raw.chant.teaches, 160) }) : null;

  // Steps of the plan name a set from the sections read above.
  const setsFor = { hunt: hunts, gapfill: gapSets, choose: gapSets, rhyme: pairs };
  const rawTeacher = isObject(raw.teacher) ? raw.teacher : {};
  const cautions = c.list(rawTeacher.cautions, 'cautions', 30, (item, where) => {
    const note = str(item.note);
    if (!note) { c.problem(where, 'it needs "note"'); return null; }
    const spot = item.words ? c.anchor(item, where) : Number.isInteger(item.line) && c.sung[item.line - 1] ? { line: item.line } : null;
    return compact({ ...spot, severity: oneOf(item.severity, ['mild', 'serious'], 'mild'), note });
  });
  const teacher = compact({ levelWhy: str(rawTeacher.levelWhy, 400), notes: str(rawTeacher.notes, 1600), cautions });

  const pack = compact({ format: PACK_FORMAT, version: PACK_VERSION, profile, teacher, clean, cleanOff: raw.cleanOff === true ? true : '', lines, words, popups, hunts, gapSets, swaps, stops, quiz, cards, pairs, moves, say, echo, chant });
  for (const empty of ['profile', 'teacher']) if (pack[empty] && !Object.keys(pack[empty]).length) delete pack[empty];
  if (!Object.keys(pack).some((k) => k !== 'format' && k !== 'version')) {
    return { pack: null, problems: c.problems, moved: c.moved, fatal: 'Nothing in this reply can be used. See the list below.' };
  }
  if (c.tried >= 5 && c.missed / c.tried > 0.5) c.problems.unshift(`Most items quote words that are not in these lyrics (${c.missed} of ${c.tried}). Is this the reply for another song?`);
  return { pack, batch: Number.isInteger(raw.batch) ? raw.batch : 0, problems: c.problems, moved: c.moved };
}

// ---------------------------------------------------------- joining batches

function joined(a = [], b = [], key) {
  const seen = new Set(a.map(key));
  return [...a, ...b.filter((item) => !seen.has(key(item)) && seen.add(key(item)))];
}

// Sets with the same id are one set: its items are joined.
function joinedSets(a = [], b = [], kids, key) {
  const out = a.map((set) => ({ ...set }));
  for (const set of b) {
    const same = out.find((s) => s.id === set.id);
    if (same) same[kids] = joined(same[kids], set[kids], key);
    else out.push(set);
  }
  return out;
}

const spot = (item) => `${item.line}|${normWord(item.words)}|${quoted(item.words).join(' ')}`;

/*
 * A pack and the next batch, as one pack. Reading the same batch twice adds
 * nothing. Run the result through readPack, which keeps its limits per line.
 */
export function mergePacks(a, b) {
  const lines = new Map((a.lines || []).map((row) => [row.line, row]));
  for (const row of b.lines || []) lines.set(row.line, { ...lines.get(row.line), ...row });
  return compact({
    format: PACK_FORMAT,
    version: PACK_VERSION,
    profile: { ...a.profile, ...b.profile },
    teacher: compact({ ...a.teacher, ...b.teacher, cautions: joined(a.teacher?.cautions, b.teacher?.cautions, (c) => c.note) }),
    clean: joined(a.clean, b.clean, (c) => quoted(c.words).join(' ')),
    cleanOff: a.cleanOff || b.cleanOff || '',
    lines: [...lines.values()].sort((x, y) => x.line - y.line),
    words: joined(a.words, b.words, (w) => normWord(w.word)),
    popups: joined(a.popups, b.popups, (p) => `${spot(p)}|${p.text}`),
    hunts: joinedSets(a.hunts, b.hunts, 'targets', spot),
    gapSets: joinedSets(a.gapSets, b.gapSets, 'gaps', spot),
    swaps: joined(a.swaps, b.swaps, spot),
    stops: joined(a.stops, b.stops, spot),
    quiz: joined(a.quiz, b.quiz, (q) => q.q),
    cards: joined(a.cards, b.cards, (card) => card.body),
    pairs: joinedSets(a.pairs, b.pairs, 'pairs', (p) => p.a),
    moves: joined(a.moves, b.moves, (m) => m.word),
    say: joined(a.say, b.say, (s) => `${spot(s)}|${s.tip}`),
    echo: joined(a.echo, b.echo, (s) => `${s.from}-${s.to}`),
    chant: b.chant || a.chant,
  });
}

// ---------------------------------------------------------- the clean version

// Keep the first letter, hide the others: "f*****'". Punctuation stays.
function maskWord(word) {
  let first = true;
  const hide = (text) => text.replace(/\p{L}/gu, (letter) => {
    if (!first) return '*';
    first = false;
    return letter;
  });
  for (const syllable of word.syllables) syllable.text = hide(syllable.text);
  first = true;
  word.text = hide(word.text);
}

/*
 * The clean version of a recording: masks pack.clean's words in the timeline,
 * wherever they are sung, and returns when to take the singer away:
 * [[start, end]] in seconds. The browser's track and the Worker's marking both
 * call this, so they pick the same gaps from the same words. It changes the
 * timeline it gets: read the raw lyrics from a timeline that has not been here.
 */
export function cleanTimeline(timeline, lesson) {
  if (!lesson?.clean?.length || lesson.cleanOff) return [];
  const spans = [];
  for (const line of sungLines(timeline)) {
    const hide = new Set();
    for (const item of lesson.clean) {
      for (const { from, to } of matches(line, item.words)) for (let wi = from; wi <= to; wi += 1) hide.add(wi);
    }
    if (!hide.size) continue;
    for (const wi of [...hide].sort((a, b) => a - b)) {
      const word = line.words[wi];
      spans.push([word.start - 0.05, word.end + 0.12]);
      for (const note of line.notes || []) if (note.start >= word.start - 0.01 && note.end <= word.end + 0.01) note.text = '';
      maskWord(word);
    }
    line.text = line.words.map((w) => w.text).join(' ');
  }
  spans.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else out.push([...span]);
  }
  return out;
}

// A word the teacher adds by hand. -> how many times it is sung (0: not added).
export function addCleanWord(pack, timeline, words) {
  const found = sungLines(timeline).reduce((n, line) => n + matches(line, words).length, 0);
  if (!found) return 0;
  pack.clean = joined(pack.clean, [{ words: String(words).trim() }], (c) => quoted(c.words).join(' '));
  return found;
}

// ------------------------------------------------------------- saving a pack

/*
 * The song with its pack, as a new object. Pictures only fill lines that have
 * none, so a teacher's own pictures stay; translations replace the old ones.
 */
export function applyPack(song, pack, timeline, { profile = true, pictures = true, translations = true } = {}) {
  const next = JSON.parse(JSON.stringify(song));
  next.lesson = JSON.parse(JSON.stringify(pack));
  const p = pack.profile;
  if (profile && p) {
    if (p.level) next.level = p.level;
    if (p.grammar) next.grammar = p.grammar;
    if (p.themes) next.themes = p.themes;
    if (p.vocab) next.vocab = p.vocab;
    if (p.summary && !next.about) next.about = p.summary;
  }
  // timeline.lines and these rows are the same list, in the same order.
  const rows = !next.source || next.source === 'band' ? next.lines : next.synced;
  const sung = sungLines(timeline);
  for (const row of pack.lines || []) {
    const home = sung[row.line - 1];
    if (!home) continue;
    const key = lineKey(home);
    for (const line of sung) {
      const target = rows?.[line.index];
      if (!target || lineKey(line) !== key) continue;
      if (pictures && row.emoji && !target.pic) target.pic = row.emoji;
      if (translations && row.translation) target.tr = row.translation;
    }
  }
  return next;
}

export function removePack(song) {
  const next = JSON.parse(JSON.stringify(song));
  delete next.lesson;
  return next;
}

export const lessonOf = (song) => (isObject(song?.lesson) ? song.lesson : null);

// ------------------------------------------------- what each game reads

const pos = (line, wi) => `${line.index}:${wi}`;

// Fill the gaps, Choose the word and worksheets: Map(line index -> Set(word index)).
export function lessonGaps(timeline, lesson, id) {
  const out = new Map();
  const set = lesson?.gapSets?.find((s) => s.id === id);
  for (const gap of set?.gaps || []) {
    for (const { line, from, to } of spots(timeline, gap)) {
      if (!out.has(line.index)) out.set(line.index, new Set());
      for (let wi = from; wi <= to; wi += 1) out.get(line.index).add(wi);
    }
  }
  return out;
}

// What the AI wrote about each gap: Map('line:word' -> { options, why }).
export function gapNotes(timeline, lesson, id) {
  const out = new Map();
  const set = lesson?.gapSets?.find((s) => s.id === id);
  for (const gap of set?.gaps || []) {
    for (const { line, from, to } of spots(timeline, gap)) {
      for (let wi = from; wi <= to; wi += 1) out.set(pos(line, wi), { options: from === to ? gap.options || [] : [], why: gap.why || '' });
    }
  }
  return out;
}

// Grammar hunt: the words that count in each set, with why they count.
export function huntSets(timeline, lesson) {
  return (lesson?.hunts || []).map((set) => {
    const marks = new Map();
    for (const target of set.targets) {
      for (const { line, from, to } of spots(timeline, target, { every: true })) {
        for (let wi = from; wi <= to; wi += 1) marks.set(pos(line, wi), target.why || '');
      }
    }
    return { ...set, marks };
  }).filter((set) => set.marks.size);
}

export const huntKey = pos;

// Wrong word: Map(line index -> { wi, wrong, why }), one swap on each line.
export function lessonSwaps(timeline, lesson) {
  const out = new Map();
  for (const swap of lesson?.swaps || []) {
    for (const { line, from } of spots(timeline, swap)) {
      if (!out.has(line.index)) out.set(line.index, { wi: from, wrong: swap.wrong, why: swap.why || '' });
    }
  }
  return out;
}

// Finish the line: Map(line index -> { from, ask }), the first time a line is sung.
export function lessonStops(timeline, lesson) {
  const out = new Map();
  for (const stop of lesson?.stops || []) {
    const spot = spots(timeline, stop)[0];
    if (spot && !out.has(spot.line.index)) out.set(spot.line.index, { from: spot.from, ask: stop.ask });
  }
  return out;
}

// Karaoke's notes: Map(line index -> [{ kind, text, from, to }]).
export function lessonPopups(timeline, lesson) {
  const out = new Map();
  for (const popup of lesson?.popups || []) {
    for (const { line, from, to } of spots(timeline, popup)) {
      if (!out.has(line.index)) out.set(line.index, []);
      out.get(line.index).push({ kind: popup.kind, text: popup.text, from, to });
    }
  }
  return out;
}

// Say it!: Map(line index -> [{ tip, skill, from, to }]).
export function lessonSay(timeline, lesson) {
  const out = new Map();
  for (const item of lesson?.say || []) {
    for (const { line, from, to } of spots(timeline, item)) {
      if (!out.has(line.index)) out.set(line.index, []);
      out.get(line.index).push({ tip: item.tip, skill: item.skill || '', from, to });
    }
  }
  return out;
}

// Echo in teaching order: [{ lines, why }].
export function lessonEcho(timeline, lesson) {
  const sung = sungLines(timeline);
  return (lesson?.echo || []).map((step) => ({ lines: sung.slice(step.from - 1, step.to), why: step.why || '' })).filter((step) => step.lines.length);
}

// Song quiz: the pack's questions, with the line each one can replay.
export function lessonQuiz(timeline, lesson, when = '') {
  const sung = sungLines(timeline);
  return (lesson?.quiz || []).filter((q) => !when || q.when === when).map((q) => ({ ...q, line: q.line ? sung[q.line - 1] || null : null }));
}

// Freeze dance: Map(word -> { text, emoji }).
export function lessonMoves(lesson) {
  return new Map((lesson?.moves || []).map((m) => [m.word, { text: m.text, emoji: m.emoji || '🕺' }]));
}

// Memory cards are read in an English voice: side b of a translated set stays silent.
export const readAloud = (set, side) => !set?.translated || side === 'a';

// The lyrics panel: Map(line index -> plain English), on every repeat.
export function plainLines(timeline, lesson) {
  const out = new Map();
  const sung = sungLines(timeline);
  for (const row of lesson?.lines || []) {
    const home = row.plain ? sung[row.line - 1] : null;
    if (!home) continue;
    const key = lineKey(home);
    for (const line of sung) if (lineKey(line) === key) out.set(line.index, row.plain);
  }
  return out;
}

// Levels and the sets of a game, easiest first.
export const packLevels = (items = []) => LEVELS.filter((level) => items.some((item) => item.level === level));
export const orderSets = (sets = []) => [...sets].sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
export const pickSet = (sets, level) => sets.find((set) => set.level === level) || sets[0];
export const setLabel = (set, emojiFallback = '🧠') => `${set.emoji || emojiFallback} ${set.level ? `${set.level}: ` : ''}${set.name}`;

// How much a pack adds to each game, for the activity tiles.
export function packCounts(lesson) {
  if (!lesson) return {};
  const inside = (sets, kids) => (sets || []).reduce((sum, set) => sum + set[kids].length, 0);
  const size = (list) => list?.length || 0;
  const gaps = inside(lesson.gapSets, 'gaps');
  return {
    karaoke: size(lesson.popups), echo: size(lesson.echo), gapfill: gaps, choose: gaps, wrongword: size(lesson.swaps), finish: size(lesson.stops),
    hotmic: size(lesson.cards), freeze: size(lesson.moves), rhyme: inside(lesson.pairs, 'pairs'), hunt: inside(lesson.hunts, 'targets'), speak: size(lesson.say), quiz: size(lesson.quiz),
  };
}

// How many items of a section still match the lyrics, for the review list.
export function staleCount(timeline, lesson) {
  const lost = (items) => (items || []).filter((item) => item.words && !spots(timeline, item).length).length;
  return lost(lesson?.popups) + lost(lesson?.swaps) + lost(lesson?.stops) + lost(lesson?.say)
    + (lesson?.hunts || []).reduce((n, s) => n + lost(s.targets), 0)
    + (lesson?.gapSets || []).reduce((n, s) => n + lost(s.gaps), 0);
}
