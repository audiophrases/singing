import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_SONGS } from '../js/data/songs/index.js';
import { compileSong, chordAt } from '../js/music/score.js';
import { midiToName } from '../js/music/notes.js';

const LEVELS = ['Pre-A1', 'A1', 'A2', 'B1', 'B2', 'C1'];

test('song ids are unique', () => {
  const ids = BUILTIN_SONGS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

for (const song of BUILTIN_SONGS) {
  test(`${song.id}: metadata`, () => {
    for (const k of ['id', 'title', 'artist', 'credit', 'level', 'emoji', 'bpm', 'lines']) assert.ok(song[k], `missing ${k}`);
    assert.ok(LEVELS.includes(song.level), `level ${song.level}`);
    assert.ok(Array.isArray(song.grammar) && song.grammar.length, 'grammar');
    assert.ok(Array.isArray(song.vocab) && song.vocab.length >= 3, 'vocab');
  });

  test(`${song.id}: compiles without warnings`, () => {
    const c = compileSong(song);
    assert.deepEqual(c.warnings, []);
    assert.ok(c.lines.length > 0);
    for (const l of c.lines) {
      assert.ok(l.end > l.start, `line ${l.index} has no length`);
      for (const s of l.syllables) assert.ok(s.end > s.start, `line ${l.index} syllable ${s.text}`);
    }
  });

  test(`${song.id}: melody fits the chords and voices`, () => {
    const c = compileSong(song);
    let strong = 0;
    let good = 0;
    const bad = [];
    let lo = 127;
    let hi = 0;
    for (const m of c.melody) {
      if (m.midi === null) continue;
      lo = Math.min(lo, m.midi);
      hi = Math.max(hi, m.midi);
      const beatInBar = ((m.start % c.meter) + c.meter) % c.meter;
      const isStrong = c.meter === 6 ? (beatInBar === 0 || beatInBar === 3) : c.meter === 3 ? beatInBar === 0 : (beatInBar === 0 || beatInBar === 2);
      if (!isStrong || m.beats < 0.75) continue;
      const ch = chordAt(c, m.start + 1e-6);
      if (!ch || !ch.chord) continue;
      strong += 1;
      const pcs = ch.chord.intervals.map((i) => (ch.chord.root + i) % 12);
      if (pcs.includes(m.midi % 12)) good += 1;
      else bad.push(`${midiToName(m.midi)} over ${ch.name} (line ${m.line + 1}, beat ${m.start})`);
    }
    const ratio = strong ? good / strong : 1;
    assert.ok(ratio >= 0.8, `only ${Math.round(ratio * 100)}% chord tones on strong beats:\n${bad.join('\n')}`);
    assert.ok(lo >= 52 && hi <= 79, `range ${midiToName(lo)}-${midiToName(hi)}`);
  });
}
