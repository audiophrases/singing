import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSong, splitLyric, lyricTokens, fitNotes, countSyllables, chordAt } from '../js/music/score.js';
import { parseNotes } from '../js/music/notes.js';

const twinkle = {
  id: 'twinkle', meter: 4, intro: 'C',
  lines: [
    { t: 'Twin-kle, twin-kle, lit-tle star,', n: 'C4 C G G A A G:2', c: 'C F:2 C:2' },
    { t: 'How I won-der what you are.', n: 'F F E E D D C:2', c: 'F:2 C:2 G:2 C:2' },
  ],
};

test('syllables and words', () => {
  const w = splitLyric('Twin-kle, star _ bye=bye');
  assert.equal(w.length, 4);
  assert.deepEqual(w[0].syllables, ['Twin', 'kle,']);
  assert.ok(w[2].melisma);
  assert.deepEqual(w[3].syllables, ['bye-bye']);
  assert.equal(countSyllables('Twin-kle, twin-kle, lit-tle star,'), 7);
  assert.equal(lyricTokens('a-b c')[1].last, true);
});

test('compile: timing, words and chords', () => {
  const c = compileSong(twinkle);
  assert.equal(c.warnings.length, 0, c.warnings.join('\n'));
  assert.equal(c.introBeats, 4);
  assert.equal(c.lines[0].start, 4);
  assert.equal(c.lines[0].end, 12);
  assert.equal(c.lines[1].start, 12);
  assert.equal(c.lines[0].text, 'Twinkle, twinkle, little star,');
  assert.equal(c.lines[0].words.length, 4);
  assert.equal(c.lines[0].syllables[6].text, 'star,');
  assert.equal(c.lines[0].syllables[6].end - c.lines[0].syllables[6].start, 2);
  assert.equal(chordAt(c, 8.5).name, 'F');
  assert.equal(chordAt(c, 10).name, 'C');
  assert.equal(c.totalBeats, 24);
  // Intro C and the line's first C merge into one strike? No: line chords are new strikes.
  assert.ok(c.chords.length >= 6);
});

test('melisma holds a syllable over notes', () => {
  const c = compileSong({ id: 'm', intro: 'C', lines: [{ t: 'Oh _ yeah', n: 'C4 D E:2', c: 'C' }] });
  assert.equal(c.lines[0].syllables.length, 2);
  assert.equal(c.lines[0].syllables[0].notes.length, 2);
  assert.equal(c.lines[0].syllables[0].end, 6);
});

test('fitNotes splits and holds', () => {
  const tune = parseNotes('C4 D E:2');
  const more = fitNotes(tune, 4);
  assert.equal(more.filter((n) => !n.hold && n.kind !== 'rest').length, 4);
  assert.equal(more.reduce((a, n) => a + n.beats, 0), 4);
  const fewer = fitNotes(parseNotes('C4 C D E'), 2);
  assert.equal(fewer.filter((n) => !n.hold && n.kind !== 'rest').length, 2);
  assert.equal(fewer.reduce((a, n) => a + n.beats, 0), 4);
});

test('phrases are reused and bent to fit', () => {
  const song = {
    id: 'mac', meter: 4, intro: 'G',
    phrases: { A: { n: 'G4 G G D E E D:2', c: 'G C:2 G:2' } },
    lines: [{ t: 'Old Mac-Don-ald had a farm', p: 'A' }, { t: 'And on that farm he had a cow', p: 'A' }],
  };
  const c = compileSong(song);
  assert.equal(c.lines[1].syllables.length, 8);
  assert.equal(c.lines[1].end - c.lines[1].start, 8);
});

test('pickup lines start before the downbeat', () => {
  const c = compileSong({ id: 'hb', meter: 3, pickup: 1, intro: 'C:3', lines: [{ t: 'Hap-py birth-day to you', n: 'G4:.75 G:.25 A G C5 B4:2', c: 'C:3 G:2' }] });
  assert.equal(c.lines[0].start, 2);
  assert.equal(c.lines[0].syllables[2].start, 3);
  assert.equal(chordAt(c, 1).name, 'C');
});

test('line pickups borrow from the previous line', () => {
  const c = compileSong({
    id: 'pk', meter: 4, intro: 'C',
    lines: [
      { t: 'Dash-ing through the snow', n: 'G3 E4 D C G3:4', c: 'C C' },
      { t: 'In a one-horse o-pen sleigh', pk: 1, n: 'G3:.5 G:.5 G E4 D C A3:4', c: 'C F' },
    ],
  });
  assert.equal(c.warnings.length, 0, c.warnings.join('\n'));
  assert.equal(c.lines[0].end, 11);
  assert.equal(c.lines[1].start, 11);
  assert.equal(c.lines[0].syllables[4].end, 11);
  assert.equal(c.lines[1].syllables[2].start, 12);
  assert.equal(chordAt(c, 11.5).name, 'C');
  assert.equal(chordAt(c, 16.5).name, 'F');
});
