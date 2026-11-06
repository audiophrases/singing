/*
 * Finding a song's cover. A cover that is found is saved with the song
 * (cloudflare/songs.js), so only songs without one are looked up. What a search
 * learned stays in this browser, so a song with no cover anywhere is not looked
 * up again on every visit.
 */
const MEMORY = 'singing.artwork.v1';
const REMEMBER = 30 * 24 * 60 * 60 * 1000;
const MAX_REMEMBERED = 500;
const pending = new Map();
let queue = Promise.resolve();
let lastRequest = 0;

const normalized = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const quote = (value) => `"${value.replace(/([\\"])/g, '\\$1')}"`;
const lookupKey = (title, artist) => JSON.stringify([normalized(title), normalized(artist)]);
const musicBrainzId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const appleImage = /^https:\/\/[a-z0-9.-]+\.mzstatic\.com\/.+\/\d+x\d+bb\.jpg$/i;
// A recording is listed under every album it is on, so asking MusicBrainz to
// leave out live and compilation albums would lose the song itself: artworkCandidates sorts those last.
const OFFICIAL = ' AND status:official AND primarytype:(album OR single OR ep)';

const groupCover = (id, size) => `https://coverartarchive.org/release-group/${id}/front-${size}`;
const appleCover = (url, size) => url.replace(/\d+x\d+bb/, `${size}x${size}bb`);
const musicBrainz = (entity, query) => `https://musicbrainz.org/ws/2/${entity}/?${new URLSearchParams({ query, fmt: 'json', limit: '25' })}`;
const apple = (term) => `https://itunes.apple.com/search?${new URLSearchParams({ term, media: 'music', entity: 'song', limit: '10' })}`;

function memory() {
  try { return JSON.parse(localStorage.getItem(MEMORY)) || {}; } catch { return {}; }
}

function remembered(key) {
  const entry = memory()[key];
  return entry && Date.now() - entry.at < REMEMBER ? entry : null;
}

// A cover's address, or null for "nothing found".
function remember(key, url) {
  const all = { ...memory(), [key]: { url, at: Date.now() } };
  const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_REMEMBERED);
  try { localStorage.setItem(MEMORY, JSON.stringify(Object.fromEntries(kept))); } catch { /* it looks again next time */ }
}

