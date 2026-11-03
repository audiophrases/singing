import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getKnobs, knobsOf } from '../js/controls.js';

test("a song starts from its saved Band, Key, Speed and Melody; this session's changes come on top", () => {
  const session = new Map();
  globalThis.sessionStorage = { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, v) };
  try {
    const song = { id: 'song', knobs: { rate: 0.8, transpose: 2, style: 'reggae', guide: 'robo' } };
    assert.deepEqual(getKnobs(song), song.knobs);
    session.set('singing.knobs.v1', JSON.stringify({ song: { rate: 1.1 } }));
    assert.deepEqual(getKnobs(song), { ...song.knobs, rate: 1.1 });
    assert.equal(getKnobs({ id: 'other' }).rate, 1, 'a song without settings starts at normal speed');
    assert.deepEqual(knobsOf({ kind: 'synth', rate: 0.9, transpose: -1, style: 'rock', guide: 'off' }), { rate: 0.9, transpose: -1, style: 'rock', guide: 'off' });
    assert.deepEqual(knobsOf({ kind: 'audio', rate: 1.2 }), { rate: 1.2 }, 'recordings keep only their speed');
  } finally { delete globalThis.sessionStorage; }
});
