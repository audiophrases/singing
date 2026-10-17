import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTimingFile, detectFormat, decodeText, shiftSynced } from '../js/media/timing.js';
import { timelineFromSynced, fillTimes, wordsFromNotes } from '../js/music/timeline.js';
import { parseLyrics, lyricsText } from '../js/lyrics/lines.js';
import { gameById, gameFits } from '../js/games/index.js';

const ULTRASTAR = [
  '#TITLE:Twinkle',
  '#ARTIST:Trad',
  '#MP3:twinkle.mp3',
  '#BPM:300',
  '#GAP:1000',
  '#VIDEO:v=dQw4w9WgXcQ,co=cover.jpg',
  ': 0 4 0 Twin',
  ': 4 4 0 kle ',
  ': 8 4 7  twin',
  ': 12 4 7 kle',
  '* 16 4 9  lit',
  ': 20 4 9 tle',
  ': 24 8 7  star',
  ': 32 4 5 ~',
  '- 40',
  ': 40 4 5 How',
  'F 44 4 5  I',
  ': 48 4 4  won',
  ': 52 4 4 der',
  'E',
].join('\n');

test('formats are told apart', () => {
  assert.equal(detectFormat(ULTRASTAR), 'ultrastar');
  assert.equal(detectFormat('[00:01.00]Hello'), 'lrc');
  assert.equal(detectFormat('1\n00:00:01,000 --> 00:00:02,000\nHi'), 'srt');
  assert.equal(detectFormat('WEBVTT\n\n00:01.000 --> 00:02.000\nHi'), 'vtt');
  assert.equal(detectFormat('Twinkle twinkle\nlittle star'), 'text');
});

test('UltraStar: times, syllables, words, notes', () => {
  const r = readTimingFile(ULTRASTAR, 'twinkle.txt');
  assert.equal(r.format, 'ultrastar');
  assert.deepEqual([r.meta.title, r.meta.artist, r.meta.audio, r.meta.youtubeId], ['Twinkle', 'Trad', 'twinkle.mp3', 'dQw4w9WgXcQ']);
  assert.ok(r.notes);
  assert.deepEqual(r.lines.map((l) => l.text), ['Twinkle twinkle little star', 'How I wonder']);
  // GAP 1 s, then a beat is 60 / (300 * 4) = 0.05 s.
  const [a, b] = r.lines;
  assert.equal(a.start, 1);
  assert.deepEqual(a.notes[0], [1, 1.2, 60, 'Twin']);
  assert.deepEqual(a.notes[4], [1.8, 2, 69, ' lit', 1]);
  assert.equal(b.notes[1][2], null, 'freestyle notes have no pitch');
  assert.ok(a.end > 2.8 && a.end <= b.start);

  const tl = timelineFromSynced(r.lines, 0);
  const l0 = tl.lines[0];
  assert.deepEqual(l0.words.map((w) => w.syllables.map((s) => s.text)), [['Twin', 'kle'], ['twin', 'kle'], ['lit', 'tle'], ['star']]);
  const star = l0.words[3].syllables[0];
  assert.deepEqual([star.start, star.end, star.midi], [2.2, 2.8, 67], '"~" holds the syllable before');
  assert.equal(l0.singStart, 1);
  assert.equal(l0.singEnd, 2.8);
  assert.equal(l0.notes.length, 8);
  assert.equal(l0.notes.filter((n) => n.golden).length, 1);
  assert.equal(l0.notes[7].text, '', 'held notes have no label');
  assert.equal(tl.lines[1].notes.length, 3);
});

test('UltraStar: relative beats, comma decimals, duets', () => {
  const rel = readTimingFile('#TITLE:x\n#BPM:150,0\n#GAP:0\n#RELATIVE:yes\n: 0 2 0 One\n- 4 10\n: 0 2 2 Two\nE');
  assert.deepEqual(rel.lines.map((l) => l.start), [0, 1]);
  const duet = readTimingFile([
    '#TITLE:d', '#BPM:300', '#GAP:0', '#P1:Elsa', '#P2:Anna Maria',
    'P1', ': 0 4 0 Hi', '- 8', ': 40 4 0 Both', 'P2', ': 20 4 0 Hey', '- 30', ': 40 4 0 Both', 'E',
  ].join('\n'));
  assert.deepEqual(duet.lines.map((l) => [l.text, l.part]), [['Hi', 'Elsa'], ['Hey', 'B'], ['Both', '']]);
});

test('LRC: offset, repeated stamps, word times, sections, blank stamps end lines', () => {
  const r = readTimingFile([
    '[ti:Song]', '[ar:Band]', '[offset:500]',
    '[00:10.00]<00:10.00>Hello <00:10.50>world <00:11.20>again<00:12.00>',
    '[00:12.50]',
    '[00:15.00][01:15.00]Repeat line',
    '[00:18.00][Chorus]',
    '[00:20.00]Last line',
  ].join('\n'), 'a.lrc');
  assert.deepEqual([r.meta.title, r.meta.artist], ['Song', 'Band']);
  assert.ok(r.words);
  assert.deepEqual(r.lines.map((l) => [l.text, l.start]), [['Hello world again', 9.5], ['Repeat line', 14.5], ['Last line', 19.5], ['Repeat line', 74.5]]);
  assert.deepEqual(r.lines[0].words.map((w) => w.start), [9.5, 10, 10.7]);
  assert.equal(r.lines[0].end, 11.5);
  assert.equal(r.lines[1].end, 17.5);
  assert.equal(r.lines[2].section, 'Chorus');
  const tl = timelineFromSynced(r.lines, 0);
  assert.deepEqual(tl.lines[0].words.map((w) => w.start), [9.5, 10, 10.7]);
});