// One request at a time, a second apart, which is what MusicBrainz asks for. It
// often answers 503 when busy, so it gets a second try: giving up would save
// the next source's cover, which can be a later recording, for good.
function getJson(url) {
  const request = queue.then(async () => {
    for (let tries = 1; ; tries += 1) {
      const wait = Math.max(0, (tries === 1 ? 1100 : 2500) - (Date.now() - lastRequest));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      lastRequest = Date.now();
      const response = await fetch(url, { signal: AbortSignal.timeout(8000), credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (response.ok) return response.json();
      if (response.status !== 503 || tries === 2) throw new Error(`The cover search answered ${response.status}.`);
    }
  });
  queue = request.catch(() => {});
  return request;
}

function byArtist(credits, wanted) {
  const creditedName = credits.map((credit) => `${credit.name || ''}${credit.joinphrase || ''}`).join('');
  return normalized(creditedName) === wanted || credits.some((credit) => normalized(credit.name) === wanted || normalized(credit.artist?.name) === wanted);
}

function isStudio(group) {
  return ['Album', 'Single', 'EP'].includes(group['primary-type']) && !group['secondary-types']?.length;
}

// Each album or single once, the original studio releases first: most live
// bootlegs and many compilations have no cover to find.
function rankedGroups(recordings) {
  const groups = new Map();
  for (const recording of recordings) {
    for (const release of recording.releases || []) {
      const group = release['release-group'];
      if (!musicBrainzId.test(group?.id || '') || (release.status && release.status !== 'Official')) continue;
      const date = release.date || '9999';
      const seen = groups.get(group.id);
      if (!seen || date < seen.date) groups.set(group.id, { id: group.id, name: group.title || '', studio: isStudio(group), date });
    }
  }
  return [...groups.values()].sort((a, b) => b.studio - a.studio || a.date.localeCompare(b.date));
}

export function artworkCandidates(data, title, artist) {
  const wantedTitle = normalized(title);
  const wantedArtist = normalized(artist);
  if (!wantedTitle || !wantedArtist) return [];
  const exact = (data?.recordings || []).filter((recording) => normalized(recording.title) === wantedTitle && byArtist(recording['artist-credit'] || [], wantedArtist));
  return rankedGroups(exact).slice(0, 5).map((group) => groupCover(group.id, 500));
}

export function appleCandidates(data, title, artist) {
  const wantedTitle = normalized(title);
  const wantedArtist = ` ${normalized(artist)} `;
  if (!wantedTitle || !wantedArtist.trim()) return [];
  const exact = (data?.results || []).filter((result) => normalized(result.trackName) === wantedTitle
    && ` ${normalized(result.artistName)} `.includes(wantedArtist) && appleImage.test(result.artworkUrl100 || ''));
  return [...new Set(exact.map((result) => appleCover(result.artworkUrl100, 500)))].slice(0, 3);
}

// The picture itself, or null if this address has none.
export async function downloadCover(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('This picture is not available right now.');
  return response.blob();
}

async function search(key, title, artist) {
  const known = remembered(key)?.url;
  if (known) {
    const picture = await downloadCover(known).catch(() => null);
    if (picture) return picture;
  }
  let certain = true;
  const sources = [
    async () => artworkCandidates(await getJson(musicBrainz('recording', `recording:${quote(title)} AND artist:${quote(artist)}${OFFICIAL}`)), title, artist),
    async () => appleCandidates(await getJson(apple(`${artist} ${title}`)), title, artist),
  ];
  for (const source of sources) {
    try {
      for (const url of await source()) {
        const picture = await downloadCover(url);
        if (picture) { remember(key, url); return picture; }
      }
    } catch { certain = false; } // not an answer: this song is tried again next time
  }
  if (certain) remember(key, null);
  return null;
}

// The cover of a song that has none saved yet, or null.
export function findCover(song) {
  const title = String(song.title || '').trim();
  const artist = String(song.artist || '').trim();
  if (song.source !== 'audio' || !normalized(title) || !normalized(artist)) return Promise.resolve(null);
  const key = lookupKey(title, artist);
  if (remembered(key)?.url === null) return Promise.resolve(null);
  if (pending.has(key)) return pending.get(key);
  const work = search(key, title, artist).finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}

// Choices for the teacher, who can see which is right, so nothing has to match
// exactly and an album title works too. Throws only if no service answered.
export async function searchArtwork(title, artist = '') {
  const words = quote(title.trim());
  const by = artist.trim() ? ` AND artist:${quote(artist.trim())}` : '';
  const [albums, songs, store] = await Promise.allSettled([
    getJson(musicBrainz('release-group', `releasegroup:${words}${by}`)),
    getJson(musicBrainz('recording', `recording:${words}${by}${OFFICIAL}`)),
    getJson(apple(`${artist} ${title}`.trim())),
  ]);
  if (albums.status === 'rejected' && songs.status === 'rejected' && store.status === 'rejected') throw new Error('The cover search is not answering.');
  const groups = [
    ...(albums.value?.['release-groups'] || []).filter((group) => musicBrainzId.test(group.id || '')).map((group) => ({ id: group.id, name: group.title || '' })).slice(0, 6),
    ...rankedGroups(songs.value?.recordings || []).slice(0, 6),
  ];
  const found = new Map();
  for (const group of groups) {
    if (!found.has(group.id)) found.set(group.id, { name: group.name, thumb: groupCover(group.id, 250), full: groupCover(group.id, 500) });
  }
  for (const result of (store.value?.results || []).filter((item) => appleImage.test(item.artworkUrl100 || '')).slice(0, 6)) {
    found.set(result.artworkUrl100, { name: result.collectionName || result.trackName || '', thumb: appleCover(result.artworkUrl100, 250), full: appleCover(result.artworkUrl100, 500) });
  }
  return [...found.values()];
}

// Every saved picture has the same form, whatever the teacher chose: a small
// JPEG, the only kind the server accepts.
export async function coverJpeg(picture, size = 500) {
  let image;
  try { image = await createImageBitmap(picture); } catch { throw new Error('This file is not a picture Singing can read.'); }
  const scale = Math.min(1, size / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; // a transparent background would turn black
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const jpeg = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', 0.85); });
  if (!jpeg) throw new Error('This file is not a picture Singing can read.');
  return jpeg;
}
