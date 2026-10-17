import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeSong, placeRhythm, MOODS } from '../js/music/composer.js';
import { compileSong, chordAt } from '../js/music/score.js';
import { syllabify, lineSyllables, hyphenate } from '../js/lyrics/syllables.js';

const TEXT = `I like apples, I like pears,
I like walking up the stairs.
Monday, Tuesday, Wednesday too,
What about you? What about you?

My cat is black, my dog is brown,
We all go dancing into town!`;

test('syllables', () => {
  assert.deepEqual(syllabify('little'), ['lit', 'tle']);
  assert.deepEqual(syllabify('Twinkle,'), ['Twin', 'kle,']);
  assert.deepEqual(syllabify('birthday'), ['birth', 'day']);
  assert.deepEqual(syllabify('played'), ['played']);
  assert.deepEqual(syllabify('wanted'), ['wan', 'ted']);
  assert.equal(hyphenate('Happy birthday to you'), 'Hap-py birth-day to you');
  const ls = lineSyllables('I went to the zoo');
  assert.equal(ls.find((s) => s.text === 'zoo').stress, 2);
});

test('rhythm puts stressed syllables on beats', () => {
  const syls = lineSyllables('Yesterday I went to the zoo');
  const pos = placeRhythm(syls, 16, 8, () => 0.5);
  assert.equal(pos.length, syls.length);
  for (let i = 1; i < pos.length; i += 1) assert.ok(pos[i] > pos[i - 1]);
  syls.forEach((s, i) => { if (s.stress === 2) assert.equal(pos[i] % 2, 0, `${s.text} off the beat`); });
});

for (const mood of Object.keys(MOODS)) {
  test(`composed song compiles cleanly (${mood})`, () => {
    for (const seed of [1, 2, 3, 42]) {
      const song = composeSong(TEXT, { mood, seed, title: 'Test' });
      const c = compileSong(song);
      assert.deepEqual(c.warnings, [], `${mood}/${seed}: ${c.warnings.join('; ')}`);
      assert.equal(c.lines.length, 6);
      // Last note of the song is the tonic.
      const last = c.melody[c.melody.length - 1];
      const keyPc = { C: 0, A: 9 }[song.key];
      assert.equal(last.midi % 12, keyPc, `${mood}/${seed} ends on ${last.midi}`);
      // Most strong-beat notes are chord tones.
      let strong = 0;
      let good = 0;
      for (const m of c.melody) {
        if (m.midi === null || (m.start % 2) !== 0 || m.beats < 1) continue;
        const ch = chordAt(c, m.start + 1e-6);
        if (!ch || !ch.chord) continue;
        strong += 1;
        if (ch.chord.intervals.map((iv) => (ch.chord.root + iv) % 12).includes(m.midi % 12)) good += 1;
      }
      assert.ok(!strong || good / strong >= 0.7, `${mood}/${seed}: ${good}/${strong}`);
    }
  });
}

test('same-shape lines share a tune', () => {
  const song = composeSong('What about you?\nWhat about me?\nWhat about you?\nWhat about me?', { seed: 5 });
  assert.equal(song.lines[0].n, song.lines[2].n);
});

test('a very long line is split into singable lines', () => {
  const text = `${Array(13).fill('around the world').join(', ')}.`;
  const song = composeSong(text, { mood: 'disco', key: 'A', seed: 1 });
  const c = compileSong(song);
  assert.deepEqual(c.warnings, []);
  assert.ok(c.lines.length >= 4, `${c.lines.length} lines`);
  for (const l of c.lines) assert.ok(l.syllables.length <= 16, l.text);
  assert.equal(c.lines.map((l) => l.text).join(' ').split('world').length - 1, 13);
  // A long line with no commas at all.
  const plain = composeSong(Array(30).fill('la').join(' '), { seed: 2 });
  assert.deepEqual(compileSong(plain).warnings, []);
});

test('lyrics advice explains problems before composing', async () => {
  const { checkLyrics } = await import('../js/music/composer.js');
  assert.equal(checkLyrics('').ok, false);
  assert.equal(checkLyrics('🎵 123').ok, false);
  const long = checkLyrics(`${Array(13).fill('around the world').join(', ')}.`);
  assert.equal(long.ok, true);
  assert.equal(long.lines, 5);
  assert.ok(long.notes.some((n) => n.level === 'warn' && /Line 1 is long/.test(n.text)));
  assert.equal(checkLyrics(Array(70).fill('one two three four').join('\n')).ok, false);
  const good = checkLyrics('I like apples, I like pears,\nI like walking up the stairs.');
  assert.deepEqual(good.notes.map((n) => n.level), ['ok']);
  assert.ok(checkLyrics('Me gusta la canción').notes.some((n) => /canción/.test(n.text)));
});