test('SRT: tags and symbols go, two-line cues split, [Music] skipped, title from the file name', () => {
  const r = readTimingFile([
    '1', '00:00:01,000 --> 00:00:04,000', '<i>♪ First line here ♪</i>', 'Second one', '',
    '2', '00:00:05,000 --> 00:00:06,500', '[Music]', '',
    '3', '00:00:07,000 --> 00:00:09,000', '{\\an8}- Third line',
  ].join('\r\n'), 'Queen - We Will Rock You.srt');
  assert.deepEqual([r.meta.artist, r.meta.title], ['Queen', 'We Will Rock You']);
  assert.deepEqual(r.lines.map((l) => [l.text, l.start, l.end]), [['First line here', 1, 2.5], ['Second one', 2.5, 4], ['Third line', 7, 9]]);
});

test('WebVTT: rolling captions are not doubled and keep their word times', () => {
  const r = readTimingFile([
    'WEBVTT', 'Kind: captions', '',
    '00:00:01.000 --> 00:00:03.000 align:start position:0%', 'hello<00:00:01.500><c> there</c><00:00:02.000><c> friend</c>', '',
    '00:00:03.000 --> 00:00:03.010', 'hello there friend', '',
    '00:00:03.010 --> 00:00:05.000', 'hello there friend', 'how<00:00:03.500><c> are</c><00:00:04.000><c> you</c>',
  ].join('\n'), 'b.vtt');
  assert.deepEqual(r.lines.map((l) => [l.text, l.start, l.end]), [['hello there friend', 1, 3], ['how are you', 3.01, 5]]);
  assert.deepEqual(r.lines[1].words.map((w) => w.start), [undefined, 3.5, 4]);
});

test('text encodings', () => {
  assert.equal(decodeText(new TextEncoder().encode('﻿café')), 'café');
  assert.equal(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9])), 'café', 'Windows-1252');
});

test('shifting moves lines, words and notes', () => {
  const r = readTimingFile(ULTRASTAR);
  const s = shiftSynced(r.lines, -1.5);
  assert.equal(s[0].start, 0, 'never before 0');
  assert.equal(s[1].start, 1.5);
  assert.deepEqual(s[1].notes[0].slice(0, 3), [1.5, 1.7, 65]);
  assert.equal(r.lines[1].start, 3, 'the original is untouched');
});

test('lines without a time get one between their neighbours', () => {
  const f = fillTimes([{ text: 'a b c', start: 10 }, { text: 'new line here' }, { text: 'd e f', start: 20 }]);
  assert.ok(f[1].start > 10 && f[1].start < 20);
  const none = fillTimes([{ text: 'one' }, { text: 'two' }]);
  assert.ok(none[0].start === 2 && none[1].start > none[0].end);
  const tail = fillTimes([{ text: 'x', start: 5, end: 7 }, { text: 'y' }]);
  assert.ok(tail[1].start > 7);
  // Before, one untimed line threw all the timing away.
  const tl = timelineFromSynced([{ text: 'a', start: 10 }, { text: 'b' }, { text: 'c', start: 20 }], 0);
  assert.equal(tl.lines.length, 3);
  assert.equal(tl.lines[2].start, 20);
});

test('editing the lyrics keeps the timing', () => {
  const r = readTimingFile(ULTRASTAR);
  const text = lyricsText(r.lines);
  // Unchanged: everything kept, notes included.
  assert.deepEqual(parseLyrics(text, r.lines), r.lines);
  // A line added at the top and one edited: the rest keep their notes.
  const edited = parseLyrics(`[Intro]\nNew first line\n${text.replace('How I wonder', 'How I wonder what')}`, r.lines);
  assert.equal(edited.length, 3);
  assert.equal(edited[0].start, undefined);
  assert.equal(edited[0].section, 'Intro');
  assert.deepEqual(edited[1].notes, r.lines[0].notes);
  assert.equal(edited[2].text, 'How I wonder what');
  assert.equal(edited[2].start, 3, 'edited in place: same start');
  assert.equal(edited[2].notes, undefined, 'but the notes no longer fit');
  // A lyric that looks like a part label survives the round trip.
  const odd = [{ text: 'Baby: I love you', start: 1 }];
  assert.deepEqual(parseLyrics(lyricsText(odd), odd), odd);
});

test('Pitch Pal fits band songs and songs with notes', () => {
  const pitch = gameById('pitch');
  assert.ok(gameFits(pitch, { source: 'band' }, 4));
  assert.ok(!gameFits(pitch, { source: 'audio', synced: [{ text: 'x', start: 1 }] }, 4));
  assert.ok(gameFits(pitch, { source: 'audio', synced: readTimingFile(ULTRASTAR).lines }, 4));
});

test('notes to words', () => {
  const w = wordsFromNotes([[0, 1, 60, 'I '], [1, 2, 62, 'love'], [2, 3, 64, ' you'], [3, 4, 62, '~ ']]);
  assert.deepEqual(w.map((x) => [x.text, x.start, x.end]), [['I', 0, 1], ['love', 1, 2], ['you', 2, 4]]);
});
