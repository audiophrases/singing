import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioTrack } from '../js/media/audio.js';

function track(stems = false) {
  const t = Object.create(AudioTrack.prototype);
  Object.assign(t, { song: { audio: { stems } }, audio: { volume: 1 }, kar: stems ? null : { volume: 0 }, voc: { volume: 0 },
    singer: true, leadMuted: false, vocalsOnly: false, vocalGuide: 0, handlers: {} });
  return t;
}

test('recordings switch between original, karaoke and vocals, including temporary game muting', () => {
  const t = track();
  const levels = () => [t.audio.volume, t.kar.volume, t.voc.volume];
  t.applyVoice();
  assert.deepEqual(levels(), [1, 0, 0]);
  t.setSinger(false);
  assert.deepEqual(levels(), [0, 1, 0]);
  t.setSinger(true);
  t.setVocalsOnly(true);
  assert.deepEqual(levels(), [0, 0, 1]);
  t.setMute('lead', true);
  assert.deepEqual(levels(), [0, 1, 0]);
  t.setMute('lead', false);
  assert.deepEqual(levels(), [0, 0, 1]);
});

test('clean version: the singer drops out on the word and the karaoke version carries on', () => {
  const t = track();
  t.cleanSpans = [[10, 11]];
  let now = 5;
  t.time = () => now;
  const levels = () => [t.audio.volume, t.kar.volume, t.voc.volume];
  t.applyVoice();
  t.watchClean();
  assert.deepEqual(levels(), [1, 0, 0]);
  now = 10.5;
  t.watchClean();
  assert.deepEqual(levels(), [0, 1, 0]);
  now = 11;
  t.watchClean();
  assert.deepEqual(levels(), [1, 0, 0]);
  now = 9.97;
  t.watchClean();
  assert.deepEqual(levels(), [0, 1, 0], 'it starts a moment early: the word must not be heard');
});

test('clean version: vocal help, vocals only, stems, and no karaoke version', () => {
  const t = track();
  t.cleanSpans = [[10, 11]];
  t.time = () => 10.5;
  t.setVocalsOnly(true);
  t.watchClean();
  assert.deepEqual([t.audio.volume, t.kar.volume, t.voc.volume], [0, 0, 0], 'nothing else is playing');
  const guided = track();
  Object.assign(guided, { singer: false, vocalGuide: 0.5, cleanHidden: true });
  guided.applyVoice();
  assert.deepEqual([guided.audio.volume, guided.kar.volume, guided.voc.volume], [0, 1, 0], 'the guide voice drops out too');
  const stems = track(true);
  stems.cleanHidden = true;
  stems.applyVoice();
  assert.deepEqual([stems.audio.volume, stems.voc.volume], [1, 0], 'the instrumental carries on');
  const plain = track();
  plain.kar = null;
  plain.voc = null;
  plain.cleanHidden = true;
  plain.applyVoice();
  assert.equal(plain.audio.volume, 0, 'with no karaoke version all the sound dips');
  plain.cleanHidden = false;
  plain.applyVoice();
  assert.equal(plain.audio.volume, 1);
});

test('a stem pair combines instrumental and vocals for the song and supports both solo modes', () => {
  const t = track(true);
  t.applyVoice();
  assert.deepEqual([t.audio.volume, t.voc.volume], [1, 1]);
  t.setSinger(false);
  assert.deepEqual([t.audio.volume, t.voc.volume], [1, 0]);
  t.setSinger(true);
  t.setVocalsOnly(true);
  assert.deepEqual([t.audio.volume, t.voc.volume], [0, 1]);
  t.setMute('lead', true);
  assert.deepEqual([t.audio.volume, t.voc.volume], [1, 0]);
});

