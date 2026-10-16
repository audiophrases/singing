import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSong } from '../js/music/score.js';
import { arrange, melodyEvents, voiceChord, STYLES } from '../js/music/band.js';
import { parseChord } from '../js/music/notes.js';

const song = {
  id: 't', meter: 4, intro: 'C',
  lines: [
    { t: 'Twin-kle, twin-kle, lit-tle star,', n: 'C4 C G G A A G:2', c: 'C F:2 C:2' },
    { t: 'clap your hands 👏 👏', n: 'G4 G G x:.5 x:1.5 r:4', c: 'G7 C' },
  ],
};

test('voicings stay in range and move little', () => {
  const c = voiceChord(parseChord('C'), null);
  assert.ok(c.every((n) => n >= 53 && n <= 77), String(c));
  const f = voiceChord(parseChord('F'), c);
  const moved = f.reduce((a, n, i) => a + Math.abs(n - c[i]), 0);
  assert.ok(moved <= 6, `moved ${moved}: ${c} -> ${f}`);
});

test('every style arranges every meter without errors', () => {
  const c = compileSong(song);
  for (const id of Object.keys(STYLES)) {
    for (const meter of [2, 3, 4, 6]) {
      const ev = arrange({ ...c, meter }, id);
      assert.ok(Array.isArray(ev));
      for (const e of ev) {
        assert.ok(Number.isFinite(e.t), `${id}/${meter} bad t`);
        if (e.inst) assert.ok(Number.isFinite(e.midi) && e.d > 0, `${id}/${meter} bad note ${JSON.stringify(e)}`);
      }
    }
    assert.ok(arrange(c, id).length > 0 || id === 'musicbox');
  }
});

test('melody events: hits become claps, notes carry syllables', () => {
  const c = compileSong(song);
  const ev = melodyEvents(c, 'robo');
  assert.equal(ev.filter((e) => e.drum === 'clap').length, 2);
  assert.equal(ev.find((e) => e.inst).text, 'Twin');
  assert.equal(melodyEvents(c, 'off').filter((e) => e.inst).length, 0);
});
