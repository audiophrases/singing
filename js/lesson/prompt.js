/*
 * The prompt a teacher copies into an external AI (ChatGPT, Claude, Gemini...).
 * It holds the class, the lyrics, a digest of the melody and the JSON format
 * that js/lesson/pack.js reads back. The AI adds depth to Singing's games; it
 * does not plan lessons.
 *
 * A chatbot works in batches of a size the teacher sets, as PinPlay's quizzes
 * do: one prompt with the whole plan, one JSON object per reply, and each next
 * batch when the teacher asks for it. Asked for everything in one reply, it
 * spreads itself thin: 16 questions asked for came back as 4. An agent (PinPlay's
 * other choice) has no reply to fill: it does the whole job in one run, goes
 * deeper and checks its own work, and leaves a file to import.
 *
 * The melody comes from the song's UltraStar file (or the band's score), but
 * the AI gets measured facts rather than the raw file. An UltraStar row is
 * ": 1204 4 7 chan": a beat number and pitch that need #BPM and #GAP arithmetic
 * before they mean anything, and that is where a language model goes wrong.
 * So the app does the arithmetic and the AI does the teaching.
 */
import { midiToName } from '../music/notes.js';
import { sungLines } from '../music/timeline.js';
import { lineSyllables } from '../lyrics/syllables.js';
import { normWord } from '../lyrics/text.js';
import { CARD_KINDS, CHANT_MOODS, LEVELS, PACK_FORMAT, PACK_VERSION, POPUP_KINDS } from './pack.js';
import { findFalseFriends } from './false-friends.js';

export const AGES = {
  kids: 'young learners (6 to 11): concrete, playful, nothing romantic',
  teens: 'teenagers (12 to 17): real opinions, humour, no childish tasks',
  adults: 'adults: mature topics are fine, respect their experience',
};

// PinPlay's limit too: the most one AI reply is asked to hold.
export const BATCH_SIZE = { usual: 20, least: 3, most: 60 };

export const AI_KINDS = { chatbot: '💬 AI chatbot', agent: '🦾 AI agent (one run, one file)' };

export const CLASS_DEFAULTS = { level: '', age: 'teens', language: '', focus: '', ai: 'chatbot', batchSize: BATCH_SIZE.usual, melody: true };

// The model answer in the prompt, for a four-line song made up for the purpose.
// The test suite imports this into that song, so it always matches the reader.
export const EXAMPLE_LYRICS = ['We have been walking by the river', 'Gonna find a damn place to stay', 'If the rain comes down tomorrow', 'We will be dancing anyway'];
export const PACK_EXAMPLE = {
  format: PACK_FORMAT,
  version: PACK_VERSION,
  batch: 1,
  song: { title: 'River Road', lines: 4 },
  profile: {
    level: 'B1',
    grammar: ['First conditional', 'Present perfect continuous'],
    themes: ['Travel', 'Optimism'],
    vocab: ['anyway', 'place to stay'],
    summary: 'Two friends keep walking and stay happy, whatever the weather.',
  },
  teacher: {
    levelWhy: 'The story is literal and the words are everyday, but the conditional and continuous forms need B1.',
    notes: 'Good for the first conditional because the frame is short and easy to sing. L2 drops its subject, which is normal in songs but not in writing.',
    cautions: [{ line: 2, words: 'Gonna', severity: 'mild', note: 'Accept "going to" in writing.' }],
  },
  clean: [{ words: 'damn', why: 'Mild swearing.' }],
  lines: [{ line: 1, emoji: '🌊', translation: 'A natural translation, only when the class language is given', plain: 'We started walking a while ago and we are still walking.' }],
  words: [{ word: 'anyway', meaning: 'even so, it does not matter', translation: 'the word in the class language', emoji: '🤷', example: 'It was cold, but we went out anyway.', ipa: '/ˈeniweɪ/' }],
  popups: [{ line: 2, words: 'Gonna', kind: 'song-english', text: 'Gonna = going to. Say it in songs and chats, not in essays.' }],
  gapSets: [{ id: 'if-clauses', name: 'If-clauses', emoji: '🌧️', level: 'B1', rule: 'After "if" we use the present, even for the future.', gaps: [{ line: 3, words: 'comes', options: ['will come', 'came'], why: 'After if, use the present: if the rain comes.' }] }],
  swaps: [{ line: 1, words: 'river', wrong: 'liver', why: '/r/ and /l/: the tongue touches the mouth only for /l/.' }],
  stops: [{ line: 4, words: 'dancing', ask: 'If it rains, what do you think they will do?' }],
  hunts: [{ id: 'future-after-if', name: 'Talking about tomorrow', emoji: '🔮', level: 'B1', rule: 'Find the words that point to the future.', skip: [], targets: [{ line: 4, words: 'will be', why: 'will + be: the result of the if-clause' }] }],
  quiz: [
    { when: 'before', level: 'A2', q: 'A song is called "River Road". What do you expect?', answer: 'A journey', wrong: ['A wedding', 'A football match'], explain: 'Roads and rivers suggest travel.' },
    { when: 'after', level: 'B1', q: 'What will they do if it rains?', answer: 'Keep dancing', wrong: ['Go home', 'Find a roof'], line: 4, explain: '"Anyway" tells us the rain changes nothing.' },
  ],
  cards: [{ kind: 'personal', level: 'B1', emoji: '☔', title: 'Your rainy day', body: 'If it rains tomorrow, what will you do? Answer with "If it rains, I will..."', answer: 'If it rains, I will stay at home and read.' }],
  pairs: [
    { id: 'chunks', name: 'Word and meaning', emoji: '🃏', level: 'A2', pairs: [{ a: 'anyway', b: 'even so' }, { a: 'a place to stay', b: 'somewhere to sleep' }, { a: 'tomorrow', b: 'the day after today' }] },
    { id: 'first-language', name: 'English and first language', emoji: '🌍', level: 'A2', translated: true, pairs: [{ a: 'river', b: 'in the class language' }, { a: 'rain', b: 'in the class language' }, { a: 'tomorrow', b: 'in the class language' }] },
  ],
  moves: [{ word: 'walking', text: 'Walk on the spot!', emoji: '🚶' }],
  say: [{ line: 2, words: 'Gonna find', skill: 'linking', tip: 'Run them together: gonna-find. Keep the vowel in "-na" very short.' }],
  echo: [{ from: 3, to: 4, why: 'Slow, and the key grammar is here.' }, { from: 1, to: 2, why: 'Faster, so teach it second.' }],
  chant: { title: 'If It Rains', mood: 'folk', text: 'If it rains, I will stay in bed,\nIf it snows, I will ride my sled.\n\nIf you call, I will come and play,\nIf you sing, I will sing all day!', teaches: 'First conditional' },
};

