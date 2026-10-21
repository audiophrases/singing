import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSong } from '../js/music/score.js';
import { melodyEvents, linkNotes, GUIDES } from '../js/music/band.js';
import { INSTRUMENT_NAMES, makeCeilingCurve } from '../js/music/synth.js';
import { onsetLead, PROFILES } from '../js/music/singer.js';
import { loudness, matchGains } from '../js/media/loudness.js';
import { wordsHeard } from '../js/lyrics/text.js';
import { stressVowel } from '../js/lyrics/phonemes.js';

const twinkle = {
  id: 't', bpm: 100, meter: 4, intro: '',
  lines: [{ t: 'Twin-kle, twin-kle, lit-tle star,', n: 'C4 C G G A A G:2', c: 'C F:2 C:2' }],
};

test('every robot voice is an instrument, the original included', () => {
  for (const id of ['robo', 'roboclear', 'roboclassic']) assert.ok(INSTRUMENT_NAMES.includes(GUIDES[id].inst), id);
  assert.equal(GUIDES.roboclassic.inst, 'roboClassic');
});

test('robot notes carry word stress', () => {
  const ev = melodyEvents(compileSong(twinkle), 'robo');
  assert.deepEqual(ev.map((e) => e.stress), [2, 0, 2, 0, 2, 0, 2]);
  assert.deepEqual(ev.map((e) => e.wordStart), [true, false, true, false, true, false, true]);
  const small = melodyEvents(compileSong({ ...twinkle, lines: [{ t: 'Up a-bove the world', n: 'C4 D E F G' }] }), 'robo');
  // "Up" and "the" are small words; a-BOVE is stressed on its second syllable.
  assert.deepEqual(small.map((e) => e.stress), [1, 0, 2, 1, 2]);
});

test('word stress comes from the dictionary, endings included', () => {
  assert.equal(stressVowel('banana'), 1);
  assert.equal(stressVowel('Bananas!'), 1);
  assert.equal(stressVowel('polar'), 0);
  assert.equal(stressVowel('macdonald'), 1);
  assert.equal(stressVowel('blorptastic'), null);
  // "Ma-ry", "ba-bies": first syllable, where the old prefix rule said second.
  const mary = melodyEvents(compileSong({ ...twinkle, lines: [{ t: 'Ma-ry had ba-bies', n: 'C4 D E F G' }] }), 'robo');
  assert.deepEqual(mary.map((e) => e.stress), [2, 0, 1, 2, 0]);
});

test('robot notes know their neighbours, so they can hand over', () => {
  const ev = melodyEvents(compileSong(twinkle), 'robo');
  // "Twin" -> "kle": the next onset is "k", inside the same word.
  assert.equal(ev[0].nt, 1);
  assert.equal(ev[0].nextOn, 'k');
  assert.equal(ev[0].nextWord, false);
  assert.equal(ev[1].nextWord, true);
  assert.equal(ev[1].pt, 1);
  assert.equal(ev[1].prevMidi, ev[0].midi);
  // The last note has nothing after it.
  assert.equal(ev.at(-1).nt, undefined);
  // Other guides get none of this; the original robot keeps its phones.
  assert.equal(melodyEvents(compileSong(twinkle), 'flute')[0].nt, undefined);
  assert.equal(melodyEvents(compileSong(twinkle), 'roboclassic')[0].ph.on, 'tw');
});

test('a rest breaks the hand-over', () => {
  const a = { t: 0, first: true, ph: { on: 's' }, wordStart: true, midi: 60 };
  const b = { t: 2, first: true, ph: { on: 't' }, wordStart: true, midi: 62 };
  linkNotes([[a, 1], [b, 1]]);
  assert.equal(a.nt, undefined);
  assert.equal(b.pt, undefined);
});

test('onsets start before the beat, but never steal much of a short note', () => {
  const P = PROFILES.sing;
  assert.equal(onsetLead('', 1, P), 0);
  const pin = onsetLead('p', 0, P);
  assert.ok(pin > 0.05 && pin <= P.leadMax, `p leads by ${pin}`);
  // An aspirated "p" leads more than "b" (its puff of air comes before the vowel).
  assert.ok(pin > onsetLead('b', 0, P));
  assert.ok(onsetLead('str', 0.1, P) <= 0.04 + 1e-9);
  // Clear English takes longer over its consonants.
  assert.ok(onsetLead('s', 0, PROFILES.clear) > onsetLead('s', 0, P));
});

test('the master ceiling leaves normal levels alone and never goes past full scale', () => {
  const curve = makeCeilingCurve();
  const n = curve.length;
  // The curve spans inputs -4..4; the WaveShaper interpolates between points.
  const at = (x) => {
    const p = ((x / 4 + 1) / 2) * (n - 1);
    const i = Math.min(n - 2, Math.floor(p));
    return curve[i] + (curve[i + 1] - curve[i]) * (p - i);
  };
  for (const x of [0, 0.25, -0.5, 0.89]) assert.ok(Math.abs(at(x) - x) < 1e-6, `${x} -> ${at(x)}`);
  for (const x of [1, 1.5]) assert.ok(at(x) < 1 && at(x) > 0.9, `${x} -> ${at(x)}`);
  assert.ok(at(4) <= 1);
  for (let i = 1; i < n; i += 1) assert.ok(curve[i] >= curve[i - 1]);
});

test('loudness: a full-scale 1 kHz sine reads -3 LUFS', () => {
  const rate = 48000;
  const sine = Float32Array.from({ length: rate * 2 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / rate));
  assert.ok(Math.abs(loudness([sine], rate) + 3.01) < 0.1, `${loudness([sine], rate)}`);
  const quiet = sine.map((x) => x / 2);
  assert.ok(Math.abs(loudness([quiet], rate) - loudness([sine], rate) + 6.02) < 0.1);
  assert.equal(loudness([new Float32Array(rate)], rate), -Infinity);
});

test('matched gains bring versions to one loudness without clipping', () => {
  const g = matchGains([{ lufs: -10, peak: 0.9 }, { lufs: -16, peak: 0.3 }]);
  assert.ok(Math.abs((-10 + 20 * Math.log10(g[0])) - (-16 + 20 * Math.log10(g[1]))) < 1e-9);
  assert.ok(0.9 * g[0] <= 0.95 + 1e-9 && 0.3 * g[1] <= 0.95 + 1e-9);
});

test('dictation scoring counts the words heard, in order', () => {
  assert.deepEqual(wordsHeard('the heavy rabit paints', 'The heavy rabbit paints the window.'), { right: 4, of: 6 });
  assert.deepEqual(wordsHeard('', 'Hello'), { right: 0, of: 1 });
  assert.deepEqual(wordsHeard("I'm happy", 'Im happy!'), { right: 2, of: 2 });
  assert.deepEqual(wordsHeard('window the', 'the window'), { right: 1, of: 2 });
});
