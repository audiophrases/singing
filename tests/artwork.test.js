import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { appleCandidates, artworkCandidates, findCover, searchArtwork } from '../js/media/artwork.js';

const album = '532ed037-e874-4464-93bc-3299619fa278';
const live = '04a2f7f1-1061-4a5e-bdae-32f893323822';
const single = '6f3e9fa6-be7a-3de8-a2b2-2072ece8a54d';
const applePicture = 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/source/100x100bb.jpg';
const cover = (id, size = 500) => `https://coverartarchive.org/release-group/${id}/front-${size}`;
const various = 'd6a1c8f4-3f3e-4a4e-9a57-5a3b0e4e9c11';
const release = (id, { type = 'Album', secondary, date = '1987', status = 'Official', title = 'An album', by } = {}) => ({
  status, date, ...(by === undefined ? {} : { 'artist-credit': by ? [{ name: by }] : [] }),
  'release-group': { id, title, 'primary-type': type, ...(secondary ? { 'secondary-types': secondary } : {}) },
});
// A release is the recording's artist's own unless it says otherwise.
const recording = (title, artist, releases) => ({ title, 'artist-credit': [{ name: artist, artist: { name: artist } }], releases: releases.map((item) => ({ 'artist-credit': [{ name: artist }], ...item })) });
const song = (title, artist = 'Artist') => ({ source: 'audio', title, artist });

const realFetch = globalThis.fetch;
let saved;
let calls;
// Each service answers with what a test gives it: data, a status, or an error.
function services({ brainz = { recordings: [] }, store = { results: [] }, images = {} } = {}) {
  calls = [];
  const answer = (value) => {
    if (value instanceof Error) throw value;
    return typeof value === 'number' ? { ok: false, status: value } : { ok: true, status: 200, json: async () => value };
  };
  globalThis.fetch = async (url, options) => {
    const { hostname } = new URL(url);
    calls.push(hostname);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    if (hostname === 'musicbrainz.org') return answer(typeof brainz === 'function' ? brainz(url) : brainz);
    if (hostname === 'itunes.apple.com') return answer(store);
    const status = images[url] ?? 404;
    return { ok: status === 200, status, blob: async () => new Blob([url]) };
  };
}
const count = (host) => calls.filter((name) => name === host).length;

beforeEach(() => {
  saved = new Map();
  globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete globalThis.localStorage;
});

test('artwork candidates require the correct title and artist and validate IDs', () => {
  const data = { recordings: [
    recording('Hey Jude (Live)', 'The Beatles', [release(live)]),
    recording('Hey Jude', 'Another Artist', [release(live)]),
    recording('Hey Jude', 'The Beatles', [release(album), release('not-an-id'), release(album)]),
  ] };
  assert.deepEqual(artworkCandidates(data, 'hey jude', 'THE BEATLES'), [cover(album)]);
  assert.deepEqual(artworkCandidates(data, 'Hey Jude', ''), []);
});

test('the original studio release comes first, and live albums and bootlegs do not lead', () => {
  // As MusicBrainz lists U2's song: mostly concerts with no picture to find.
  const bootleg = 'b1c181a0-bcd1-4e34-b627-1e38f83dc22b';
  const data = { recordings: [
    recording('A song', 'Artist', [release(live, { secondary: ['Live'], date: '1985' })]),
    recording('A song', 'Artist', [release(bootleg, { status: 'Bootleg', date: '1980' })]),
    recording('A song', 'Artist', [release(single, { type: 'Single', date: '1987-05-25' }), release(album, { date: '1987-03-09' })]),
  ] };
  assert.deepEqual(artworkCandidates(data, 'A song', 'Artist'), [cover(album), cover(single), cover(live)]);
});

// As MusicBrainz lists Sia's Chandelier: 137 releases, nearly all of them
// collections, and some not marked as compilations.
test('other people\'s collections are never a song\'s cover, however they are labelled', () => {
  const data = { recordings: [recording('A song', 'Artist', [
    release(various, { by: 'Various Artists', secondary: ['Compilation'], date: '1980' }),
    release(live, { by: 'Various Artists', date: '1981' }),
    release(single, { by: '', date: '1982' }),
    release(album, { date: '1990' }),
  ])] };
  assert.deepEqual(artworkCandidates(data, 'A song', 'Artist'), [cover(album)]);
  const onlyCollections = { recordings: [recording('A song', 'Artist', [release(live, { by: 'Various Artists' })])] };
  assert.deepEqual(artworkCandidates(onlyCollections, 'A song', 'Artist'), []);
});

