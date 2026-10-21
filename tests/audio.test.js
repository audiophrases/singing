import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioTrack } from '../js/media/audio.js';

function track(stems = false) {
  const t = Object.create(AudioTrack.prototype);
  Object.assign(t, { song: { audio: { stems } }, audio: { volume: 1 }, kar: stems ? null : { volume: 0 }, voc: { volume: 0 },
    singer: true, leadMuted: false, vocalsOnly: false, handlers: {} });
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
