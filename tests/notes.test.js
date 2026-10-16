import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNoteToken, parseNotes, parseChord, parseChords, midiToName, transposeChordName, parseDuration } from '../js/music/notes.js';

test('explicit octaves', () => {
  assert.equal(parseNoteToken('C4').midi, 60);
  assert.equal(parseNoteToken('A4').midi, 69);
  assert.equal(parseNoteToken('F#3').midi, 54);
  assert.equal(parseNoteToken('Bb3').midi, 58);
  assert.equal(parseNoteToken('Cb4').midi, 59);
  assert.equal(parseNoteToken('B#4').midi, 72);
});

test('relative octaves pick the nearest note', () => {
  const ns = parseNotes('C4 G A B C D');
  assert.deepEqual(ns.map((n) => midiToName(n.midi)), ['C4', 'G3', 'A3', 'B3', 'C4', 'D4']);
  const up = parseNotes('E4 A B C');
  assert.deepEqual(up.map((n) => midiToName(n.midi)), ['E4', 'A4', 'B4', 'C5']);
});

test('durations, rests and hits', () => {
  const ns = parseNotes('C4:2 r:.5 x:1/2 D:1.5');
  assert.deepEqual(ns.map((n) => [n.kind, n.beats]), [['note', 2], ['rest', 0.5], ['hit', 0.5], ['note', 1.5]]);
  assert.equal(parseDuration('2/3'), 2 / 3);
  assert.throws(() => parseNoteToken('H4'));
  assert.throws(() => parseNoteToken('C4:0'));
});

test('chords', () => {
  assert.deepEqual(parseChord('Am7').intervals, [0, 3, 7, 10]);
  assert.equal(parseChord('Am7').root, 9);
  assert.equal(parseChord('C/E').bass, 4);
  assert.equal(parseChord('N'), null);
  assert.throws(() => parseChord('Cxyz'));
  const cs = parseChords('C F:2 G7:2', 4);
  assert.deepEqual(cs.map((c) => [c.name, c.beats]), [['C', 4], ['F', 2], ['G7', 2]]);
  assert.equal(transposeChordName('Am7/G', 2), 'Bm7/A');
  assert.equal(transposeChordName('F#', 1), 'G');
});
