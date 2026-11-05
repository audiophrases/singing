import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIVITY_IDS, CHANT_MOODS, LEVELS, POPUP_KINDS, quizRound, startLevel, addCleanWord, applyPack, cleanTimeline, readAloud, gapNotes, huntKey, huntSets, lessonEcho, lessonGaps, lessonMoves, lessonOf, lessonPopups, lessonQuiz, lessonSay, lessonStops, lessonSwaps, mergePacks, orderSets, packCounts, packLevels, pickSet, plainLines, readPack, removePack, setLabel, spots, staleCount } from '../js/lesson/pack.js';
import { AI_KINDS, BATCH_SIZE, EXAMPLE_LYRICS, PACK_EXAMPLE, buildPrompt, hasMelody, levelsAround, melodyFacts, morePrompt, nextBatchPrompt, planBatches, repairPrompt } from '../js/lesson/prompt.js';
import { gapMode, pickGaps } from '../js/lyrics/gaps.js';
import { packableSong } from '../js/share.js';
import { GAMES } from '../js/games/index.js';
import { MOODS } from '../js/music/composer.js';
import { STARTER_SONGS } from '../js/data/songs/index.js';
import { compileSong } from '../js/music/score.js';
import { timelineFromCompiled, timelineFromSynced } from '../js/music/timeline.js';
import { parseUltraStar } from '../js/media/timing.js';

const lyrics = (lines) => timelineFromSynced(lines.map((text, i) => ({ text, start: i * 4, end: i * 4 + 3 })), lines.length * 4);
const exampleTimeline = () => lyrics(EXAMPLE_LYRICS);
const band = (id) => {
  const song = STARTER_SONGS.find((s) => s.id === id);
  return { song, timeline: timelineFromCompiled(compileSong(song), song.bpm) };
};
const reply = (extra) => JSON.stringify({ format: 'singing-lesson-pack', version: 1, ...extra });

// At #BPM:60 a beat lasts .25 s, so the golden note of 4 beats lasts a second.
const ULTRASTAR = `#TITLE:Test
#ARTIST:Nobody
#BPM:60
#GAP:1000
: 0 1 0 Hel
: 1 1 2 lo~
: 2 1 4 ~
- 4
* 8 4 7 world
- 14
: 16 1 0 It's
: 17 1 0  ve
: 18 1 0 ry
: 19 1 0  fast
E
`;

test('the lists kept beside the games and the composer match them', () => {
  assert.deepEqual(ACTIVITY_IDS, GAMES.map((g) => g.id));
  assert.deepEqual(CHANT_MOODS, Object.keys(MOODS));
});

test('the example in the prompt imports with no problems at all', () => {
  const res = readPack(JSON.stringify(PACK_EXAMPLE), exampleTimeline(), { title: 'River Road' });
  assert.equal(res.fatal, undefined);
  assert.deepEqual(res.problems, []);
  assert.equal(res.moved, 0);
  for (const key of ['profile', 'teacher', 'clean', 'lines', 'words', 'popups', 'hunts', 'gapSets', 'swaps', 'stops', 'quiz', 'cards', 'pairs', 'moves', 'say', 'echo', 'chant']) {
    assert.ok(res.pack[key], `the example should show ${key}`);
  }
  assert.equal(res.batch, 1);
  assert.equal(res.pack.pairs[1].translated, true);
});

test('a reply is found inside whatever the AI wrote around it', () => {
  const t = exampleTimeline();
  const json = reply({ quiz: [{ q: 'Who?', answer: 'Us', wrong: ['Them'] }] });
  assert.ok(readPack(`Here is your pack!\n\`\`\`json\n${json}\n\`\`\`\nHope it helps.`, t).pack.quiz);
  assert.ok(readPack(`Sure: ${json} Enjoy!`, t).pack.quiz);
  assert.ok(readPack(`﻿${json}`, t).pack.quiz);
  assert.ok(readPack(json.replace(']}]', ']},]'), t).pack.quiz, 'a trailing comma is forgiven');
});

test('replies that cannot be read say why', () => {
  const t = exampleTimeline();
  assert.match(readPack('', t).fatal, /no JSON/);
  assert.match(readPack('I cannot help with that.', t).fatal, /no JSON/);
  const cut = readPack('{"format":"singing-lesson-pack","quiz":[{"q":"Who', t);
  assert.match(cut.fatal, /cut off/);
  assert.equal(cut.cut, true);
  assert.match(readPack('{ not json at all }', t).fatal, /not valid JSON/);
  assert.match(readPack('[1, 2]', t).fatal, /no JSON|one JSON object|not valid/);
  assert.match(readPack(reply({}), t).fatal, /Nothing in this reply/);
  assert.match(readPack('x'.repeat(500 * 1024), t).fatal, /too long/);
});

test('words are matched to the lyrics, not trusted', () => {
  const t = exampleTimeline();
  const res = readPack(reply({ popups: [
    { line: 3, words: 'rain comes', text: 'exact' },
    { line: 3, words: 'RAIN, comes!', text: 'case and punctuation do not matter' },
    { line: 1, words: 'dancing anyway', text: 'wrong line number, corrected from the words' },
    { line: 2, words: 'unicorns', text: 'not in the song' },
    { line: 99, words: 'river', text: 'a line that does not exist, found anyway' },
    { line: 3, text: 'no words at all' },
  ] }), t);
  assert.deepEqual(res.pack.popups.map((p) => [p.line, p.words]), [[3, 'rain comes'], [3, 'rain comes'], [4, 'dancing anyway'], [1, 'river']]);
  assert.equal(res.moved, 2);
  assert.equal(res.problems.length, 2);
  assert.match(res.problems[0], /popups 4.*"unicorns" is not in L2/);
});

test('a pack for another song is flagged', () => {
  const t = exampleTimeline();
  const wrong = readPack(reply({ song: { title: 'Other Song', lines: 30 }, swaps: Array.from({ length: 6 }, (_, i) => ({ line: 1, words: `nothing${i}`, wrong: 'x' })), quiz: [{ q: 'Q', answer: 'A', wrong: ['B'] }] }), t, { title: 'River Road' });
  assert.match(wrong.problems[0], /Is this the reply for another song/);
  assert.ok(wrong.problems.some((p) => /written for "Other Song"/.test(p)));
  assert.ok(wrong.problems.some((p) => /counted 30 lines/.test(p)));
});