// What a general AI gets wrong about a class language. Left to itself it treats
// Catalan speakers as Spanish speakers, whose problem sounds are different.
const LANGUAGE_NOTES = [[/catal|valenci/i, 'Catalan is not Spanish, so do not reuse lists of Spanish-speaker mistakes. These students usually speak Spanish too, so Spanish interference can appear, but write every translation in correct standard Catalan, never in Spanish and with no Castilianisms. Catalan has /ʃ/, /ʒ/, /dʒ/, /z/ and, in most of Catalonia, schwa, so these are not the weak points they are for Spanish speakers, and schwa is a bridge to English weak forms. The real problems: final consonants lose their voice (bed sounds like bet, made like mate); b and v are one sound in most of Catalonia (very, berry); there is no vowel length contrast and no /ɪ/, /æ/ or /ʌ/ (ship and sheep, cat and cut). The everyday past is vaig + infinitive (vaig anar), so learners may keep the base form or overuse did. The perfect is used for things that happened today (avui he anat), and this carries into English. False friends include parents (relatives), sensible (sensitive), llarg (long), actualment (currently), assistir (attend) and constipat (having a cold).']];

const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const secs = (x) => x.toFixed(1).replace(/^0/, '');
const lineKey = (l) => l.words.map((w) => normWord(w.text)).join(' ');
const bare = (text) => String(text).replace(/^[^\p{L}\p{N}'’]+|[^\p{L}\p{N}'’]+$/gu, '');

export const hasMelody = (timeline) => sungLines(timeline).some((l) => l.syllables.some((s) => Number.isFinite(s.midi)));
const hasTiming = (song) => !song.source || song.source === 'band' || (song.synced || []).some((l) => Number.isFinite(l.start));

function syllableCount(line, melody) {
  return melody ? line.syllables.length : lineSyllables(line.text).length;
}

function speed(line, melody) {
  return syllableCount(line, melody) / Math.max(0.2, line.singEnd - line.singStart);
}

// "chan(D4 .4)" with whatever else there is to say about the syllable.
function syllableText(s) {
  const seconds = s.end - s.start;
  const notes = [Number.isFinite(s.midi) ? midiToName(s.midi) : 'spoken', secs(seconds)];
  if (seconds >= 0.9) notes.push('LONG');
  if (s.golden) notes.push('GOLD');
  if (s.run > 1) notes.push(`~${s.run}`);
  return `${bare(s.text)}(${notes.join(' ')})`;
}

function melodyRow(line) {
  let out = '';
  let previous = null;
  line.words.forEach((word, wi) => {
    word.syllables.forEach((s, si) => {
      const rest = previous && s.start - previous.end >= 0.3 ? ' |' : '';
      out += `${rest}${si ? '-' : wi ? ' ' : ''}${syllableText(s)}`;
      previous = s;
    });
  });
  return out;
}

function pitchRange(syllables) {
  const pitches = syllables.map((s) => s.midi).filter(Number.isFinite);
  return pitches.length ? { low: Math.min(...pitches), high: Math.max(...pitches) } : null;
}