test('vocal help mixes only the isolated voice into steady karaoke backing and starts muted', () => {
  const t = track();
  t.setSinger(false);
  assert.deepEqual([t.audio.volume, t.kar.volume, t.voc.volume], [0, 1, 0]);
  t.audio.currentTime = 12; t.kar.currentTime = 12; t.voc.currentTime = 12;
  t.setVocalGuide(0.25);
  assert.deepEqual([t.audio.volume, t.kar.volume, t.voc.volume], [0, 1, 0.25]);
  assert.deepEqual([t.audio.currentTime, t.kar.currentTime, t.voc.currentTime], [12, 12, 12]);
  assert.equal(t.singer, false);
  t.setVocalGuide(0);
  assert.deepEqual([t.audio.volume, t.kar.volume, t.voc.volume], [0, 1, 0]);
});

test('temporary lead muting silences vocal help and switching modes resets it', () => {
  const t = track();
  t.setVocalGuide(0.3);
  t.setMute('lead', true);
  assert.deepEqual([t.audio.volume, t.kar.volume, t.voc.volume], [0, 1, 0]);
  t.setMute('lead', false);
  assert.deepEqual([t.audio.volume, t.kar.volume, t.voc.volume], [0, 1, 0.3]);
  t.setSinger(true);
  assert.equal(t.vocalGuide, 0);
  assert.deepEqual([t.audio.volume, t.kar.volume, t.voc.volume], [1, 0, 0]);
  t.setVocalsOnly(true);
  t.setVocalGuide(0.2);
  assert.equal(t.vocalsOnly, false);
  assert.deepEqual([t.audio.volume, t.kar.volume, t.voc.volume], [0, 1, 0.2]);
  t.setSinger(false);
  assert.deepEqual([t.audio.volume, t.kar.volume, t.voc.volume], [0, 1, 0]);
});

test('stem-only songs keep their instrumental at full level with adjustable vocal help', () => {
  const t = track(true);
  assert(t.hasVocalGuide);
  t.setVocalGuide(0.35);
  assert.deepEqual([t.audio.volume, t.voc.volume], [1, 0.35]);
  t.setMute('lead', true);
  assert.deepEqual([t.audio.volume, t.voc.volume], [1, 0]);
});

test('vocal help requires both an instrumental and isolated vocals', () => {
  for (const missing of ['kar', 'voc']) {
    const t = track(); t[missing] = null;
    assert.equal(t.hasVocalGuide, false);
    t.setVocalGuide(0.5);
    assert.equal(t.singer, true);
    assert.equal(t.audio.volume, 1);
  }
});

test('vocal help clamps unsafe levels and applies fractional Web Audio gains smoothly', () => {
  const t = track();
  t.setVocalGuide(5); assert.equal(t.voc.volume, 1);
  for (const invalid of [-1, NaN, undefined]) { t.setVocalGuide(invalid); assert.equal(t.voc.volume, 0); }
  t.playing = true;
  const automation = {};
  for (const name of ['main', 'karNode', 'vocNode']) t[name] = { gain: {
    context: { currentTime: 1 }, gain: {
      cancelScheduledValues() {}, setTargetAtTime(level, time, smoothing) { automation[name] = { level, time, smoothing }; },
    },
  } };
  t.setVocalGuide(0.25);
  assert.deepEqual(Object.values(automation).map((v) => v.level), [0, 1, 0.25]);
  assert(automation.vocNode.smoothing > 0, 'adjustments should fade without clicks');
});

test('karaoke presets are applied immediately before playback so the original singer cannot leak in', () => {
  const t = track(), levels = {};
  t.playing = false;
  for (const name of ['main', 'karNode', 'vocNode']) t[name] = { gain: {
    context: { currentTime: 0 }, gain: {
      cancelScheduledValues() {},
      setValueAtTime(level) { levels[name] = level; },
      setTargetAtTime() { assert.fail('a paused preset should not wait for a fade'); },
    },
  } };
  t.setSinger(false);
  assert.deepEqual(Object.values(levels), [0, 1, 0]);
  t.setVocalGuide(0.25);
  assert.deepEqual(Object.values(levels), [0, 1, 0.25]);
});
