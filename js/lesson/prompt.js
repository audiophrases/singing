/*
 * The prompt a teacher copies into an external AI (ChatGPT, Claude, Gemini...).
 * It holds the class, the lyrics, a digest of the melody and the JSON format
 * that js/lesson/pack.js reads back.
 *
 * The melody comes from the song's UltraStar file (or the band's score), but
 * the AI gets measured facts rather than the raw file. An UltraStar row is
 * ": 1204 4 7 chan": a beat number and pitch that need #BPM and #GAP arithmetic
 * before they mean anything, and that is where a language model goes wrong.
 * So the app does the arithmetic and the AI does the teaching.
 */
import { GAMES, gameFits } from '../games/index.js';
import { midiToName } from '../music/notes.js';
import { sungLines } from '../music/timeline.js';
import { lineSyllables } from '../lyrics/syllables.js';
import { normWord } from '../lyrics/text.js';
import { CARD_KINDS, CHANT_MOODS, LEVELS, PACK_FORMAT, PACK_VERSION, POPUP_KINDS } from './pack.js';

export const AGES = {
  kids: 'young learners (6 to 11): concrete, playful, nothing romantic',
  teens: 'teenagers (12 to 17): real opinions, humour, no childish tasks',
  adults: 'adults: mature topics are fine, respect their experience',
};

// How much to ask for. A long reply can be cut off on a free AI plan.
export const AMOUNTS = {
  light: { label: 'Light (short reply)', words: 6, popups: 6, hunts: 1, gapSets: 1, gaps: 8, swaps: 5, stops: 4, quiz: 6, cards: 8, pairs: 1, moves: 4, say: 3, echo: 3 },
  standard: { label: 'Standard', words: 10, popups: 12, hunts: 2, gapSets: 2, gaps: 10, swaps: 8, stops: 6, quiz: 10, cards: 14, pairs: 2, moves: 6, say: 5, echo: 5 },
  rich: { label: 'Rich (long reply)', words: 16, popups: 20, hunts: 3, gapSets: 3, gaps: 14, swaps: 12, stops: 8, quiz: 16, cards: 22, pairs: 3, moves: 8, say: 8, echo: 8 },
};

export const CLASS_DEFAULTS = { level: '', age: 'teens', language: '', focus: '', minutes: 45, amount: 'standard', melody: true };

// The model answer in the prompt, for a four-line song made up for the purpose.
// The test suite imports this into that song, so it always matches the reader.
export const EXAMPLE_LYRICS = ['We have been walking by the river', 'Gonna find a place to stay', 'If the rain comes down tomorrow', 'We will be dancing anyway'];
export const PACK_EXAMPLE = {
  format: PACK_FORMAT,
  version: PACK_VERSION,
  song: { title: 'River Road', lines: 4 },
  profile: {
    level: 'B1',
    grammar: ['First conditional', 'Present perfect continuous'],
    themes: ['Travel', 'Optimism'],
    vocab: ['anyway', 'place to stay'],
    summary: 'Two friends keep walking and stay happy, whatever the weather.',
  },
  teacher: {
    levelWhy: 'Short clauses and everyday words, but the conditional and continuous forms need B1.',
    notes: 'Good for the first conditional because the frame is short and easy to sing. L2 drops its subject, which is normal in songs but not in writing.',
    cautions: [{ line: 2, words: 'Gonna', severity: 'mild', note: 'Accept "going to" in writing.' }],
    path: [
      { stage: 'before', activity: 'quiz', when: 'before', minutes: 5, do: 'Teams predict the story from the title.' },
      { stage: 'while', activity: 'gapfill', set: 'if-clauses', minutes: 10, do: 'Play it once, then again for the gaps.' },
      { stage: 'after', activity: 'hotmic', minutes: 15, do: 'Students answer about their own plans.' },
    ],
  },
  lines: [{ line: 1, emoji: '🌊', translation: 'A natural translation, only when the class language is given', plain: 'We started walking a while ago and we are still walking.' }],
  words: [{ word: 'anyway', meaning: 'even so, it does not matter', translation: 'the word in the class language', emoji: '🤷', example: 'It was cold, but we went out anyway.', ipa: '/ˈeniweɪ/' }],
  popups: [{ line: 2, words: 'Gonna', kind: 'song-english', text: 'Gonna = going to. Say it in songs and chats, not in essays.' }],
  hunts: [{ id: 'future-after-if', name: 'Talking about tomorrow', emoji: '🔮', rule: 'Find the words that point to the future.', targets: [{ line: 4, words: 'will be', why: 'will + be: the result of the if-clause' }] }],
  gapSets: [{ id: 'if-clauses', name: 'If-clauses', emoji: '🌧️', tier: 'core', rule: 'After "if" we use the present, even for the future.', gaps: [{ line: 3, words: 'comes', options: ['will come', 'came'], why: 'After if, use the present: if the rain comes.' }] }],
  swaps: [{ line: 1, words: 'river', wrong: 'liver', why: 'R and L sound alike to many learners.' }],
  stops: [{ line: 4, words: 'dancing', ask: 'If it rains, what do you think they will do?' }],
  quiz: [
    { when: 'before', q: 'A song is called "River Road". What do you expect?', answer: 'A journey', wrong: ['A wedding', 'A football match'], explain: 'Roads and rivers suggest travel.' },
    { when: 'after', q: 'What will they do if it rains?', answer: 'Keep dancing', wrong: ['Go home', 'Find a roof'], line: 4, explain: '"Anyway" tells us the rain changes nothing.' },
  ],
  cards: [{ kind: 'personal', emoji: '☔', title: 'Your rainy day', body: 'If it rains tomorrow, what will you do? Answer with "If it rains, I will..."', answer: 'If it rains, I will stay at home and read.' }],
  pairs: [{ id: 'chunks', name: 'Word and meaning', emoji: '🃏', pairs: [{ a: 'anyway', b: 'even so' }, { a: 'a place to stay', b: 'somewhere to sleep' }, { a: 'tomorrow', b: 'the day after today' }] }],
  moves: [{ word: 'walking', text: 'Walk on the spot!', emoji: '🚶' }],
  say: [{ line: 2, words: 'Gonna find', skill: 'linking', tip: 'Run them together: gonna-find. Keep the vowel in "-na" very short.' }],
  echo: [{ from: 3, to: 4, why: 'Slow, and the key grammar is here.' }, { from: 1, to: 2, why: 'Faster, so teach it second.' }],
  chant: { title: 'If It Rains', mood: 'folk', text: 'If it rains, I will stay in bed,\nIf it snows, I will ride my sled.\n\nIf you call, I will come and play,\nIf you sing, I will sing all day!', teaches: 'First conditional' },
};