// The first time each different line is sung, with how often it comes.
function distinctLines(timeline) {
  const seen = new Map();
  sungLines(timeline).forEach((line, i) => {
    const key = lineKey(line);
    if (seen.has(key)) seen.get(key).count += 1;
    else seen.set(key, { line, number: i + 1, count: 1 });
  });
  return [...seen.values()];
}

// The facts worth reading first: nobody should have to work these out by hand.
export function melodyFacts(timeline) {
  const melody = hasMelody(timeline);
  const lines = distinctLines(timeline);
  const sung = sungLines(timeline);
  const facts = [`${sung.length} sung lines, ${lines.length} of them different, in ${clock(timeline.duration)}.`];
  const repeated = lines.filter((x) => x.count > 1).sort((a, b) => b.count - a.count).slice(0, 6);
  if (repeated.length) facts.push(`Most repeated (free drilling): ${repeated.map((x) => `L${x.number} ×${x.count}`).join(', ')}.`);
  const timed = lines.filter((x) => x.line.words.length >= 2).map((x) => ({ ...x, rate: speed(x.line, melody) })).sort((a, b) => b.rate - a.rate);
  const rates = (list) => list.map((x) => `L${x.number} ${x.rate.toFixed(1)}`).join(', ');
  if (timed.length >= 2) {
    const n = Math.min(4, Math.floor(timed.length / 2));
    facts.push(`Fastest lines (syllables per second): ${rates(timed.slice(0, n))}.`);
    facts.push(`Slowest lines: ${rates(timed.slice(-n).reverse())}.`);
  }
  if (!melody) return facts;
  const range = pitchRange(sung.flatMap((l) => l.syllables));
  if (range) facts.push(`Whole song: ${midiToName(range.low)} to ${midiToName(range.high)} (${range.high - range.low} semitones).`);
  const held = [...new Map(lines.flatMap((x) => x.line.syllables.map((s) => ({ s, number: x.number, text: bare(s.text) })))
    .filter((x) => x.s.end - x.s.start >= 0.9).sort((a, b) => (b.s.end - b.s.start) - (a.s.end - a.s.start))
    .map((x) => [`${x.text} ${x.number}`, x])).values()].slice(0, 6);
  if (held.length) facts.push(`Longest held syllables: ${held.map((x) => `"${x.text}" in L${x.number}, ${secs(x.s.end - x.s.start)} s`).join('; ')}.`);
  const leaps = lines.flatMap((x) => {
    const pitched = x.line.syllables.filter((s) => Number.isFinite(s.midi));
    return pitched.slice(1).map((s, i) => ({ size: Math.abs(s.midi - pitched[i].midi), from: bare(pitched[i].text), to: bare(s.text), number: x.number }));
  }).filter((x) => x.size >= 7).sort((a, b) => b.size - a.size).slice(0, 4);
  if (leaps.length) facts.push(`Biggest jumps: ${leaps.map((x) => `L${x.number} "${x.from}" to "${x.to}", ${x.size} semitones`).join('; ')}.`);
  return facts;
}

function lyricsBlock(timeline) {
  const rows = [];
  const first = new Map();
  sungLines(timeline).forEach((line, i) => {
    if (line.sectionStart && line.section) rows.push(`[${line.section}]`);
    const key = lineKey(line);
    const part = line.part ? `${line.part}: ` : '';
    if (first.has(key)) rows.push(`L${i + 1} = L${first.get(key)}`);
    else {
      first.set(key, i + 1);
      rows.push(`L${i + 1} ${part}${line.text}`);
    }
  });
  return rows.join('\n');
}