test('a film\'s soundtrack counts as the song\'s own, after the artist\'s', () => {
  const data = { recordings: [recording('A song', 'Artist', [
    release(live, { by: 'A Composer', secondary: ['Soundtrack'], date: '1980' }),
    release(album, { date: '1990' }),
  ])] };
  assert.deepEqual(artworkCandidates(data, 'A song', 'Artist'), [cover(album), cover(live)]);
});

test('an album with no picture leads to Apple, not to a collection that has one', async () => {
  const brainz = { recordings: [recording('Hit song', 'Artist', [release(album), release(live, { by: 'Various Artists' })])] };
  const store = { results: [{ trackName: 'Hit song', artistName: 'Artist', artworkUrl100: applePicture }] };
  const image = applePicture.replace('100x100bb', '500x500bb');
  services({ brainz, store, images: { [image]: 200, [cover(live)]: 200 } });
  assert.equal(await (await findCover(song('Hit song'))).text(), image);
  assert.deepEqual(calls, ['musicbrainz.org', 'coverartarchive.org', 'itunes.apple.com', 'is1-ssl.mzstatic.com']);
});

test('a cover remembered by the older search is not used again', async () => {
  saved.set('singing.artwork.v1', JSON.stringify({ '["old answer","artist"]': { url: cover(live), at: Date.now() } }));
  const brainz = { recordings: [recording('Old answer', 'Artist', [release(album)])] };
  services({ brainz, images: { [cover(album)]: 200, [cover(live)]: 200 } });
  assert.equal(await (await findCover(song('Old answer'))).text(), cover(album));
});

test('Apple results must match too, and only Apple\'s pictures are used', () => {
  const result = (trackName, artistName, artworkUrl100 = applePicture) => ({ trackName, artistName, artworkUrl100 });
  const data = { results: [
    result('A song (Live)', 'Artist'),
    result('A song', 'Someone else'),
    result('A song', 'Artist', 'https://evil.example/100x100bb.jpg'),
    { ...result('A song', 'Artist', applePicture.replace('source', 'collection')), collectionArtistName: 'Various Artists' },
    result('A song', 'Artist & Friends'),
  ] };
  assert.deepEqual(appleCandidates(data, 'a song', 'artist'), [applePicture.replace('100x100bb', '500x500bb')]);
  assert.deepEqual(appleCandidates(data, 'a song', ''), []);
});

test('a song found once is not searched for again on the next visit', async () => {
  const brainz = { recordings: [recording('Found once', 'Artist', [release(album)])] };
  services({ brainz, images: { [cover(album)]: 200 } });
  const [one, two] = await Promise.all([findCover(song('Found once')), findCover(song('Found once'))]);
  assert.equal(await one.text(), cover(album));
  assert.equal(one, two, 'one search for two covers on screen');
  assert.equal(count('musicbrainz.org'), 1);
  services({ brainz, images: { [cover(album)]: 200 } });
  assert.equal(await (await findCover(song('Found once'))).text(), cover(album));
  assert.deepEqual(calls, ['coverartarchive.org'], 'only the picture is fetched');
});

test('a song with no cover is left alone until its title changes or a month passes', async () => {
  services();
  assert.equal(await findCover(song('Nothing here')), null);
  assert.deepEqual(calls, ['musicbrainz.org', 'itunes.apple.com']);
  services();
  assert.equal(await findCover(song('Nothing here')), null);
  assert.deepEqual(calls, [], 'no request at all on the next visit');
  await findCover(song('Nothing here either'));
  assert.equal(count('musicbrainz.org'), 1, 'a changed title is looked up');
  const memory = JSON.parse(saved.get('singing.artwork.v2'));
  for (const entry of Object.values(memory)) entry.at -= 31 * 24 * 60 * 60 * 1000;
  saved.set('singing.artwork.v2', JSON.stringify(memory));
  services();
  await findCover(song('Nothing here'));
  assert.equal(count('musicbrainz.org'), 1, 'it looks again after a month');
});

test('covers that all turn out missing fall through to Apple, then count as nothing found', async () => {
  const brainz = { recordings: [recording('Missing pictures', 'Artist', [release(album)])] };
  const store = { results: [{ trackName: 'Missing pictures', artistName: 'Artist', artworkUrl100: applePicture }] };
  services({ brainz, store });
  assert.equal(await findCover(song('Missing pictures')), null);
  assert.deepEqual(calls, ['musicbrainz.org', 'coverartarchive.org', 'itunes.apple.com', 'is1-ssl.mzstatic.com']);
  services({ brainz, store });
  assert.equal(await findCover(song('Missing pictures')), null);
  assert.deepEqual(calls, []);
});