test('invalid items go, and the rest of the pack stays', () => {
  const t = exampleTimeline();
  const res = readPack(reply({
    surprise: { a: 1 },
    quiz: [{ q: 'No wrong answers', answer: 'Yes' }, { q: 'Wrong equals right', answer: 'Yes', wrong: ['yes'] }, { q: 'Good', answer: 'Yes', wrong: ['No', 'yes'], line: 500 }],
    swaps: [{ line: 1, words: 'by the', wrong: 'to' }, { line: 1, words: 'river', wrong: 'river' }, { line: 1, words: 'river', wrong: 'two words' }, { line: 1, words: 'river', wrong: 'liver' }],
    pairs: [{ name: 'Too small', pairs: [{ a: 'a', b: 'b' }] }],
    moves: [{ word: 'flying', text: 'Fly!' }, { word: 'Walking', text: 'Walk!', emoji: 'not an emoji' }],
    echo: [{ from: 3, to: 2 }, { from: 1, to: 99 }, { from: 1, to: 2 }],
    teacher: { path: [{ activity: 'quiz', minutes: 45 }], notes: 'A note' },
    lines: [{ line: 0, plain: 'x' }, { line: 2, emoji: 'nope', plain: 'y' }],
    popups: 'not a list',
  }), t);
  assert.deepEqual(res.pack.quiz.map((q) => q.q), ['Good']);
  assert.deepEqual(res.pack.quiz[0].wrong, ['No']);
  assert.equal(res.pack.quiz[0].line, undefined);
  assert.deepEqual(res.pack.swaps.map((s) => s.wrong), ['liver']);
  assert.equal(res.pack.pairs, undefined);
  assert.deepEqual(res.pack.moves, [{ word: 'walking', text: 'Walk!' }]);
  assert.deepEqual(res.pack.echo, [{ from: 1, to: 2 }]);
  const long = lyrics(['One', 'Two', 'Three', 'Four', 'Five']);
  assert.deepEqual(readPack(reply({ echo: [{ from: 1, to: 5 }, { from: 1, to: 4 }] }), long).pack.echo, [{ from: 1, to: 4 }], 'a step has 4 lines at most');
  assert.deepEqual(res.pack.teacher, { notes: 'A note' }, 'lesson plans from older replies are dropped');
  assert.deepEqual(res.pack.lines, [{ line: 2, plain: 'y' }]);
  assert.equal(res.pack.popups, undefined);
  assert.equal(res.pack.surprise, undefined);
  assert.ok(res.problems.some((p) => /surprise/.test(p)));
  assert.ok(res.problems.some((p) => /a memory game needs at least 3 pairs/.test(p)));
});

test('Wrong word and Finish the line take one item on each line, repeats included', () => {
  const t = lyrics(['We ride tonight', 'The stars are high', 'We ride tonight']);
  const res = readPack(reply({
    swaps: [{ line: 1, words: 'ride', wrong: 'write' }, { line: 1, words: 'tonight', wrong: 'tomorrow' }, { line: 3, words: 'ride', wrong: 'write' }, { line: 2, words: 'stars', wrong: 'bars' }],
    stops: [{ line: 2, words: 'high', ask: 'Where?' }, { line: 2, words: 'stars', ask: 'What?' }],
  }), t);
  assert.deepEqual(res.pack.swaps.map((s) => s.words), ['ride', 'stars']);
  assert.deepEqual(res.pack.stops.map((s) => s.ask), ['Where?']);
  assert.equal(res.problems.filter((p) => /use one for each line/.test(p)).length, 3);
});

test('set ids stay unique, and only what was asked for survives in a set', () => {
  const t = exampleTimeline();
  const res = readPack(reply({
    hunts: [{ name: 'Same', targets: [{ line: 1, words: 'river' }], secret: 1 }, { name: 'Same', targets: [{ line: 2, words: 'Gonna' }] }, { name: 'Empty', targets: [{ line: 1, words: 'nope' }] }],
    gapSets: [{ id: 'same', name: 'Gaps', gaps: [{ line: 1, words: 'river', options: ['River', 'liver', 'wave', 'tide', 'sea'] }] }],
  }), t);
  assert.deepEqual(res.pack.hunts.map((s) => s.id), ['same', 'same-2']);
  assert.equal(res.pack.hunts[0].secret, undefined);
  assert.equal(res.pack.gapSets[0].id, 'same-3', 'ids are unique across all sets, because links name them');
  assert.deepEqual(res.pack.gapSets[0].gaps[0].options, ['liver', 'wave'], 'three at most, and never the answer');
  assert.equal(res.pack.gapSets[0].level, undefined);
});

test('nothing executable or unbounded comes through', () => {
  const t = exampleTimeline();
  const res = readPack('{"format":"singing-lesson-pack","__proto__":{"polluted":1},"profile":{"summary":"' + 'long '.repeat(500) + '"}}', t);
  assert.equal(({}).polluted, undefined);
  assert.ok(res.pack.profile.summary.length <= 400);
  assert.equal(res.pack.polluted, undefined);
});

test('anchors reach every repeat of a chorus and survive edits', () => {
  const lines = ['Hold on tight', 'The sun is high', 'Hold on tight', 'Hold on, hold on tight'];
  const t = lyrics(lines);
  assert.deepEqual(spots(t, { line: 1, words: 'tight' }).map((s) => s.line.index), [0, 2], 'the same line, not a line that merely has the word');
  assert.deepEqual(spots(t, { line: 4, words: 'hold on', }, { every: true }).map((s) => s.from), [0, 2]);
  assert.deepEqual(spots(t, { line: 4, words: 'hold on' }).map((s) => s.from), [0]);
  // A line number from before an edit: the words still find their line.
  const edited = lyrics(['A new first line', ...lines]);
  assert.deepEqual(spots(edited, { line: 2, words: 'sun is' }).map((s) => s.line.index), [2]);
  assert.deepEqual(spots(lyrics(['Nothing like it']), { line: 1, words: 'sun' }), []);
});