function timingBlock(song, timeline, klass) {
  const melody = hasMelody(timeline);
  if (!klass.melody || !hasTiming(song)) return '';
  const lines = distinctLines(timeline);
  const facts = melodyFacts(timeline).map((f) => `- ${f}`).join('\n');
  if (!melody) {
    return `# Timing
This song is timed by line only: the times inside a line are estimates. So place "stops" near the end of a line.

${facts}

${lines.map((x) => `L${x.number} ${clock(x.line.start)}, ${secs(x.line.singEnd - x.line.singStart)} s, about ${speed(x.line, false).toFixed(1)} syl/s`).join('\n')}`;
  }
  const source = !song.source || song.source === 'band' ? 'the score of the song' : 'the UltraStar file of the song';
  return `# The melody
Singing measured these facts from ${source}, syllable by syllable, so you do not need to calculate anything.

${facts}

How to read the rows below: each different line shows its start time, how long it is sung, its syllables per second and its lowest to highest note. Then comes every syllable as syllable(note seconds). "-" joins the syllables of a word, a space separates words, "|" marks a rest of 0.3 s or more. LONG is a note of 0.9 s or more. GOLD is a note the file marks as a highlight. ~3 means one syllable glides over 3 notes. "spoken" has no pitch.

${lines.map((x) => {
    const range = pitchRange(x.line.syllables);
    const head = `L${x.number} ${clock(x.line.start)}, ${secs(x.line.singEnd - x.line.singStart)} s, ${speed(x.line, true).toFixed(1)} syl/s${range ? `, ${midiToName(range.low)}-${midiToName(range.high)}` : ''}`;
    return `${head}\n  ${melodyRow(x.line)}`;
  }).join('\n')}

Use the melody as evidence for the singing and pronunciation work:
- A LONG note makes the class hold one vowel, so it is the best place for vowel work in "say". Say which vowel, and the common mistake.
- Fast lines (above about 4 syl/s) force contractions, weak forms and linking. These lines need a "say" tip or a "popups" note, and they should come late in "echo".
- Stress clash: when a long, high or GOLD note falls on a syllable that is weak in normal speech, warn in "say" that this stress belongs to the song, not to speech.
- A "|" rest is a natural chunk and a breath. Stopping just after a rest makes the best "stops", and chunks between rests are what to teach in "echo".
- Start "echo" with the slow, repeated lines with a narrow range. Leave the big jumps and fast lines for last.
- These rows are for you alone. Students read what you write in "say", "echo" and "popups", so say "the long note" or "the high note", and never write GOLD, syl/s, semitones, note names or seconds.`;
}

// The words of Singing's own false friends list that these lyrics sing.
export function lyricFalseFriends(timeline, language) {
  const lines = distinctLines(timeline).map((x) => ({ number: x.number, words: x.line.words.map((w) => bare(w.text)) }));
  return findFalseFriends(lines, language);
}

/*
 * Singing finds the false friends, so the AI cannot invent them. It only judges
 * them in their line, which a word list cannot, and writes the activities.
 */
function falseFriendsBlock(timeline, klass) {
  const found = lyricFalseFriends(timeline, klass.language);
  if (!found.length) return '';
  const language = klass.language;
  const rows = found.map((f) => `- ${f.spots.map((s) => `L${s.line} "${s.word}"`).join(', ')}: looks like ${language} "${f.looksLike}" (${f.looksLikeMeans}), but means: ${f.means}.`);
  const [first] = found;
  return `# False friends in these lyrics
Singing compared the lyrics with its own list of English words that look like a ${language} word with a different meaning, and found these:

${rows.join('\n')}

Do not look for other false friends, and do not add any: this is the whole list. Read each word in its line and keep it only if a student at these levels, thinking of the ${language} word, would really misunderstand that line. Leave it out if the line uses a meaning the two words share, if the word is too well known to fool anyone at these levels, if it is on the "clean" list, or if its line has a serious caution. Leaving them all out is fine.

For each word you keep, write these in the batch of each section, as part of its count:
- "words": a card for it. Its meaning warns about the look-alike.
- "popups": one with kind "false-friend" on that word, such as "${first.spots[0].word.toLowerCase()} = ${first.means.split(/[,;]/)[0]}, not ${first.looksLike}".
- "quiz": one question with when "after" and "line": what does the word mean in this line? The meaning of the look-alike is one of the wrong answers.
- "quiz": one question with when "after": a ${language} sentence that uses the look-alike, and which English sentence says the same thing. One wrong answer uses the false friend in correct English that means something else. For example, "Actualment visc a Girona." is "I currently live in Girona.", not "I actually live in Girona.".

If you keep any, also write one "hunts" set named "False friends". Its rule asks students to find the words that could fool a ${language} speaker, and each "why" gives the real meaning.

If you keep two or more, also write one "pairs" set with "translated": true and two pairs for each word: the false friend with its real ${language} meaning, and the English for the look-alike with the look-alike.

${language} is allowed in all of these, because they compare the two languages.`;
}

// The level, and the one on each side: what the activities are written for.
export function levelsAround(level) {
  const i = LEVELS.indexOf(level);
  return i < 0 ? [] : LEVELS.slice(Math.max(0, i - 1), i + 2);
}

function classBlock(klass) {
  const row = (label, value) => `- ${label}: ${value}`;
  const note = LANGUAGE_NOTES.find(([name]) => name.test(klass.language))?.[1];
  return [
    row('Levels', klass.level
      ? `this class is ${klass.level}, so write activities for ${levelsAround(klass.level).join(', ')} (CEFR)`
      : 'not given. You decide, as described in "Levels" below'),
    row('Age', AGES[klass.age] || AGES.teens),
    row('First language', klass.language
      ? `${klass.language}. Use this: false friends, typical ${klass.language}-speaker mistakes and sounds that do not exist in ${klass.language} should shape your wrong answers and pronunciation tips`
      : 'not given. Leave out every "translation" field'),
    note ? row(`About ${klass.language}`, note) : '',
  ].filter(Boolean).join('\n');
}