// What a general AI gets wrong about a class language. Left to itself it treats
// Catalan speakers as Spanish speakers, whose problem sounds are different.
const LANGUAGE_NOTES = [[/catal|valenci/i, 'Catalan is not Spanish, so do not reuse lists of Spanish-speaker mistakes. These students usually speak Spanish too, so Spanish interference can appear, but write every translation in correct standard Catalan, never in Spanish. Catalan has /ʃ/, /ʒ/, /dʒ/, /z/ and, in most of Catalonia, schwa, so these are not the weak points they are for Spanish speakers, and schwa is a bridge to English weak forms. The real problems: final consonants lose their voice (bed sounds like bet, made like mate); b and v are one sound in most of Catalonia (very, berry); there is no vowel length contrast and no /ɪ/, /æ/ or /ʌ/ (ship and sheep, cat and cut). The everyday past is vaig + infinitive (vaig anar), so learners may keep the base form or overuse did. The perfect is used for things that happened today (avui he anat), and this carries into English. False friends include parents (relatives), sensible (sensitive), llarg (long), actualment (currently), assistir (attend) and constipat (having a cold).']];

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
- Start "echo" with the slow, repeated lines with a narrow range. Leave the big jumps and fast lines for last.`;
}

function activityList(song, timeline) {
  const count = sungLines(timeline).length;
  return [...GAMES.filter((g) => gameFits(g, song, count)).map((g) => `${g.id} (${g.name})`), 'worksheet (printed sheet from this pack)', 'chant (the Song maker, with your chant)'].join(', ');
}

function classBlock(klass) {
  const row = (label, value) => `- ${label}: ${value}`;
  const note = LANGUAGE_NOTES.find(([name]) => name.test(klass.language))?.[1];
  return [
    row('Level', klass.level ? `${klass.level} (CEFR)` : 'not given. Decide which CEFR level this song suits, then design for that level'),
    row('Age', AGES[klass.age] || AGES.teens),
    row('First language', klass.language
      ? `${klass.language}. Use this: false friends, typical ${klass.language}-speaker mistakes and sounds that do not exist in ${klass.language} should shape your wrong answers and pronunciation tips`
      : 'not given. Leave out every "translation" field'),
    note ? row(`About ${klass.language}`, note) : '',
    row('The teacher wants to work on', klass.focus || 'nothing in particular, so choose what this song teaches best'),
    row('Time', `${klass.minutes} minutes. One screen on a projector, the whole class together, usually in teams`),
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

export function buildPrompt(song, timeline, options = {}) {
  const klass = { ...CLASS_DEFAULTS, ...options };
  const n = AMOUNTS[klass.amount] || AMOUNTS.standard;
  const sung = sungLines(timeline);
  const pictures = sung.some((l) => l.pic);
  const translated = !!klass.language;
  const example = JSON.parse(JSON.stringify(PACK_EXAMPLE));
  if (!translated) {
    for (const row of [...example.lines, ...example.words]) delete row.translation;
  }
  const blocks = [
    `You are an experienced ESL/EFL teacher, materials writer and singing coach. Design a complete lesson pack for the song below.