test('each game gets what it needs from a saved pack', () => {
  const t = lyrics(['We ride tonight', 'The stars are high', 'We ride tonight']);
  const { pack } = readPack(reply({
    gapSets: [{ id: 'verbs', name: 'Verbs', gaps: [{ line: 1, words: 'ride', options: ['rode', 'rides'], why: 'Present' }, { line: 2, words: 'stars are', options: ['x'] }] }],
    hunts: [{ id: 'nouns', name: 'Nouns', targets: [{ line: 2, words: 'stars', why: 'Plural' }] }],
    swaps: [{ line: 2, words: 'high', wrong: 'hi', why: 'Homophones' }, { line: 2, words: 'stars', wrong: 'bars' }],
    stops: [{ line: 3, words: 'tonight', ask: 'When?' }],
    popups: [{ line: 1, words: 'ride', kind: 'word', text: 'Note' }, { line: 1, words: 'tonight', kind: 'mystery', text: 'Other' }],
    say: [{ line: 2, words: 'are high', skill: 'linking', tip: 'Link them' }],
    echo: [{ from: 2, to: 2, why: 'Easy' }, { from: 1, to: 1 }],
    quiz: [{ when: 'before', q: 'Guess', answer: 'A', wrong: ['B'] }, { q: 'After', answer: 'C', wrong: ['D'], line: 2 }],
    moves: [{ word: 'Ride', text: 'Ride a horse!', emoji: '🐎' }],
    lines: [{ line: 1, plain: 'We travel this evening.' }],
  }), t);
  assert.deepEqual([...lessonGaps(t, pack, 'verbs')].map(([l, set]) => [l, [...set]]).sort((a, b) => a[0] - b[0]), [[0, [1]], [1, [1, 2]], [2, [1]]]);
  const notes = gapNotes(t, pack, 'verbs');
  assert.deepEqual(notes.get('2:1'), { options: ['rode', 'rides'], why: 'Present' });
  assert.deepEqual(notes.get('1:1').options, [], 'options fit a single word only');
  assert.deepEqual([...huntSets(t, pack)[0].marks], [[huntKey({ index: 1 }, 1), 'Plural']]);
  assert.deepEqual([...lessonSwaps(t, pack)], [[1, { wi: 3, wrong: 'hi', why: 'Homophones' }]], 'one swap on a line');
  assert.deepEqual([...lessonStops(t, pack)], [[0, { from: 2, ask: 'When?' }]], 'only the first time a line is sung');
  assert.deepEqual(lessonPopups(t, pack).get(2).map((p) => p.kind), ['word', 'word']);
  assert.deepEqual(lessonSay(t, pack).get(1), [{ tip: 'Link them', skill: 'linking', from: 2, to: 3 }]);
  assert.deepEqual(lessonEcho(t, pack).map((s) => s.lines.map((l) => l.index)), [[1], [0]]);
  assert.deepEqual(lessonQuiz(t, pack, 'before').map((q) => q.q), ['Guess']);
  assert.equal(lessonQuiz(t, pack).find((q) => q.q === 'After').line.index, 1);
  assert.deepEqual(lessonMoves(pack).get('ride'), { text: 'Ride a horse!', emoji: '🐎' });
  assert.equal(plainLines(t, pack).get(2), 'We travel this evening.');
  assert.ok(POPUP_KINDS[pack.popups[0].kind]);
});

test('pickGaps plays a pack set through the same path as the server', () => {
  const { song, timeline } = band('what-did-you-do');
  const line = timeline.lines.findIndex((l) => l.text.includes('woke'));
  const { pack, problems } = readPack(reply({ gapSets: [{ id: 'past', name: 'Past', gaps: [{ line: line + 1, words: 'woke' }] }] }), timeline);
  assert.deepEqual(problems, []);
  assert.equal(gapMode('', 'hard'), 'hard');
  assert.equal(gapMode('past'), 'cat:past');
  assert.equal(gapMode('pack:past', 'hard'), 'pack:past');
  const gaps = pickGaps(timeline, { mode: gapMode('pack:past'), lesson: pack });
  assert.deepEqual([...gaps.keys()], [line]);
  assert.equal(timeline.lines[line].words[[...gaps.get(line)][0]].text.toLowerCase(), 'woke');
  assert.equal(pickGaps(timeline, { mode: 'pack:gone', lesson: pack }).size, 0);
  assert.equal(pickGaps(timeline, { mode: 'pack:past' }).size, 0, 'no pack, no gaps, no crash');
  assert.ok(song);
});

test('band songs: syllable hyphens do not get in the way of quoted words', () => {
  const { timeline } = band('what-did-you-do');
  const res = readPack(reply({ popups: [{ line: 1, words: 'Yesterday I woke', text: 'Past' }] }), timeline);
  assert.deepEqual(res.problems, []);
  assert.equal(res.pack.popups[0].words, 'Yesterday I woke');
});

test('applying a pack fills the song, keeps what the teacher wrote, and can be undone', () => {
  const t = lyrics(['Sing it loud', 'Sing it proud', 'Sing it loud']);
  const song = { id: 's', title: 'T', source: 'none', about: 'Mine', level: 'A1', synced: [{ text: 'Sing it loud', pic: '🎤' }, { text: 'Sing it proud' }, { text: 'Sing it loud' }] };
  const { pack } = readPack(reply({ profile: { level: 'A2', grammar: ['Imperatives'], summary: 'A summary' }, lines: [{ line: 1, emoji: '📢', translation: 'Cántalo alto' }, { line: 2, emoji: '🦚' }] }), t);
  const next = applyPack(song, pack, t);
  assert.equal(next.lesson.profile.level, 'A2');
  assert.equal(next.level, 'A2');
  assert.deepEqual(next.grammar, ['Imperatives']);
  assert.equal(next.about, 'Mine', 'existing notes stay');
  assert.deepEqual(next.synced.map((l) => l.pic), ['🎤', '🦚', '📢'], 'only empty lines get a picture, repeats included');
  assert.deepEqual(next.synced.map((l) => l.tr), ['Cántalo alto', undefined, 'Cántalo alto']);
  assert.equal(song.synced[1].pic, undefined, 'the original song is not changed');
  const off = applyPack(song, pack, t, { profile: false, pictures: false, translations: false });
  assert.equal(off.level, 'A1');
  assert.equal(off.synced[1].pic, undefined);
  assert.equal(off.synced[0].tr, undefined);
  assert.ok(off.lesson);
  assert.equal(removePack(next).lesson, undefined);
  assert.equal(applyPack({ ...song, about: '' }, pack, t).about, 'A summary');
});

test('applying a pack to a band song writes to its lines', () => {
  const { song, timeline } = band('twinkle');
  const { pack } = readPack(reply({ lines: [{ line: 1, translation: 'Estrellita' }] }), timeline);
  const next = applyPack(song, pack, timeline);
  const again = timelineFromCompiled(compileSong(next), next.bpm);
  assert.equal(again.lines[0].translation, 'Estrellita');
});

test('share links leave the pack behind', () => {
  assert.equal(packableSong({ title: 'x', lines: [], lesson: { teacher: { notes: 'private' } } }).lesson, undefined);
});

test('lessonOf ignores anything that is not a pack', () => {
  assert.equal(lessonOf({}), null);
  assert.equal(lessonOf({ lesson: 'x' }), null);
  assert.equal(lessonOf(null), null);
  assert.deepEqual(lessonOf({ lesson: { quiz: [] } }), { quiz: [] });
});

test('edited lyrics: stale items are counted, and games skip them', () => {
  const before = lyrics(['We ride tonight', 'The stars are high']);
  const { pack } = readPack(reply({ swaps: [{ line: 1, words: 'ride', wrong: 'write' }, { line: 2, words: 'stars', wrong: 'bars' }], popups: [{ line: 2, words: 'high', text: 'Note' }] }), before);
  const after = lyrics(['We ride tonight', 'The moon is low']);
  assert.equal(staleCount(before, pack), 0);
  assert.equal(staleCount(after, pack), 2);
  assert.deepEqual([...lessonSwaps(after, pack).keys()], [0]);
  assert.equal(lessonPopups(after, pack).size, 0);
});