test('a failed search is not remembered, so the song is tried again', async () => {
  const store = { results: [] };
  services({ brainz: new Error('offline'), store });
  assert.equal(await findCover(song('Retry song')), null);
  services({ brainz: { recordings: [recording('Retry song', 'Artist', [release(album)])] }, images: { [cover(album)]: 200 } });
  assert.equal(await (await findCover(song('Retry song'))).text(), cover(album));
  // A picture that cannot be read right now is no reason to give up either.
  services({ brainz: { recordings: [recording('Busy archive', 'Artist', [release(album)])] }, images: { [cover(album)]: 500 } });
  assert.equal(await findCover(song('Busy archive')), null);
  services();
  await findCover(song('Busy archive'));
  assert.equal(count('musicbrainz.org'), 1);
});

test('MusicBrainz gets a second try when busy, before Apple is asked', async () => {
  let answers = 0;
  const brainz = () => { answers += 1; return answers === 1 ? 503 : { recordings: [recording('Busy song', 'Artist', [release(album)])] }; };
  services({ brainz, images: { [cover(album)]: 200 } });
  assert.equal(await (await findCover(song('Busy song'))).text(), cover(album));
  assert.deepEqual(calls, ['musicbrainz.org', 'musicbrainz.org', 'coverartarchive.org']);
});

test('Apple is asked when MusicBrainz stays down', async () => {
  const store = { results: [{ trackName: 'Down song', artistName: 'Artist', artworkUrl100: applePicture }] };
  const image = applePicture.replace('100x100bb', '500x500bb');
  services({ brainz: 503, store, images: { [image]: 200 } });
  assert.equal(await (await findCover(song('Down song'))).text(), image);
});

test('only audio songs with a title and an artist are looked up', async () => {
  services();
  assert.equal(await findCover({ ...song('Hey Jude'), source: 'youtube' }), null);
  assert.equal(await findCover(song('Hey Jude', '')), null);
  assert.equal(await findCover(song('', 'Artist')), null);
  assert.deepEqual(calls, []);
});

test('the teacher\'s search offers albums, songs and Apple, with no need for an exact match', async () => {
  const brainz = (url) => {
    const query = new URL(url).searchParams.get('query');
    assert.match(query, /"The Joshua Tree"/);
    assert.match(query, /artist:"U2"/);
    return url.includes('/release-group/')
      ? { 'release-groups': [{ id: album, title: 'The Joshua Tree' }, { id: 'not-an-id', title: 'Broken' }] }
      : { recordings: [recording('Something else', 'Others', [release(single, { title: 'A single' }), release(album)])] };
  };
  const store = { results: [{ collectionName: 'Deluxe', artworkUrl100: applePicture }, { collectionName: 'Bad', artworkUrl100: 'https://evil.example/100x100bb.jpg' }] };
  services({ brainz, store });
  assert.deepEqual(await searchArtwork(' The Joshua Tree ', ' U2 '), [
    { name: 'The Joshua Tree', thumb: cover(album, 250), full: cover(album) },
    { name: 'Deluxe', thumb: applePicture.replace('100x100bb', '250x250bb'), full: applePicture.replace('100x100bb', '500x500bb') },
    { name: 'A single', thumb: cover(single, 250), full: cover(single) },
  ]);
  services({ brainz: (url) => {
    assert.doesNotMatch(new URL(url).searchParams.get('query'), /artist:/, 'the artist is optional');
    return url.includes('/release-group/') ? { 'release-groups': [] } : { recordings: [] };
  } });
  assert.deepEqual(await searchArtwork('Only a title'), []);
});

test('the teacher\'s search leads with the artist\'s own album and ends with collections', async () => {
  const brainz = (url) => (url.includes('/release-group/')
    ? { 'release-groups': [{ id: single, title: 'The single' }] }
    : { recordings: [recording('A song', 'Artist', [release(various, { by: 'Various Artists', title: 'Pop party', date: '1980' }), release(album, { title: 'The album', date: '1990' })])] });
  services({ brainz, store: { results: [{ collectionName: 'Apple album', artworkUrl100: applePicture }] } });
  assert.deepEqual((await searchArtwork('A song', 'Artist')).map((item) => item.name), ['The album', 'The single', 'Apple album', 'Pop party']);
});

test('the teacher\'s search works if one service answers, and says so if none does', async () => {
  services({ brainz: 500, store: { results: [{ collectionName: 'Apple only', artworkUrl100: applePicture }] } });
  assert.equal((await searchArtwork('A song', 'Artist')).length, 1);
  services({ brainz: new Error('offline'), store: new Error('offline') });
  await assert.rejects(searchArtwork('A song', 'Artist'), /not answering/);
});