function songBlock(song) {
  const known = [
    song.level && `level ${song.level}`,
    song.grammar?.length && `grammar: ${song.grammar.join(', ')}`,
    song.themes?.length && `themes: ${song.themes.join(', ')}`,
    song.vocab?.length && `key words: ${song.vocab.join(', ')}`,
  ].filter(Boolean);
  return `Title: ${song.title}${song.artist ? `\nArtist: ${song.artist}` : ''}${known.length ? `\nTags already in the app (they may be wrong, so check them): ${known.join('; ')}` : ''}`;
}

// All the work, one list for each family of games. A "whole" part is never cut
// in two. An agent has no reply to fill, so it is asked to go deeper.
function workPlan(levels, agent) {
  const each = (make) => levels.flatMap(make);
  const sets = (name, kids, size) => each((level) => (agent ? [1, 2] : [1]).map(() => ({ what: `one "${name}" set of ${size} ${kids} for ${level}`, n: size, whole: true })));
  return [
    [{ what: '"words"', n: agent ? 24 : 16 }, { what: '"popups"', n: agent ? 40 : 20 }],
    [...sets('gapSets', 'gaps', agent ? 12 : 10), { what: '"swaps"', n: agent ? 14 : 12 }, { what: '"stops"', n: agent ? 12 : 8 }],
    [...sets('hunts', 'targets', agent ? 12 : 10), { what: '"quiz" questions with when "before"', n: agent ? 6 : 4 },
      ...each((level) => ({ what: `"quiz" questions with when "after" for ${level}`, n: agent ? 15 : 8 }))],
    [...each((level) => ({ what: `"cards" for ${level}`, n: agent ? 12 : 10 })), { what: '"say"', n: agent ? 16 : 10 }, { what: '"echo" steps', n: agent ? 8 : 6 }, { what: '"moves"', n: agent ? 16 : 10 }],
    [...sets('pairs', 'pairs', agent ? 10 : 8), { what: 'the "chant"', n: 1, whole: true }],
  ];
}

const SONG_PART = '"song", "profile", "teacher", "clean" and "lines"';
const partText = (part, n = part.n) => (part.whole ? part.what : `${n} ${part.what}`);
const batchSizeOf = (size) => Math.max(BATCH_SIZE.least, Math.min(BATCH_SIZE.most, Math.round(Number(size)) || BATCH_SIZE.usual));

/*
 * The batches for a size: [{ parts: ['16 "words"', ...] }]. A batch holds one
 * family of games, because an AI thinks better about one kind of task at a
 * time, and at most size items, so a big family takes several. Batch 1 also has
 * the song itself. A set is never cut in two, so it can run over a small size.
 * An agent gets everything as one batch: it has no reply to fill.
 */
export function planBatches({ batchSize = BATCH_SIZE.usual, level = '', ai = 'chatbot' } = {}) {
  const agent = ai === 'agent';
  const levels = level ? levelsAround(level) : ['your lowest level', 'your middle level', 'your highest level'];
  const work = workPlan(levels, agent);
  if (agent) return [{ parts: [SONG_PART, ...work.flat().map((part) => partText(part))] }];
  const size = batchSizeOf(batchSize);
  const batches = [{ parts: [SONG_PART] }];
  let current = batches[0];
  let room = size;
  const open = () => { current = { parts: [] }; batches.push(current); room = size; };
  work.forEach((family, f) => {
    if (f) open();
    for (const part of family) {
      let left = part.n;
      while (left > 0) {
        if (room <= 0 || (part.whole && left > room && current.parts.length)) open();
        const take = part.whole ? left : Math.min(left, room);
        current.parts.push(partText(part, take));
        room -= take;
        left -= take;
      }
    }
  });
  return batches;
}

const batchLine = (batch, i) => `Batch ${i + 1}: ${batch.parts.join(', ')}.`;