test('the teacher can open the chant and the worksheet without a plan', () => {
  assert.equal(new URLSearchParams('lesson=a%20b').get('lesson'), 'a b');
});

test('the prompt carries the class, the lyrics and the format', () => {
  const { song, timeline } = band('what-did-you-do');
  const prompt = buildPrompt(song, timeline, { level: 'A2', age: 'kids', language: 'Spanish', focus: 'irregular verbs' });
  assert.match(prompt, /this class is A2, so write activities for A1, A2, B1 \(CEFR\)/);
  assert.match(prompt, /young learners/);
  assert.match(prompt, /typical Spanish-speaker mistakes/);
  assert.match(prompt, /What to work on: "irregular verbs"/);
  assert.match(prompt, /Do not plan a lesson/);
  assert.doesNotMatch(prompt, /minutes|"path"|"tier"|Activity ids/);
  assert.match(prompt, /L1 Yesterday I woke up late,/);
  assert.match(prompt, /"format": "singing-lesson-pack"/);
  assert.match(prompt, /natural Spanish/);
  assert.match(prompt, /The song has pictures already/);
  assert.doesNotMatch(prompt, /undefined|\[object/);
});

test('Catalan classes are not treated as Spanish ones', () => {
  const { song, timeline } = band('twinkle');
  const catalan = buildPrompt(song, timeline, { language: 'Catalan' });
  assert.match(catalan, /Catalan is not Spanish/);
  assert.match(catalan, /never in Spanish/);
  assert.match(catalan, /final consonants lose their voice/);
  assert.match(catalan, /natural Catalan/);
  assert.match(buildPrompt(song, timeline, { language: 'català' }), /Catalan is not Spanish/);
  assert.doesNotMatch(buildPrompt(song, timeline, { language: 'Spanish' }), /Catalan is not Spanish/);
  assert.doesNotMatch(buildPrompt(song, timeline, {}), /Catalan is not Spanish/);
});

test('memory cards in the first language are not read in an English voice', () => {
  const t = exampleTimeline();
  const pairs = [{ a: 'river', b: 'riu' }, { a: 'rain', b: 'pluja' }, { a: 'road', b: 'carretera' }];
  const { pack } = readPack(reply({ pairs: [{ name: 'English and Catalan', translated: true, pairs }, { name: 'Meanings', translated: 'yes', pairs }] }), t);
  assert.equal(pack.pairs[0].translated, true);
  assert.equal(pack.pairs[1].translated, undefined);
  assert.equal(readAloud(pack.pairs[0], 'a'), true);
  assert.equal(readAloud(pack.pairs[0], 'b'), false);
  assert.equal(readAloud(pack.pairs[1], 'b'), true);
  assert.equal(readAloud(undefined, 'b'), true, 'rhymes are all English');
  const { song, timeline } = band('twinkle');
  assert.match(buildPrompt(song, timeline, { language: 'Catalan' }), /"translated": true/);
  assert.doesNotMatch(buildPrompt(song, timeline, {}), /"translated": true/);
});

test('a prompt without a class language asks for no translations', () => {
  const { song, timeline } = band('twinkle');
  const prompt = buildPrompt(song, timeline, {});
  assert.match(prompt, /Leave out every "translation" field/);
  assert.match(prompt, /how abstract its meaning is/);
  assert.match(prompt, /a B1 song gets A2, B1 and B2/);
  assert.doesNotMatch(prompt, /"translation":/);
});

test('repeated lines are sent once and point at the first', () => {
  const { song, timeline } = band('what-did-you-do');
  const prompt = buildPrompt(song, timeline, {});
  const sung = timeline.lines.filter((l) => !l.instrumental);
  const repeat = sung.findIndex((l, i) => sung.slice(0, i).some((o) => o.text === l.text));
  const first = sung.findIndex((l) => l.text === sung[repeat].text);
  assert.ok(prompt.includes(`L${repeat + 1} = L${first + 1}`));
  assert.ok(sung.every((l, i) => prompt.includes(`L${i + 1} `)));
});

test('UltraStar: the AI gets measured facts, not the raw file', () => {
  const { lines } = parseUltraStar(ULTRASTAR);
  const timeline = timelineFromSynced(lines, 30);
  assert.ok(hasMelody(timeline));
  const song = { title: 'Test', source: 'audio', synced: lines };
  const prompt = buildPrompt(song, timeline, { melody: true });
  assert.match(prompt, /the UltraStar file of the song/);
  // A beat is 60 / (60 * 4) = .25 s. Line 1 starts at the 1 s #GAP.
  assert.match(prompt, /L1 0:01, \.8 s, 2\.7 syl\/s, C4-D4/);
  assert.match(prompt, /Hel\(C4 \.3\)/);
  assert.match(prompt, /lo\(D4 \.5 ~2\)/, 'a held "~" note is part of its syllable');
  assert.match(prompt, /world\(G4 1\.0 LONG GOLD\)/);
  assert.match(prompt, /It's\(C4 \.3\) ve\(C4 \.3\)-ry\(C4 \.3\) fast/);
  assert.doesNotMatch(prompt, /#BPM|#GAP/);
  assert.match(prompt, /never write GOLD, syl\/s, semitones/, 'students read the tips: the rows are for the AI');
});

test('rests, jumps and held notes reach the facts', () => {
  const melody = [[10, 10.2, 60, 'Go '], [10.2, 12, 72, 'on '], [13, 13.2, 60, 'Now ']];
  const lines = [{ text: 'Go on Now', start: 10, end: 13.5, notes: melody }];
  const timeline = timelineFromSynced(lines, 20);
  const facts = melodyFacts(timeline).join('\n');
  assert.match(facts, /Longest held syllables: "on" in L1, 1\.8 s/);
  assert.match(facts, /Biggest jumps: L1 "Go" to "on", 12 semitones/);
  assert.match(facts, /C4 to C5 \(12 semitones\)/);
  assert.match(buildPrompt({ title: 'R', source: 'audio', synced: lines }, timeline, {}), /on\(C5 1\.8 LONG\) \|/);
});

test('line timing only: the prompt says word times are estimates', () => {
  const t = lyrics(['We ride tonight', 'The stars are high', 'We ride tonight']);
  const song = { title: 'T', source: 'youtube', synced: [{ text: 'We ride tonight', start: 0 }] };
  assert.equal(hasMelody(t), false);
  const prompt = buildPrompt(song, t, { melody: true });
  assert.match(prompt, /timed by line only/);
  assert.match(prompt, /Most repeated \(free drilling\): L1 ×2/);
  assert.doesNotMatch(prompt, /# The melody/);
});

test('no timing, or the melody switched off: no timing section', () => {
  const t = lyrics(['We ride tonight', 'The stars are high']);
  assert.doesNotMatch(buildPrompt({ title: 'T', source: 'none', synced: [{ text: 'We ride tonight' }] }, t, {}), /# Timing|# The melody/);
  const { song, timeline } = band('twinkle');
  assert.match(buildPrompt(song, timeline, {}), /# The melody/);
  assert.doesNotMatch(buildPrompt(song, timeline, { melody: false }), /# The melody/);
});

test('fix-up messages name what went wrong', () => {
  const list = repairPrompt({ problems: ['popups 2: "x" is not in L3'] });
  assert.match(list, /popups 2/);
  assert.match(list, /send only them again/);
  assert.match(repairPrompt({ cut: true }), /cut off/);
  assert.match(repairPrompt({ fatal: 'This is not valid JSON' }), /not valid JSON/);
});

test('every starter song can make a prompt', () => {
  for (const song of STARTER_SONGS) {
    const timeline = timelineFromCompiled(compileSong(song), song.bpm);
    const prompt = buildPrompt(song, timeline, {});
    assert.ok(prompt.length > 8000 && prompt.length < 45000, `${song.id}: ${prompt.length}`);
    assert.doesNotMatch(prompt, /undefined|NaN|Infinity/, song.id);
  }
});

test('a full pack written from the prompt imports cleanly and reaches every game', () => {
  const { song, timeline } = band('what-did-you-do');
  const text = readFileSync(new URL('./fixtures/lesson-what-did-you-do.json', import.meta.url), 'utf8');
  const { pack, problems, moved, fatal } = readPack(text, timeline, { title: song.title });
  assert.equal(fatal, undefined);
  assert.deepEqual(problems, []);
  assert.equal(moved, 0);
  assert.equal(staleCount(timeline, pack), 0);
  const gaps = pickGaps(timeline, { mode: 'pack:story-verbs', lesson: pack });
  assert.ok(gaps.size >= 8);
  const hunt = huntSets(timeline, pack).find((s) => s.id === 'irregular-past');
  assert.ok(hunt.marks.size >= 16);
  assert.equal(lessonSwaps(timeline, pack).size, 8);
  assert.equal(lessonStops(timeline, pack).size, 6);
  assert.ok(lessonPopups(timeline, pack).size >= 9);
  assert.equal(lessonEcho(timeline, pack).length, 5);
  assert.equal(lessonSay(timeline, pack).size, 5 + 2, 'a line in the chorus repeats');
  assert.equal(lessonQuiz(timeline, pack, 'before').length, 2);
  assert.equal(packCounts(pack).hotmic, 14);
  const next = applyPack({ ...song }, pack, timeline, { pictures: false });
  const again = timelineFromCompiled(compileSong(next), next.bpm);
  assert.equal(again.lines[0].translation, 'Ahir em vaig despertar tard,');
  assert.equal(again.lines.at(-1).translation, 'Vaig tenir un dia molt, molt boig!');
  assert.deepEqual(readPack(JSON.stringify(next.lesson), again, { title: song.title }).problems.filter((p) => !/^format|^song/.test(p)), [], 'a saved pack reads back the same');
});

test('the prompt tells the AI what not to quote, and repeats no facts', () => {
  const { song, timeline } = band('what-did-you-do');
  const prompt = buildPrompt(song, timeline, {});
  assert.match(prompt, /says who sings the line/);
  assert.doesNotMatch(buildPrompt(band('twinkle').song, band('twinkle').timeline, {}), /says who sings the line/);
  const held = melodyFacts(timeline).find((f) => f.startsWith('Longest held'));
  const entries = held.replace('Longest held syllables: ', '').split('; ');
  assert.equal(new Set(entries).size, entries.length, held);
  assert.doesNotMatch(held, /[,?!]"/, 'no punctuation inside a syllable');
});

test('every level to C2, and the levels next to the class', () => {
  assert.equal(LEVELS.at(-1), 'C2');
  assert.deepEqual(levelsAround('B1'), ['A2', 'B1', 'B2']);
  assert.deepEqual(levelsAround('Pre-A1'), ['Pre-A1', 'A1']);
  assert.deepEqual(levelsAround('C2'), ['C1', 'C2']);
  assert.deepEqual(levelsAround(''), []);
});

test('levels stay on sets and items, and games read them easiest first', () => {
  const t = exampleTimeline();
  const { pack } = readPack(reply({
    gapSets: [{ id: 'hard', name: 'Hard', level: 'C2', gaps: [{ line: 1, words: 'river' }] }, { id: 'easy', name: 'Easy', level: 'A1', emoji: '🌱', gaps: [{ line: 1, words: 'walking' }] }, { id: 'odd', name: 'Odd', level: 'Z9', gaps: [{ line: 1, words: 'by' }] }],
    quiz: [{ q: 'Q1', answer: 'A', wrong: ['B'], level: 'B2' }, { q: 'Q2', answer: 'A', wrong: ['B'], level: 'A2' }],
    cards: [{ body: 'Talk', level: 'B1' }],
  }), t);
  assert.equal(pack.gapSets[2].level, undefined, 'not a level');
  assert.deepEqual(orderSets(pack.gapSets).map((s) => s.id), ['odd', 'easy', 'hard']);
  assert.equal(pickSet(orderSets(pack.gapSets), 'C2').id, 'hard');
  assert.equal(pickSet(orderSets(pack.gapSets), 'B1').id, 'odd', 'nothing at that level: the first set');
  assert.equal(setLabel(pack.gapSets[1]), '🌱 A1: Easy');
  assert.deepEqual(packLevels(pack.quiz), ['A2', 'B2']);
  assert.equal(pack.cards[0].level, 'B1');
});

test('batches: sized by the teacher, in order, with no set cut in two', () => {
  const count = (size) => planBatches({ batchSize: size }).length;
  assert.ok(count(10) > count(20) && count(20) > count(30) && count(30) > count(60));
  assert.equal(planBatches({ batchSize: 999 }).length, count(BATCH_SIZE.most), 'held to the most one reply can hold');
  assert.equal(planBatches({ batchSize: 1 }).length, count(BATCH_SIZE.least));
  assert.equal(planBatches({ batchSize: 'x' }).length, count(BATCH_SIZE.usual));
  const plan = planBatches({ batchSize: 20, level: 'B1' });
  assert.match(plan[0].parts.join(), /"profile"/);
  assert.match(plan[0].parts.join(), /"clean"/);
  const text = plan.flatMap((b) => b.parts).join(' | ');
  for (const level of ['A2', 'B1', 'B2']) assert.ok(text.includes(`one "gapSets" set of 10 gaps for ${level}`), text);
  const words = plan.flatMap((b) => b.parts).filter((p) => /^\d+ "words"/.test(p)).reduce((n, p) => n + parseInt(p, 10), 0);
  assert.equal(words, 16);
  assert.equal(planBatches({ batchSize: 60 }).length, 5, 'the biggest batches: one for each family of games');
  for (const batch of planBatches({ batchSize: 20 })) {
    const families = new Set(batch.parts.map((p) => (/gapSets|swaps|stops/.test(p) ? 'listening' : /hunts|quiz/.test(p) ? 'grammar' : /cards|say|echo|moves/.test(p) ? 'speaking' : /pairs|chant/.test(p) ? 'memory' : 'song')));
    assert.equal(families.size, 1, `one family in a batch: ${batch.parts.join(' + ')}`);
  }
  const split = planBatches({ batchSize: 5 }).flatMap((b) => b.parts).filter((p) => /"gapSets"/.test(p));
  assert.equal(split.length, 3, 'a set of 10 stays whole in batches of 5');
  assert.match(planBatches({ batchSize: 20 }).flatMap((b) => b.parts).join(), /your lowest level/);
});

test('the prompt holds the whole plan, asks for one batch at a time and ends on it', () => {
  const { song, timeline } = band('twinkle');
  const prompt = buildPrompt(song, timeline, { batchSize: 20, focus: 'rhymes' });
  const plan = planBatches({ batchSize: 20 });
  assert.match(prompt, new RegExp(`comes in ${plan.length} batches of at most 20 items`));
  for (let i = 0; i < plan.length; i += 1) assert.ok(prompt.includes(`Batch ${i + 1}: `), `batch ${i + 1}`);
  assert.match(prompt, /count its items against this plan/);
  assert.match(prompt, /part1\.json/);
  assert.ok(prompt.indexOf('# The teacher\'s own words') < prompt.indexOf('# The class'), 'the teacher comes first');
  assert.match(prompt.slice(-200), /re-read "The teacher's own words".*Send batch 1 now and stop/s, 'and last');
  assert.doesNotMatch(buildPrompt(song, timeline, {}), /own words/, 'no section when the teacher typed nothing');
});

test('an agent does everything in one run, goes deeper and checks its work', () => {
  const { song, timeline } = band('twinkle');
  assert.ok(AI_KINDS.agent && AI_KINDS.chatbot);
  assert.equal(planBatches({ ai: 'agent' }).length, 1);
  const count = (plan, name) => plan.flatMap((b) => b.parts).filter((p) => p.includes(name)).reduce((n, p) => n + parseInt(p, 10), 0);
  assert.ok(count(planBatches({ ai: 'agent' }), '"cards"') > count(planBatches({}), '"cards"'));
  assert.equal(planBatches({ ai: 'agent' }).flatMap((b) => b.parts).filter((p) => /"gapSets"/.test(p)).length, 6, 'two sets for each level');
  const prompt = buildPrompt(song, timeline, { ai: 'agent', focus: 'rhymes' });
  assert.match(prompt, /autonomous agent/);
  assert.match(prompt, /twinkle[^\n]*-pack\.json/i);
  assert.match(prompt, /write a small script/);
  assert.match(prompt, /Check every fact/);
  assert.match(prompt.slice(-200), /finish the whole pack in this run/);
  assert.doesNotMatch(prompt, /# Batches|Send batch 1|"batch": 1/);
  const chatbot = buildPrompt(song, timeline, {});
  assert.match(chatbot, /# Batches/);
  assert.match(chatbot, /downloadable file named "[^"]*-part1\.json"/);
  assert.doesNotMatch(chatbot, /autonomous agent/);
});

test('next-batch and more messages name the work', () => {
  const plan = planBatches({ batchSize: 20 });
  const next = nextBatchPrompt(plan, 3);
  assert.match(next, new RegExp(`batch 3 of ${plan.length}`));
  assert.ok(next.includes(plan[2].parts[0]));
  assert.match(next, /"batch": 3/);
  assert.match(nextBatchPrompt(plan, plan.length + 1), /last batch/);
  assert.match(morePrompt('quiz'), /"quiz".*at least 10 new items/);
  assert.match(morePrompt('cards', 'B2'), /at level B2/);
});

test('batches join into one pack, and the same batch twice adds nothing', () => {
  const t = lyrics(['We ride tonight', 'The stars are high', 'We ride tonight']);
  const one = readPack(reply({ batch: 1, profile: { level: 'B1' }, teacher: { notes: 'Notes', cautions: [{ note: 'Careful' }] }, lines: [{ line: 1, plain: 'First' }], words: [{ word: 'ride', meaning: 'travel' }] }), t).pack;
  const two = readPack(reply({ batch: 2, words: [{ word: 'Ride', meaning: 'again' }, { word: 'stars', meaning: 'lights' }], lines: [{ line: 1, emoji: '🌙' }, { line: 2, plain: 'Second' }], teacher: { cautions: [{ note: 'Careful' }, { note: 'Also' }] }, quiz: [{ q: 'Q', answer: 'A', wrong: ['B'] }], gapSets: [{ id: 'verbs', name: 'Verbs', gaps: [{ line: 1, words: 'ride' }] }] }), t).pack;
  const three = readPack(reply({ batch: 3, gapSets: [{ id: 'verbs', name: 'Verbs', gaps: [{ line: 1, words: 'ride' }, { line: 2, words: 'stars' }] }, { id: 'more', name: 'More', gaps: [{ line: 2, words: 'high' }] }], swaps: [{ line: 1, words: 'ride', wrong: 'write' }], chant: { text: 'Sing it now' } }), t).pack;
  let pack = mergePacks(mergePacks(one, two), three);
  assert.equal(pack.profile.level, 'B1');
  assert.equal(pack.teacher.notes, 'Notes', 'a later batch does not wipe what it does not send');
  assert.deepEqual(pack.teacher.cautions.map((c) => c.note), ['Careful', 'Also']);
  assert.deepEqual(pack.lines, [{ line: 1, plain: 'First', emoji: '🌙' }, { line: 2, plain: 'Second' }]);
  assert.deepEqual(pack.words.map((w) => w.word), ['ride', 'stars'], 'a word already there is not added again');
  assert.deepEqual(pack.gapSets.map((s) => [s.id, s.gaps.length]), [['verbs', 2], ['more', 1]], 'a set with the same id grows');
  assert.equal(pack.chant.text, 'Sing it now');
  const size = JSON.stringify(pack).length;
  assert.equal(JSON.stringify(mergePacks(pack, three)).length, size, 'pasting a batch twice changes nothing');
  assert.equal(pack.format, 'singing-lesson-pack');
  const reread = readPack(JSON.stringify(pack), t);
  assert.deepEqual(reread.problems, []);
  assert.equal(reread.pack.gapSets[0].gaps.length, 2);
});

test('joining batches keeps one wrong word to a line', () => {
  const t = lyrics(['We ride tonight', 'The stars are high']);
  const a = readPack(reply({ swaps: [{ line: 1, words: 'ride', wrong: 'write' }] }), t).pack;
  const b = readPack(reply({ swaps: [{ line: 1, words: 'tonight', wrong: 'tonite' }, { line: 2, words: 'high', wrong: 'hi' }] }), t).pack;
  const joined = readPack(JSON.stringify(mergePacks(a, b)), t).pack;
  assert.deepEqual(joined.swaps.map((s) => s.words), ['ride', 'high']);
});

test('"translated" counts on the set or on each pair, as a real AI wrote it', () => {
  const t = exampleTimeline();
  const pairs = [{ a: 'river', b: 'riu', translated: true }, { a: 'rain', b: 'pluja', translated: true }, { a: 'road', b: 'carretera', translated: true }];
  const { pack } = readPack(reply({ pairs: [{ name: 'Catalan', pairs }] }), t);
  assert.equal(pack.pairs[0].translated, true);
  assert.deepEqual(pack.pairs[0].pairs[0], { a: 'river', b: 'riu' });
  assert.equal(readAloud(pack.pairs[0], 'b'), false);
});

test('tiles show what a pack adds to each game', () => {
  const t = lyrics(['We ride tonight', 'The stars are high']);
  const { pack } = readPack(reply({ gapSets: [{ name: 'G', gaps: [{ line: 1, words: 'ride' }, { line: 2, words: 'stars' }] }], quiz: [{ q: 'Q', answer: 'A', wrong: ['B'] }] }), t);
  const counts = packCounts(pack);
  assert.equal(counts.gapfill, 2);
  assert.equal(counts.choose, 2);
  assert.equal(counts.quiz, 1);
  assert.equal(counts.hotmic, 0);
  assert.deepEqual(packCounts(null), {});
});

const CLEAN = [
  { text: 'You are so damn special', start: 0, end: 4, notes: [[0, 0.5, 60, 'You '], [0.5, 1, 60, 'are '], [1, 1.5, 60, 'so '], [1.5, 2, 62, 'damn '], [2, 2.5, 60, 'spe'], [2.5, 3, 60, 'cial ']] },
  { text: 'The sky is blue', start: 5, end: 8 },
  { text: 'You are so damn special', start: 9, end: 13, notes: [[9, 9.5, 60, 'You '], [9.5, 10, 60, 'are '], [10, 10.5, 60, 'so '], [10.5, 11, 62, 'damn '], [11, 11.5, 60, 'spe'], [11.5, 12, 60, 'cial ']] },
];

test('the clean version masks the word and says when to drop the singer', () => {
  const t = timelineFromSynced(JSON.parse(JSON.stringify(CLEAN)), 15);
  const spans = cleanTimeline(t, { clean: [{ words: 'damn' }], cleanOn: true });
  assert.equal(spans.length, 2, 'wherever it is sung');
  assert.deepEqual(spans.map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]), [[1.45, 2.12], [10.45, 11.12]]);
  assert.equal(t.lines[0].text, 'You are so d*** special');
  assert.equal(t.lines[0].words[3].text, 'd***');
  assert.equal(t.lines[0].words[3].syllables[0].text, 'd***');
  assert.equal(t.lines[1].text, 'The sky is blue');
  assert.equal(t.lines[2].text, 'You are so d*** special');
  assert.equal(t.lines[0].notes.find((n) => n.start === 1.5).text, '', 'Pitch Pal does not show it either');
});

test('the clean version: off until ticked, empty, a word over two notes, and spans that touch', () => {
  const raw = () => timelineFromSynced(JSON.parse(JSON.stringify(CLEAN)), 15);
  assert.deepEqual(cleanTimeline(raw(), null), []);
  assert.deepEqual(cleanTimeline(raw(), { clean: [], cleanOn: true }), []);
  const off = raw();
  assert.deepEqual(cleanTimeline(off, { clean: [{ words: 'damn' }] }), [], 'the list alone changes nothing');
  assert.equal(off.lines[0].text, 'You are so damn special', 'not ticked: nothing is masked');
  const two = raw();
  assert.equal(cleanTimeline(two, { clean: [{ words: 'special' }], cleanOn: true }).length, 2);
  assert.equal(two.lines[0].text, 'You are so damn s******');
  assert.deepEqual(two.lines[0].words[4].syllables.map((s) => s.text), ['s**', '****']);
  const together = raw();
  assert.equal(cleanTimeline(together, { clean: [{ words: 'damn' }, { words: 'special' }], cleanOn: true }).length, 2, 'next to each other they are one span');
});

test('an AI reply leaves the clean version off, and a tick lasts through saving, batches and a new import', () => {
  const t = timelineFromSynced(JSON.parse(JSON.stringify(CLEAN)), 15);
  const pack = readPack(reply({ clean: [{ words: 'damn' }] }), t).pack;
  assert.equal(pack.cleanOn, undefined, 'the AI only suggests the words');
  assert.deepEqual(cleanTimeline(t, pack), []);
  const ticked = { ...pack, cleanOn: true };
  assert.equal(applyPack({ id: 'x', source: 'audio', synced: CLEAN }, ticked, t).lesson.cleanOn, true, 'saved with the song');
  assert.equal(mergePacks(ticked, { clean: [{ words: 'special' }] }).cleanOn, true, 'the next batch');
  assert.equal(readPack(JSON.stringify(ticked), t).pack.cleanOn, true, 'downloaded and opened again');
});

test('words for the clean list are read from the reply and can be added by hand', () => {
  const t = timelineFromSynced(JSON.parse(JSON.stringify(CLEAN)), 15);
  const res = readPack(reply({ clean: [{ words: 'damn', why: 'Swearing' }, { words: 'nothing here' }, { why: 'no words' }] }), t);
  assert.deepEqual(res.pack.clean, [{ words: 'damn', why: 'Swearing' }]);
  assert.equal(res.problems.length, 2);
  const pack = { format: 'singing-lesson-pack' };
  assert.equal(addCleanWord(pack, t, 'DAMN'), 2);
  assert.equal(addCleanWord(pack, t, 'damn'), 2);
  assert.equal(pack.clean.length, 1, 'added once');
  assert.equal(addCleanWord(pack, t, 'zebra'), 0);
  assert.equal(pack.clean.length, 1);
  assert.equal(mergePacks({ clean: [{ words: 'damn' }] }, { cleanOn: true, clean: [{ words: 'Damn' }] }).clean.length, 1);
});

test('a masked word never becomes a gap, and anchors to it drop out', () => {
  const t = timelineFromSynced(JSON.parse(JSON.stringify(CLEAN)), 15);
  const pack = readPack(reply({ clean: [{ words: 'damn' }], popups: [{ line: 1, words: 'damn', text: 'A note' }, { line: 1, words: 'special', text: 'Kept' }] }), t).pack;
  cleanTimeline(t, { ...pack, cleanOn: true });
  for (const mode of ['easy', 'medium', 'hard', 'all']) {
    for (const seed of [1, 2, 3]) {
      for (const [index, set] of pickGaps(t, { mode, seed })) for (const wi of set) assert.ok(!t.lines[index].words[wi].text.includes('*'), mode);
    }
  }
  assert.deepEqual(lessonPopups(t, pack).get(0).map((p) => p.text), ['Kept']);
});

test('a hunt can hide lines, with their repeats, and the choice lasts through batches', () => {
  const t = timelineFromSynced(JSON.parse(JSON.stringify(CLEAN)), 15);
  const hunt = { id: 'h', name: 'Adjectives', targets: [{ line: 1, words: 'special' }, { line: 2, words: 'blue' }], skip: [1, 1, 99, 'x'] };
  const pack = readPack(reply({ hunts: [hunt] }), t).pack;
  assert.deepEqual(pack.hunts[0].skip, [1], 'real line numbers, once each');
  const [set] = huntSets(t, pack);
  assert.ok(set.hidden.has(t.lines.find((l) => l.index === 0).text.toLowerCase()), 'its text, so line 3 repeats go too');
  assert.equal(set.hidden.size, 1);
  assert.deepEqual(readPack(reply({ hunts: [{ ...hunt, skip: [] }] }), t).pack.hunts[0].skip, undefined);
  assert.deepEqual(readPack(JSON.stringify(mergePacks(pack, { hunts: [{ id: 'h', name: 'Adjectives', targets: [{ line: 2, words: 'sky' }] }] })), t).pack.hunts[0].skip, [1]);
  assert.deepEqual(huntSets(t, readPack(reply({ hunts: [{ id: 'n', name: 'None', targets: [{ line: 2, words: 'blue' }] }] }), t).pack)[0].hidden.size, 0);
});

test('a quiz round can reach every question, and keeps the ones for before the song first', () => {
  const pool = Array.from({ length: 50 }, (_, i) => ({ q: i, when: i < 6 ? 'before' : 'after' }));
  const seen = new Set();
  for (let run = 0; run < 400; run += 1) {
    const round = quizRound(pool, 10);
    assert.equal(round.length, 10);
    assert.equal(new Set(round).size, 10, 'no question twice');
    const firstAfter = round.findIndex((q) => q.when === 'after');
    if (firstAfter >= 0) assert.ok(round.slice(firstAfter).every((q) => q.when === 'after'));
    round.forEach((q) => seen.add(q.q));
  }
  assert.equal(seen.size, 50, 'even the last in the pack');
  assert.equal(quizRound(pool).length, 50, 'no count: all of them');
  assert.equal(quizRound(pool.slice(0, 3), 10).length, 3);
  assert.equal(pool[0].q, 0, 'the pack itself stays in order');
});

test('a game opens on the teacher\'s level, and otherwise on the level of the song', () => {
  const lesson = { profile: { level: 'B2' } };
  assert.equal(startLevel(['B1', 'B2', 'C1'], undefined, lesson), 'B2');
  assert.equal(startLevel(['B1', 'B2', 'C1'], 'B1', lesson), 'B1');
  assert.equal(startLevel(['B1', 'B2', 'C1'], '', lesson), '', 'All stays All');
  assert.equal(startLevel(['B1', 'B2', 'C1'], 'A2', lesson), 'B2', 'a level from another song');
  assert.equal(startLevel(['B1', 'C1'], undefined, lesson), '', 'the song level has no questions');
  assert.equal(startLevel([], undefined, null), '');
});

test('the prompt asks for depth over numbers, and for content that stays on the song', () => {
  const { song, timeline } = band('twinkle');
  const agent = buildPrompt(song, timeline, { ai: 'agent' });
  assert.match(agent, /ceilings .*not quotas/);
  assert.doesNotMatch(agent, /reaches the count|are minimums/, 'an agent that must reach every count fills it with weak items');
  assert.match(agent, /nothing is there only to reach a number/);
  assert.doesNotMatch(agent, /ends well short/, 'it left 2 gaps for a whole song');
  assert.match(agent, /Only the gaps and the cards have a minimum/);
  assert.match(agent, /every gap set has at least 8 gaps and every level has at least 8 cards/);
  assert.match(agent, /none opens with a label/);
  const count = (name) => planBatches({ ai: 'agent' }).flatMap((b) => b.parts).filter((p) => p.includes(name)).reduce((n, p) => n + parseInt(p, 10), 0);
  assert.equal(count('"swaps"'), 14);
  assert.equal(count('"cards"'), 36);
  for (const prompt of [agent, buildPrompt(song, timeline, {})]) {
    assert.match(prompt, /Every card starts from this song/);
    assert.match(prompt, /Never write "you may pass"/);
    assert.match(prompt, /It never mentions line numbers/);
    assert.match(prompt, /skip lists the numbers of lines to leave out/);
    assert.match(prompt, /one side of each pair comes from the lyrics/);
    assert.match(prompt, /differ in exactly one sound/);
    assert.match(prompt, /not a literature class/);
    assert.match(prompt, /at least 8 gaps, spread from the first verse to the last/);
    assert.match(prompt, /widen it rather than send a short set/);
    assert.match(prompt, /Write at least 8 for each level/);
    assert.match(prompt, /most use a frame copied from its lyrics/);
    assert.match(prompt, /no more than 2 cards may share one/);
    assert.match(prompt, /Never open a card with a label/);
    assert.doesNotMatch(prompt, /new in a group/, 'an example of one situation became the subject of all 18 cards');
    assert.match(prompt, /All pronunciation in the pack is General American/);
    assert.match(prompt, /Serious is for what a teacher may not want in class at all: strong swearing, explicit sex, drug use, heavy drinking/);
    assert.match(prompt, /A figurative, historical or story image of death, war or religion is mild/);
  }
  assert.match(buildPrompt(song, timeline, {}), /If you are short, write more/, 'a chatbot still has to be pushed: unpushed, it sent 4 of 16 questions');
});

test('a quiz never opens on an empty round when a level has no questions of that kind', async () => {
  const { packQuestions } = await import('../js/games/quiz.js');
  const t = timelineFromSynced(JSON.parse(JSON.stringify(CLEAN)), 15);
  const lesson = { quiz: [{ when: 'before', level: 'A1', q: 'Early', answer: 'a', wrong: ['b'] }, { when: 'after', level: 'A2', q: 'Late', answer: 'a', wrong: ['b'] }] };
  assert.deepEqual(packQuestions(t, lesson, { when: 'before', level: 'A2' }).map((q) => q.q), ['Early'], 'the song level has none for before listening');
  assert.deepEqual(packQuestions(t, lesson, { when: 'after', level: 'A2' }).map((q) => q.q), ['Late']);
  assert.deepEqual(packQuestions(t, lesson, { level: 'A2' }).map((q) => q.q), ['Late'], 'a level that has questions keeps to them');
  assert.equal(packQuestions(t, lesson, { count: 1 }).length, 1);
});
