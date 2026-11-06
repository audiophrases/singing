const cache = new Map();
const pending = new Map();
let queue = Promise.resolve();
let lastRequest = 0;

const normalized = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const quote = (value) => `"${value.replace(/([\\"])/g, '\\$1')}"`;
const releaseId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function artworkCandidates(data, title, artist) {
  const wantedTitle = normalized(title);
  const wantedArtist = normalized(artist);
  if (!wantedTitle || !wantedArtist) return [];
  const ids = new Set();
  for (const recording of data?.recordings || []) {
    if (normalized(recording.title) !== wantedTitle) continue;
    const credits = recording['artist-credit'] || [];
    const creditedName = credits.map((credit) => `${credit.name || ''}${credit.joinphrase || ''}`).join('');
    if (normalized(creditedName) !== wantedArtist && !credits.some((credit) => normalized(credit.name) === wantedArtist || normalized(credit.artist?.name) === wantedArtist)) continue;
    for (const release of recording.releases || []) {
      if (releaseId.test(release.id || '')) ids.add(release.id);
      if (ids.size >= 5) break;
    }
    if (ids.size >= 5) break;
  }
  return [...ids].map((id) => `https://coverartarchive.org/release/${id}/front-250`);
}

export function findArtwork(song) {
  if (song.source !== 'audio' || !normalized(song.title) || !normalized(song.artist)) return Promise.resolve([]);
  const key = JSON.stringify([normalized(song.title), normalized(song.artist)]);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (pending.has(key)) return pending.get(key);
  const title = String(song.title).trim();
  const artist = String(song.artist).trim();
  const request = queue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastRequest));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequest = Date.now();
    const params = new URLSearchParams({ query: `recording:${quote(title)} AND artist:${quote(artist)}`, fmt: 'json', limit: '10' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`https://musicbrainz.org/ws/2/recording/?${params}`, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) return [];
      const candidates = artworkCandidates(await response.json(), title, artist);
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(key, candidates);
      return candidates;
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  });
  pending.set(key, request);
  queue = request.then(() => {}, () => {});
  request.finally(() => pending.delete(key));
  return request;
}