export function buildPrompt(song, timeline, options = {}) {
  const klass = { ...CLASS_DEFAULTS, ...options };
  const agent = klass.ai === 'agent';
  const sung = sungLines(timeline);
  const pictures = sung.some((l) => l.pic);
  const translated = !!klass.language;
  const plan = planBatches(klass);
  const file = bare(song.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-') || 'song';
  const example = JSON.parse(JSON.stringify(PACK_EXAMPLE));
  if (!translated) {
    for (const row of [...example.lines, ...example.words]) delete row.translation;
    example.pairs = example.pairs.filter((set) => !set.translated);
  }
  if (agent) delete example.batch;
  const focus = klass.focus.trim();
  const blocks = [
    `# Singing song pack instructions

Singing is a classroom app that teaches English through songs. Its games already exist: Karaoke, Echo, Fill the gaps, Choose the word, Wrong word, Finish the line, Hot mic, Freeze dance, Rhyme memory, Grammar hunt, Say it! and Song quiz. Give them depth for the song below: study its lyrics, language and vocabulary, and write content tailored to them that the games cannot produce on their own. Do not plan a lesson or a timetable: teachers choose when and how to use each game.

${agent
    ? `You are working as an autonomous agent. Do the whole job in this one run: do not stop to ask anything, and take as long as it needs. Write the result to one file named "${file}-pack.json" (UTF-8), holding ONE JSON object with every section, and end by saying where the file is. If your tools force you to split it, name the files "${file}-part1.json", part2, part3...: the teacher can import them together.`
    : `The pack is too big for one reply, so it comes in ${plan.length} batches of at most ${batchSizeOf(klass.batchSize)} items, one family of games at a time (see "Batches"). Send batch 1 now and stop. Reply with ONE JSON object per batch and nothing else, no commentary. If you can create files, give each batch as a downloadable file named "${file}-part1.json" (part2, part3... for the next batches); otherwise put it in one \`\`\`json code block.`}`,
    focus ? `# The teacher's own words
Typed by the teacher, word for word, in quotes. Where they contradict anything after this section, the teacher's words win. Only the JSON format and field names stay fixed.
- What to work on: "${focus}"` : '',
    `# The class\n${classBlock(klass)}`,
    `# Levels
${klass.level
    ? `Rate the song itself in profile.level, however hard it is for this class. Then write activities for ${levelsAround(klass.level).join(', ')}, the class level and the level on each side of it.`
    : 'Rate the song in profile.level from two things: how abstract its meaning is (a literal story is easy; metaphor, irony and an unreliable narrator are hard) and how hard its vocabulary is. Simple grammar does not make a song easy. Then write activities for that level and the level on each side of it: a B1 song gets A2, B1 and B2.'}
The same lyrics can carry very different work: at the low level, finding and understanding; at the high level, register, implication and why the writer chose those words. This is a language class, not a literature class: at every level the language comes from these lyrics. At the high level go deeper into these words (nuance, register, collocation, word choice), not into literary theory or academic writing. Put "level" on every set in "gapSets", "hunts" and "pairs", and on every item in "quiz" and "cards".`,
    `# The song\n${songBlock(song)}`,
    `# The lyrics
Every sung line has a number. "= L5" means the line repeats L5 word for word, so refer to L5: the app applies your work to every repeat.${sung.some((l) => l.part) ? ' A name before a colon says who sings the line ("A:"). It is not part of the lyrics, so never quote it.' : ''}

${lyricsBlock(timeline)}`,
    timingBlock(song, timeline, klass),
    falseFriendsBlock(timeline, klass),
    `# Think first (do not write this part down)
1. What is the song really about? Is it a story, a plea, a list, a conversation? Which metaphors would a learner take literally?
2. Profile the language line by line: tenses and aspect, modals, conditionals, clause types, phrasal verbs, collocations, idioms, fixed chunks, repeated frames.
3. Decide what this song is truly good for at each level. Prefer language in the chorus, because repetition is free drilling. If the teacher asked for something the song cannot support, say so in teacher.notes and offer the nearest thing it can.
4. Find the "song English": places where the lyrics bend the rules (ain't, double negatives, dropped subjects, "me and you was", "gonna"). Learners who copy these get marked wrong, so point them out without shaming the song.
5. Check the content: anything about sex, drugs, alcohol, violence, self-harm or religion that a teacher should see before pressing play. Do not build activities on a line with a serious caution.`,
    `# What each section is for
All pronunciation in the pack is General American, whatever accent the singer has: "ipa", "say", "swaps" and sound notes in "popups". Use the same symbols throughout.

"song": the title and the number of sung lines (${sung.length}), so the app can catch a pack pasted on the wrong song.

"profile": goes on the song's page. level is one of ${LEVELS.join(', ')}. grammar and themes are short labels. vocab is up to 16 key words or chunks. summary is one or two plain sentences that students can read.

"teacher": only teachers see this. levelWhy says why you rated the song as you did. notes are 3 to 5 sentences on what the song is good for and what to watch. cautions are the content warnings: severity is mild or serious, and words may be left out when the whole line is the problem. Serious is for what a teacher may not want in class at all: strong swearing, explicit sex, drug use, heavy drinking, self-harm, graphic violence. A figurative, historical or story image of death, war or religion is mild, even when it sounds dark, such as a fallen king's head on a plate.

"clean": words a school would not want sung in class: swear words, slurs, explicit words. Quote each word once, and leave the list empty when there are none. If the teacher turns on the clean version, Singing takes the singer's voice off exactly those words and masks them on screen. Never use a clean word anywhere else in the pack: not in any other section, not in a translation, not in a question.

"lines": one entry for each different line, in order. Skip lines that are only sounds or a word or two (oh, ooh, yeah).${pictures ? ' The song has pictures already, so leave out emoji.' : ' emoji is a picture for the line, shown huge while it is sung.'}${translated ? ` translation is natural ${klass.language}, not word for word.` : ''} plain says the line in simple English, and matters most for metaphors.

"words": the words and chunks worth learning, not only single words. meaning is simple English.${translated ? ' translation is the word in the class language.' : ''} example is a new sentence, not from the song. ipa is the pronunciation. Shown as cards on the song's page.

"popups": notes that appear during Karaoke beside the highlighted words, while the line is sung. Students have seconds, so stay under 90 characters. kind is one of ${Object.keys(POPUP_KINDS).join(', ')}.

"gapSets": for Fill the gaps, Choose the word and the worksheet. The game plays the whole song and ends with it, so a set needs at least 8 gaps, spread from the first verse to the last. Each set trains one thing, but that can be broad: past verbs, the song's key words, collocations. If a narrow point cannot reach 8 gaps, widen it rather than send a short set, and write fewer sets if you need to. Sets must not repeat each other: a word can be a gap in only one set, and each level trains something different. Verb forms suit the low level. The high level tests word choice: the right word against similar words that do not fit this line, because of their meaning or what they go with. words is one word per gap. options are 2 wrong answers that show a real mistake learners make, not random words. Each option must be wrong in that sentence: never offer a form that is correct or acceptable, even informally or in formal English. why explains the right answer in one sentence, in simple words for that level, with no grammar terms those students would not know.

"swaps": for Wrong word. The lyrics appear with one word replaced, and students click it while they listen, so this is about sound only. Use at most one on a line. words is the real word and wrong replaces it. wrong must sound very close to the real word and be a mishearing these students really make: a minimal pair, where the two words differ in exactly one sound, and it is a sound these students really confuse. A word that only looks similar or means something similar does not count. why names the two sounds being confused. If you cannot name them, leave the swap out.

"stops": pause and predict, for Finish the line. Use at most one on a line. The music stops just before words, which is hidden with the rest of the line, and ask appears on screen. Then the song itself gives the answer. Ask about meaning or grammar, not memory, for example "Which tense comes after if?" or "What do you think she does next?".

"hunts": for Grammar hunt. All the lyrics are on screen, each different line once and without line numbers. Teams click one word at a time, and a wrong click loses a point. You can judge each word in context, which the app's word lists cannot: "left" only when it is a verb, "would" only when it is about the past. Choose points that need that judgement: finding every "a" and "the" does not. rule is what students read on screen: one short sentence, under 100 characters, in simple words for that level. It never mentions line numbers, repeats or how to click. Quote only the words that really count, in every line where they occur. Quote a word once per line: the app finds every time it is sung. why is shown when a word is found. skip lists the numbers of lines to leave out of the game, such as a line with a serious caution: they vanish from the screen, so the rule never needs to mention them.

"quiz": for Song quiz. when "before" questions come before the first listen and predict or activate knowledge, so they must not need the song. when "after" questions check understanding and inference. answer is the right answer and wrong holds 2 or 3 wrong ones of the same style and length. line is the line that holds the answer: a Listen button replays exactly that line. explain appears after answering.

"cards": for Hot mic. The class passes an object while the music plays; whoever holds it when the music stops gets a card on the projector. kind is one of ${CARD_KINDS.join(', ')}. Cards must make students produce language about their own lives, not recall the song. Write at least 8 for each level. Every card starts from this song, and most use a frame copied from its lyrics ("If it rains, I will..."): look through all the lyrics for sentence starts a student could finish about their own life. The rest take one of its themes. When a theme is too heavy to share in class, take a lighter angle on it, not an unrelated topic such as hobbies. Vary the situations, such as home, friends, school, memories and plans: at each level, no more than 2 cards may share one. Vary the themes too: use different themes of the song, not one idea on every card. Mix the kinds: each level uses at least 3 kinds, and no kind takes more than half its cards. Never open a card with a label such as "Trust:" or "Power:": write a natural question or task. Never write "you may pass" or "real or invented" on a card: teachers handle that. answer is an optional model answer. Keep body under 140 characters.

"pairs": memory card sets, at least 3 pairs each. Ideas: word and meaning, phrasal verb and synonym, base and past form, English and the first language, two halves of a collocation, real rhymes that do not look alike. At every level, one side of each pair comes from the lyrics: a word, chunk or form the song uses. New sentences and terms about language (inference, ambiguity) do not belong here. Keep each side under 40 characters.${translated ? ' In a set with the first language, "a" is the English side and the set has "translated": true: the cards are read aloud in an English voice, and this keeps the other side silent.' : ''}

"moves": gestures for Freeze dance, a form of total physical response. When word is sung, text and emoji fill the screen and the class does the move. word is one word from the lyrics. Find clever gestures for abstract words too. text is a short command.

"say": for Say it!, where speech recognition checks each word. Choose the lines worth saying aloud. words is the part to focus on. skill names the point (vowel, linking, weak form, word stress, sentence stress, final consonant). tip tells the student exactly what to do with their mouth.

"echo": the order to teach the song in Echo, as steps of 1 to 4 lines side by side: from and to are line numbers. Start with what is easiest and most useful, usually the chorus hook, not line 1. why is one short reason.

"chant": a brand-new chant that drills the same language point, which Singing's Song maker will set to music. It gives the class a version they can slow down, change and share. It must be completely original: no lines or phrases from the song. title; mood is one of ${CHANT_MOODS.join(', ')}; text has 8 to 12 lines of 4 to 12 syllables each, with a blank line (\\n\\n) between verses; teaches names the language point.`,
`${agent
    ? `# The work
Work through this list in order, one section at a time:
${plan[0].parts.map((part) => `- ${part}`).join('\n')}

These numbers are ceilings for a song with a lot in it, not quotas. Write what this song truly supports and stop there: a weak item is worse than a missing one. Only the gaps and the cards have a minimum, given in their sections, because a class cannot play them with less. Give every set its own "id". Keep the file under 300 KB.

Check every fact, name and pronunciation in a reliable source before you write it, and drop what you cannot check.

Before you finish, check the file. If you can run code, write a small script for this:
1. The file parses as JSON.
2. Every "words" is found in its numbered line, in the same order, ignoring case and punctuation.
3. "swaps" and "stops" have at most one item on a line.
4. No wrong answer equals the right one, and none is correct in that sentence.
5. No word from "clean" appears anywhere else in the file.
6. No section goes over the count above, nothing is there only to reach a number, every gap set has at least 8 gaps and every level has at least 8 cards.
7. Every hunt rule is one short sentence with no line numbers. Most cards use a frame copied from this song, none opens with a label, and at each level no more than 2 share a situation, at least 3 kinds are used and no kind takes more than half.
8. No word is a gap in two sets, and the high level's gaps test word choice, not verb form.
Then read the whole pack as the teacher would, cut anything you would not use in class, fix what the checks found, and only then finish.`
    : `# Batches
${plan.map(batchLine).join('\n')}

Every batch is one JSON object with "format", "version", "batch" (its number) and only the sections of that batch. Singing adds each batch to the pack, so never repeat an item from an earlier batch, and give every new set its own "id".

Before you send a batch, count its items against this plan. If you are short, write more. Stop short only when the lyrics truly cannot support more: a weak item is worse than a missing one.`}`,
    `# The JSON format
Copy this shape exactly. The example shows every section together, for a different song (${EXAMPLE_LYRICS.map((l, i) => `L${i + 1} "${l}"`).join(', ')}): use its keys, never its content${agent ? '.' : ', and send only the sections of the batch you are writing.'}

${JSON.stringify(example, null, 1)}`,
    `# Rules the app enforces
1. Lyric references: "line" is a number from the lyrics above, and "words" is copied exactly from that line, in the same order, inside one line. Do not correct, shorten or translate it. Anything that does not match is thrown out.
2. Text for students is simple English at or below the level of the activity, unless a field asks for the first language.
3. Do not state facts you are unsure of. Leave out a cultural note rather than guess.
4. Quote the lyrics only in "words" and in short fragments that a question needs.
5. Output valid JSON: double quotes, no comments, no trailing commas, and finish the whole object.`,
    // Said last as well: bots weigh the end of a prompt heavily.
    `Before you write: ${focus ? `re-read "The teacher's own words" at the top. Where they contradict these instructions, follow the teacher. ` : ''}${agent ? 'Start now, and finish the whole pack in this run.' : 'Send batch 1 now and stop.'}`,
  ];
  return blocks.filter(Boolean).join('\n\n');
}

