import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIVITY_IDS, CHANT_MOODS, POPUP_KINDS, applyPack, readAloud, gapNotes, huntKey, huntSets, lessonEcho, lessonGaps, lessonMoves, lessonOf, lessonPopups, lessonQuiz, lessonSay, lessonStops, lessonSwaps, plainLines, readPack, removePack, spots, staleCount, stepHash } from '../js/lesson/pack.js';
import { AMOUNTS, EXAMPLE_LYRICS, PACK_EXAMPLE, buildPrompt, hasMelody, melodyFacts, repairPrompt } from '../js/lesson/prompt.js';
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
  for (const key of ['profile', 'teacher', 'lines', 'words', 'popups', 'hunts', 'gapSets', 'swaps', 'stops', 'quiz', 'cards', 'pairs', 'moves', 'say', 'echo', 'chant']) {
    assert.ok(res.pack[key], `the example should show ${key}`);
  }
  assert.equal(res.pack.teacher.path.length, 3);
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
    teacher: { path: [{ activity: 'tiktok' }, { activity: 'hunt', set: 'missing' }, { activity: 'quiz', when: 'sometimes', minutes: 500 }] },
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
  assert.deepEqual(res.pack.teacher.path, [{ stage: 'while', activity: 'hunt' }, { stage: 'while', activity: 'quiz', minutes: 120 }]);
  assert.deepEqual(res.pack.lines, [{ line: 2, plain: 'y' }]);
  assert.equal(res.pack.popups, undefined);
  assert.equal(res.pack.surprise, undefined);
  assert.ok(res.problems.some((p) => /surprise/.test(p)));
  assert.ok(res.problems.some((p) => /"tiktok" is not an activity/.test(p)));
  assert.ok(res.problems.some((p) => /no set "missing"/.test(p)));
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
  assert.equal(res.pack.gapSets[0].tier, 'core');
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

test('plan steps link to the right game with the right set', () => {
  assert.equal(stepHash('a b', { activity: 'gapfill', set: 'verbs' }), '#/play/a%20b/gapfill?focus=pack%3Averbs');
  assert.equal(stepHash('s', { activity: 'quiz', when: 'before' }), '#/play/s/quiz?when=before');
  assert.equal(stepHash('s', { activity: 'karaoke' }), '#/play/s/karaoke');
  assert.equal(stepHash('s', { activity: 'worksheet' }), '#/print/s/lesson');
  assert.equal(stepHash('s', { activity: 'chant' }), '#/chant?lesson=s');
  assert.deepEqual([...new URLSearchParams('focus=pack%3Averbs')], [['focus', 'pack:verbs']]);
});

test('the prompt carries the class, the lyrics and the format', () => {
  const { song, timeline } = band('what-did-you-do');
  const prompt = buildPrompt(song, timeline, { level: 'A2', age: 'kids', language: 'Spanish', focus: 'irregular verbs', minutes: 30 });
  assert.match(prompt, /Level: A2 \(CEFR\)/);
  assert.match(prompt, /young learners/);
  assert.match(prompt, /typical Spanish-speaker mistakes/);
  assert.match(prompt, /irregular verbs/);
  assert.match(prompt, /30 minutes/);
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
  assert.match(prompt, /Decide which CEFR level/);
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

test('the pack size changes what the prompt asks for', () => {
  const { song, timeline } = band('twinkle');
  assert.match(buildPrompt(song, timeline, { amount: 'light' }), /"quiz" \(about 6\)/);
  assert.match(buildPrompt(song, timeline, { amount: 'rich' }), /"quiz" \(about 16\)/);
  assert.match(buildPrompt(song, timeline, { amount: 'nonsense' }), /"quiz" \(about 10\)/);
  for (const amount of Object.values(AMOUNTS)) assert.ok(amount.label);
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

test('only activities that fit the song are offered in the plan', () => {
  const { song, timeline } = band('what-did-you-do');
  const prompt = buildPrompt(song, timeline, {});
  assert.match(prompt, /Activity ids: karaoke \(Karaoke\)/);
  assert.doesNotMatch(prompt, /round \(Round\)/, 'this song is not a round');
  assert.match(prompt, /worksheet \(printed sheet/);
  const t = lyrics(['We ride tonight']);
  assert.doesNotMatch(buildPrompt({ title: 'T', source: 'youtube', synced: [{ text: 'We ride tonight', start: 1 }] }, t, {}), /pitch \(Pitch Pal\)/);
});

test('fix-up messages name what went wrong', () => {
  const list = repairPrompt({ problems: ['popups 2: "x" is not in L3'] });
  assert.match(list, /popups 2/);
  assert.match(list, /complete JSON/);
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
  for (const step of pack.teacher.path) assert.match(stepHash(song.id, step), /^#\//);
  const next = applyPack({ ...song }, pack, timeline, { pictures: false });
  const again = timelineFromCompiled(compileSong(next), next.bpm);
  assert.equal(again.lines[0].translation, 'Ayer me desperté tarde,');
  assert.equal(again.lines.at(-1).translation, '¡Tuve un día muy, muy loco!');
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
