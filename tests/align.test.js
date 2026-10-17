import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RATE, features, alignNotes, alignRecordings, toMono } from '../js/media/align.js';

// A made-up song: a sung melody, chords changing every 2 s, and clicks for drums.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const LEN = 45;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

function melody(seed) {
  const r = rng(seed);
  const notes = [];
  let t = 2;
  while (t < LEN - 8) {
    const d = 0.2 + r() * 0.4;
    notes.push([t, t + d, 57 + Math.floor(r() * 20)]);
    t += d + (r() < 0.2 ? 0.8 : 0.05);
  }
  return notes;
}

function render({ notes = [], shift = 0, chords = true, clicks = 0, clickShift = 0, seed = 1 }) {
  const out = new Float32Array(LEN * RATE);
  const r = rng(seed);
  const tone = (f, from, to, amp, harmonics = [1, 0.5, 0.25]) => {
    const a = Math.max(0, Math.floor(from * RATE));
    const b = Math.min(out.length, Math.floor(to * RATE));
    for (let i = a; i < b; i += 1) {
      const env = Math.min(1, (i - a) / 200, (b - i) / 200);
      let v = 0;
      harmonics.forEach((h, k) => { v += h * Math.sin((2 * Math.PI * f * (k + 1) * i) / RATE); });
      out[i] += amp * env * v;
    }
  };
  for (const [s, e, m] of notes) tone(hz(m), s + shift, e + shift, 0.3);
  if (chords) {
    const cr = rng(99);
    for (let t = 0; t < LEN; t += 2) {
      const root = 48 + Math.floor(cr() * 12);
      for (const iv of [0, 4, 7]) tone(hz(root + iv), t + clickShift, t + 2 + clickShift, 0.06, [1, 0.3]);
    }
  }
  if (clicks) {
    const cr = rng(clicks);
    let t = 0.3;
    while (t < LEN) {
      const a = Math.floor((t + clickShift) * RATE);
      for (let i = 0; i < 400 && a + i < out.length; i += 1) if (a + i >= 0) out[a + i] += (cr() * 2 - 1) * 0.5 * (1 - i / 400);
      t += 0.25 + cr() * 0.5;
    }
  }
  for (let i = 0; i < out.length; i += 1) out[i] += (r() * 2 - 1) * 0.01;
  return out;
}

test('alignNotes finds where the melody is sung', () => {
  const notes = melody(7);
  const res = alignNotes(features(render({ notes, shift: 3.2, clicks: 5 })), notes);
  assert.ok(res.confident, JSON.stringify(res));
  assert.ok(Math.abs(res.offset - 3.2) <= 0.05, `offset ${res.offset}`);
  const early = alignNotes(features(render({ notes, shift: -1.5, clicks: 5 })), notes);
  assert.ok(early.confident && Math.abs(early.offset + 1.5) <= 0.05, JSON.stringify(early));
});

test('alignNotes is not fooled by music without that melody', () => {
  const notes = melody(7);
  const res = alignNotes(features(render({ notes: melody(8), clicks: 5 })), notes);
  assert.ok(!res.confident, JSON.stringify(res));
  assert.ok(!alignNotes(features(render({ clicks: 5 })), notes).confident);
});

test('alignRecordings lines up a karaoke version of the same recording', () => {
  const notes = melody(7);
  const song = features(render({ notes, clicks: 11 }));
  const karaoke = features(render({ clicks: 11, clickShift: 0.37, seed: 2 }));
  const res = alignRecordings(song, karaoke);
  assert.ok(res.confident, JSON.stringify(res));
  assert.ok(Math.abs(res.offset - 0.37) <= 0.03, `offset ${res.offset}`);
  assert.ok(res.drift <= 0.05);
});

test('a karaoke version whose channels cancel out is still heard', () => {
  const side = render({ clicks: 11, clickShift: 0.37, seed: 2 });
  const opposite = side.map((v) => -v);
  const mono = toMono([side, opposite]);
  assert.ok(mono.some((v) => Math.abs(v) > 0.1), 'not silence');
  const res = alignRecordings(features(render({ notes: melody(7), clicks: 11 })), features(mono));
  assert.ok(res.confident && Math.abs(res.offset - 0.37) <= 0.03, JSON.stringify(res));
  // Normal stereo still mixes to the average.
  assert.equal(toMono([new Float32Array([0.2, 0.4]), new Float32Array([0.4, 0.2])])[0].toFixed(2), '0.30');
});

test('alignRecordings says so when the karaoke version is another recording', () => {
  const song = features(render({ notes: melody(7), clicks: 11 }));
  const other = features(render({ clicks: 12, chords: false, seed: 3 }));
  assert.ok(!alignRecordings(song, other).confident);
});