Your reply will be imported by Singing, a classroom app that teaches English through songs. It turns your JSON into games on a projector, so everything you write ends up in front of real students.

Reply with one JSON object and nothing else: no introduction, no notes, no Markdown code fences.`,
    `# The class\n${classBlock(klass)}`,
    `# The song\n${songBlock(song)}`,
    `# The lyrics
Every sung line has a number. "= L5" means the line repeats L5 word for word, so refer to L5: the app applies your work to every repeat.${sung.some((l) => l.part) ? ' A name before a colon says who sings the line ("A:"). It is not part of the lyrics, so never quote it.' : ''}

${lyricsBlock(timeline)}`,
    timingBlock(song, timeline, klass),
    `# Think first (do not write this part down)
1. What is the song really about? Is it a story, a plea, a list, a conversation? Which metaphors would a learner take literally?
2. Profile the language line by line: tenses and aspect, modals, conditionals, clause types, phrasal verbs, collocations, idioms, fixed chunks, repeated frames.
3. Decide what this song is truly good for: the one to three points that occur often enough, in clear enough contexts, for this class. Prefer language in the chorus, because repetition is free drilling. Do not build on a point that appears only once. If the teacher named a focus the song cannot support, say so in teacher.notes and offer the nearest thing it can.
4. Find the "song English": places where the lyrics bend the rules (ain't, double negatives, dropped subjects, "me and you was", "gonna"). Learners who copy these get marked wrong, so point them out without shaming the song.
5. Check the content: anything about sex, drugs, alcohol, violence, self-harm or religion that a teacher should see before pressing play. Do not build activities on a line with a serious caution.`,
    `# What to write
Each section feeds a real game or screen. Aim for the amount shown. A shorter section is better than a forced item, and an empty list is fine.

"song": the title and the number of sung lines (${sung.length}), so the app can catch a pack pasted on the wrong song.

"profile": goes on the song's page. level is one of ${LEVELS.join(', ')}. grammar and themes are short labels. vocab is up to 16 key words or chunks. summary is one or two plain sentences that students can read.

"teacher": only teachers see this. levelWhy says why you chose the level. notes are 3 to 5 sentences on what the song is good for and what to watch. cautions are the content warnings: severity is mild or serious, and words may be left out when the whole line is the problem. path is a lesson plan of 3 to 7 steps that fits the time: stage is before, while or after; activity is one of the ids below; minutes; do is what the teacher does. For hunt, gapfill, choose or rhyme, set names one of your sets; for quiz, when can be before or after.
Activity ids: ${activityList(song, timeline)}.

"lines": one entry for each different line, in order.${pictures ? ' The song has pictures already, so leave out emoji.' : ' emoji is a picture for the line, shown huge while it is sung.'}${translated ? ` translation is natural ${klass.language}, not word for word.` : ''} plain says the line in simple English, and matters most for metaphors.

"words" (about ${n.words}): the words and chunks worth learning, not only single words. meaning is simple English below the class level.${translated ? ' translation is the word in the class language.' : ''} example is a new sentence, not from the song. ipa is the pronunciation. Shown as cards on the song's page.

"popups" (about ${n.popups}): notes that appear during Karaoke beside the highlighted words, while the line is sung. Students have seconds, so stay under 90 characters. kind is one of ${Object.keys(POPUP_KINDS).join(', ')}.

"hunts" (about ${n.hunts}): for Grammar hunt. All the lyrics are on screen and teams click every word that counts. You can judge each word in context, which the app's word lists cannot: "left" only when it is a verb, "would" only when it is about the past. rule is the instruction on screen. Quote only the words that really count, in every line where they occur. why is shown when a word is found.

"gapSets" (about ${n.gapSets} sets of about ${n.gaps} gaps): for Fill the gaps, Choose the word and the worksheet. Each set trains one thing. words is one word per gap. options are 2 wrong answers that show a real mistake learners make, not random words. why explains the right answer in one sentence. tier is support, core or stretch: when you write several sets, make them different levels of challenge for mixed classes.

"swaps" (about ${n.swaps}): for Wrong word. The lyrics appear with one word replaced, and students click it while they listen. Use at most one on a line. words is the real word and wrong replaces it. Use mishearings learners really make: minimal pairs, sounds their first language lacks, words that fit the sentence. why is the contrast.

"stops" (about ${n.stops}): pause and predict, for Finish the line. Use at most one on a line. The music stops just before words, which is hidden with the rest of the line, and ask appears on screen. Then the song itself gives the answer. Ask about meaning or grammar, not memory, for example "Which tense comes after if?" or "What do you think she does next?".

"quiz" (about ${n.quiz}): for Song quiz. when "before" questions come before the first listen and predict or activate knowledge, so they must not need the song. when "after" questions check understanding and inference. answer is the right answer and wrong holds 2 or 3 wrong ones of the same style and length. line is the line that holds the answer: a Listen button replays exactly that line. explain appears after answering.

"cards" (about ${n.cards}): for Hot mic. The class passes an object while the music plays; whoever holds it when the music stops gets a card on the projector. kind is one of ${CARD_KINDS.join(', ')}. Cards must make students produce language about their own lives, not recall the song. Use the song's frames ("If it rains, I will..."). answer is an optional model answer. Keep body under 140 characters.

"pairs" (about ${n.pairs}): memory card sets, at least 3 pairs each and up to 12. Ideas: word and meaning, phrasal verb and synonym, base and past form, English and the first language, two halves of a collocation, real rhymes that do not look alike. Keep each side under 40 characters.${translated ? ' When one side is in the first language, put the English in "a" and add "translated": true to the set: the cards are read aloud in an English voice, and this keeps the other side silent.' : ''}

"moves" (about ${n.moves}): gestures for Freeze dance, a form of total physical response. When word is sung, text and emoji fill the screen and the class does the move. word is one word from the lyrics. Find clever gestures for abstract words too. text is a short command.

"say" (about ${n.say}): for Say it!, where speech recognition checks each word. Choose the lines worth saying aloud. words is the part to focus on. skill names the point (vowel, linking, weak form, word stress, sentence stress, final consonant). tip tells the student exactly what to do with their mouth.

"echo" (about ${n.echo}): the order to teach the song in Echo, as steps of 1 to 4 lines side by side: from and to are line numbers. Start with what is easiest and most useful, usually the chorus hook, not line 1. why is one short reason.

"chant": a brand-new chant that drills the same language point, which Singing's Song maker will set to music. It gives the class a version they can slow down, change and share. It must be completely original: no lines or phrases from the song. title; mood is one of ${CHANT_MOODS.join(', ')}; text has 6 to 12 lines of 4 to 12 syllables each, with a blank line (\\n\\n) between verses; teaches names the language point.`,
    `# The JSON format
Copy this shape exactly. The example is for a different song (${EXAMPLE_LYRICS.map((l, i) => `L${i + 1} "${l}"`).join(', ')}): use its keys, never its content.

${JSON.stringify(example, null, 1)}`,
    `# Rules the app enforces
1. Lyric references: "line" is a number from the lyrics above, and "words" is copied exactly from that line, in the same order, inside one line. Do not correct, shorten or translate it. Anything that does not match is thrown out.
2. Text for students is simple English at or below the class level, unless a field asks for the first language.
3. Do not state facts you are unsure of. Leave out a cultural note rather than guess.
4. Quote the lyrics only in "words" and in short fragments that a question needs.
5. Output valid JSON: double quotes, no comments, no trailing commas, and finish the whole object even if it is long.`,
  ];
  return blocks.filter(Boolean).join('\n\n');
}

// The message to send back to the AI when its reply needs fixing.
export function repairPrompt({ problems = [], fatal = '', cut = false } = {}) {
  if (cut) return 'Your reply was cut off before the end of the JSON. Send the complete JSON object again, from the first brace to the last, with shorter text in the fields, and nothing around it.';
  const list = [...(fatal ? [fatal] : []), ...problems].map((p) => `- ${p}`).join('\n');
  return `The Singing app could not use parts of your JSON:\n${list}\n\nRemember that "line" must be a number from the lyrics and "words" must be copied exactly from that line. Fix these items, keep everything else as it was, and send the complete JSON object again with nothing around it.`;
}
