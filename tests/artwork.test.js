import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artworkCandidates, findArtwork } from '../js/media/artwork.js';

const first = '532ed037-e874-4464-93bc-3299619fa278';
const second = '04a2f7f1-1061-4a5e-bdae-32f893323822';
const recording = (title, artist, releases) => ({
  title, 'artist-credit': [{ name: artist, artist: { name: artist } }], releases: releases.map((id) => ({ id })),
});

test('artwork candidates require the correct title and artist and validate release IDs', () => {
  const data = { recordings: [
    recording('Hey Jude (Live)', 'The Beatles', [second]),
    recording('Hey Jude', 'Another Artist', [second]),
    recording('Hey Jude', 'The Beatles', [first, 'not-an-id', first, second]),
  ] };
  assert.deepEqual(artworkCandidates(data, 'hey jude', 'THE BEATLES'), [
    `https://coverartarchive.org/release/${first}/front-250`,
    `https://coverartarchive.org/release/${second}/front-250`,
  ]);
  assert.deepEqual(artworkCandidates(data, 'Hey Jude', ''), []);
});

test('audio lookups deduplicate requests and cache successful results', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(new URL(url).searchParams.get('query'), 'recording:"Hey Jude" AND artist:"The Beatles"');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    return { ok: true, json: async () => ({ recordings: [recording('Hey Jude', 'The Beatles', [first])] }) };
  };
  try {
    const song = { source: 'audio', title: 'Hey Jude', artist: 'The Beatles' };
    const [one, two] = await Promise.all([findArtwork(song), findArtwork(song)]);
    assert.deepEqual(one, two);
    assert.equal(one.length, 1);
    await findArtwork(song);
    assert.equal(calls, 1);
    assert.deepEqual(await findArtwork({ ...song, source: 'youtube' }), []);
    assert.deepEqual(await findArtwork({ ...song, artist: '' }), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a failed artwork request falls back without blocking a later retry', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
    return { ok: true, json: async () => ({ recordings: [recording('Retry song', 'Retry artist', [second])] }) };
  };
  try {
    const song = { source: 'audio', title: 'Retry song', artist: 'Retry artist' };
    assert.deepEqual(await findArtwork(song), []);
    assert.deepEqual(await findArtwork(song), [`https://coverartarchive.org/release/${second}/front-250`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