// The message that asks for a batch of the plan.
export function nextBatchPrompt(plan, number) {
  const batch = plan[number - 1];
  if (!batch) return 'Thank you, that was the last batch.';
  return `Send batch ${number} of ${plan.length} now: ${batch.parts.join(', ')}. One JSON object with "batch": ${number} and only these sections. Follow the same rules, count the items before you send them, and do not repeat anything from an earlier batch.`;
}

// The message that asks for more of one section, whenever the teacher wants it.
export function morePrompt(section, level = '') {
  return `Write more for "${section}"${level ? ` at level ${level}` : ''}: at least 10 new items that do not repeat anything you have written. Send one JSON object with "format", "version" and only that section, under the same rules. New sets get their own "id". If the lyrics truly cannot support more, say so instead of padding.`;
}

// The message to send back to the AI when its reply needs fixing.
export function repairPrompt({ problems = [], fatal = '', cut = false } = {}) {
  if (cut) return 'Your reply was cut off before the end of the JSON. Send that batch again, from the first brace to the last, with shorter text in the fields, and nothing around it.';
  const list = [...(fatal ? [fatal] : []), ...problems].map((p) => `- ${p}`).join('\n');
  return `The Singing app could not use parts of your JSON:\n${list}\n\nRemember that "line" must be a number from the lyrics and "words" must be copied exactly from that line. Fix these items and send only them again in one JSON object, with nothing around it.`;
}
