import test from 'node:test';
import assert from 'node:assert/strict';
import { phonemes, syllablePhones, cleanWord } from '../js/lyrics/phonemes.js';
import { compileSong } from '../js/music/score.js';
import { melodyEvents } from '../js/music/band.js';

const shape = (list) => list.map((x) => `${x.on}|${x.nu}|${x.co}`);

test('dictionary words', () => {
  assert.equal(phonemes('night'), 'nYt');
  assert.equal(phonemes('Twinkle,'), 'twINk^l');
  assert.equal(phonemes("I'm"), 'Ym');
});

test('inflections of dictionary words', () => {
  assert.equal(phonemes('zebras'), 'zibr^z');
  assert.equal(phonemes('skateboarding'), 'sketbcrdIN');
});

test('spelling rules for unknown words', () => {
  assert.equal(phonemes('blorp'), 'blcrp');
  assert.equal(phonemes('splink'), 'splINk');
  assert.equal(phonemes(''), '');
  assert.equal(cleanWord('“Hello!”'), 'hello');
});

test('phones follow the song\'s own syllables', () => {
  assert.deepEqual(shape(syllablePhones('yesterday', ['yes', 'ter', 'day'])), ['y|E|s', 't|R|', 'd|e|']);
  assert.deepEqual(shape(syllablePhones('Twinkle,', ['Twin', 'kle,'])), ['tw|I|N', 'k|^|l']);
  assert.deepEqual(shape(syllablePhones('animal', ['an', 'i', 'mal'])), ['|@|n', '|^|', 'm|^|l']);
  assert.deepEqual(shape(syllablePhones('star', ['star'])), ['st|a|r']);
  // More vowels than written syllables: they share one.
  assert.deepEqual(shape(syllablePhones('fire', ['fire'])), ['f|YR|']);
});

test('robot notes carry phones and first/last flags through melismas', () => {
  const song = {
    id: 't', bpm: 100, meter: 4, intro: '',
    lines: [{ t: 'Hel-lo _ star', n: 'C4 D E F:2', c: 'C:2 C:2' }],
  };
  const ev = melodyEvents(compileSong(song), 'robo');
  assert.deepEqual(ev.map((e) => [e.text, e.first, e.last]), [
    ['Hel', true, true], ['lo', true, false], ['lo', false, true], ['star', true, true],
  ]);
  assert.deepEqual(shape(ev.map((e) => e.ph)), ['h|^|', 'l|o|', 'l|o|', 'st|a|r']);
  // Other guide instruments don't need phones.
  assert.equal(melodyEvents(compileSong(song), 'flute')[0].ph, null);
});
