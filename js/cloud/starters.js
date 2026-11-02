/*
 * Starter songs in a teacher's cloud library. Each teacher gets one copy of
 * every starter song, created with the starter's id as its clientId, and then
 * edits or deletes it like any other song. The server keeps a deleted song's
 * clientId, so a starter song the teacher deleted is never added again, on any
 * device. A starter song assigned before this existed already has its copy
 * under the same clientId. This browser remembers which starter songs a
 * teacher already has, so a deleted one is not requested again. The owner's new
 * copies start public, as the starter songs were before (makePublic).
 */
import { STARTER_SONGS } from '../data/songs/index.js';

const KEY = 'singing.starters.v1';

export async function addStarterSongs({ api, principalId, documents, makePublic = false, starters = STARTER_SONGS, storage = globalThis.localStorage }) {
  const read = () => { try { return JSON.parse(storage?.getItem(KEY) || '{}') || {}; } catch { return {}; } };
  const done = new Set(read()[principalId] || []);
  const ids = new Set(starters.map((s) => s.id));
  for (const song of documents) if (ids.has(song.clientId)) done.add(song.clientId);
  const added = [];
  const fetchSong = async (id) => (await api(`/api/songs/${id}`)).song;
  try {
    // The library lists the newest first: add in reverse to keep the songbook order.
    for (const starter of [...starters].reverse()) {
      if (done.has(starter.id)) continue;
      let created;
      try { created = await api('/api/songs', { method: 'POST', body: { clientId: starter.id } }); }
      catch (e) { if (e.status === 409) { done.add(starter.id); continue; } throw e; } // the teacher deleted it
      if (created.revision > 0) added.push(await fetchSong(created.id)); // saved meanwhile in another tab
      else {
        const { id, starter: _starter, ...song } = starter;
        let saved;
        try {
          // Starter songs ship with Singing: traditional songs or written for it.
          saved = (await api(`/api/songs/${created.id}/commit`, { method: 'POST', body: { baseRevision: 0, song, assets: {}, rightsConfirmed: true } })).song;
        } catch (e) { if (e.status !== 409) throw e; saved = await fetchSong(created.id); }
        if (makePublic && !saved.public) {
          await api(`/api/songs/${created.id}/visibility`, { method: 'POST', body: { public: true } });
          saved = { ...saved, public: true };
        }
        added.push(saved);
      }
      done.add(starter.id);
    }
  } finally {
    try { storage?.setItem(KEY, JSON.stringify({ ...read(), [principalId]: [...done] })); } catch { /* storage full or blocked */ }
  }
  return added.reverse();
}
