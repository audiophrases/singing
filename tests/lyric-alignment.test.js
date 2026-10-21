import test from 'node:test';
import assert from 'node:assert/strict';
import { alignSongLyrics, lyricsSignature } from '../js/media/lyric-alignment.js';
import { readTimingFile, shiftSynced } from '../js/media/timing.js';
import { timingFixture, recordingFeatures } from './fixtures/lyric-alignment.js';

const fixture = timingFixture();
const recorded = recordingFeatures(fixture);
const song = () => ({ source: 'audio', audio: { mediaId: 'original' }, karaoke: { mediaId: 'backing', offset: 0 }, vocals: { mediaId: 'voice', offset: 0 }, synced: structuredClone(fixture.lines) });

test('one correction moves all lyric detail while leaving the three recordings together', async () => {
  const input = song();
  input.synced[0].words = input.synced[0].notes.map((note) => ({ start: note[0] }));
  const before = structuredClone(input);
  const result = await alignSongLyrics(input, { readFeatures: async (ref) => {
    assert.equal(ref.mediaId, 'original', 'only the reference recording is analyzed');
    return recorded;
  } });
  assert.equal(result.status, 'aligned');
  assert.ok(Math.abs(result.offset - fixture.shift) <= 0.04, JSON.stringify(result));
  assert.deepEqual(result.synced, shiftSynced(before.synced, result.offset));
  assert.deepEqual(input, before, 'preview does not change timing or audio references');
  const repeated = await alignSongLyrics({ ...input, synced: result.synced }, { readFeatures: async () => recorded });
  assert.equal(repeated.status, 'unchanged', 'checking already corrected lyrics does not apply the shift again');
  assert.deepEqual(repeated.synced, result.synced);
});

test('LRC offsets, SRT and WebVTT retain their timing without trying to detect a melody', async () => {
  for (const [name, text] of [
    ['Song.lrc', '[offset:500]\n[00:01.00]<00:01.00>Hello <00:01.50>world'],
    ['Song.srt', '1\n00:00:01,000 --> 00:00:03,000\nHello world'],
    ['Song.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello world'],
  ]) {
    const synced = readTimingFile(text, name).lines;
    const result = await alignSongLyrics({ ...song(), synced }, { readFeatures: () => assert.fail('no pitch information to match') });
    assert.equal(result.status, 'no-notes');
    assert.deepEqual(result.synced, synced);
  }
});

test('uncertain matches and unreadable audio keep all supplied timing', async () => {
  const uniform = { ...recorded, chroma: new Float32Array(recorded.chroma.length).fill(1 / 12) };
  for (const [readFeatures, status] of [
    [async () => uniform, 'uncertain'],
    [async () => { throw new Error('decode failed'); }, 'error'],
  ]) {
    const input = song();
    const result = await alignSongLyrics(input, { readFeatures });
    assert.equal(result.status, status);
    assert.equal(result.offset, 0);
    assert.deepEqual(result.synced, input.synced);
  }
});

test('a stems-only song uses its vocals on the same recording timeline', async () => {
  const input = song();
  input.audio = { ...input.karaoke, stems: true };
  const result = await alignSongLyrics(input, { readFeatures: async (ref) => {
    assert.equal(ref.mediaId, 'voice');
    return recorded;
  } });
  assert.equal(result.status, 'aligned');
  assert.equal(input.karaoke.offset, 0);
  assert.equal(input.vocals.offset, 0);
  const withoutAudio = await alignSongLyrics({ source: 'none', synced: input.synced });
  assert.equal(withoutAudio.status, 'no-audio');
  assert.deepEqual(withoutAudio.synced, input.synced);
});

test('timing signatures ignore property order but detect manual timing and text changes', async () => {
  const a = [{ text: 'Hello', section: 'Chorus', start: 3, end: 4, words: [{ start: 3 }] }];
  const b = [{ words: [{ start: 3 }], end: 4, start: 3, section: 'Chorus', text: 'Hello' }];
  assert.equal(await lyricsSignature(a), await lyricsSignature(b));
  assert.notEqual(await lyricsSignature(a), await lyricsSignature(shiftSynced(a, 0.1)));
  assert.notEqual(await lyricsSignature(a), await lyricsSignature([{ ...a[0], text: 'Hi' }]));
});
