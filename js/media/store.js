/*
 * Temporary upload files and legacy originals in IndexedDB. Saved recordings
 * upload to private cloud storage; legacy originals are retained during migration.
 */
const DB = 'singing-media';
const STORE = 'files';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function putMedia(id, blob) {
  return tx('readwrite', (s) => s.put(blob, id));
}

export function getMedia(id) {
  return tx('readonly', (s) => s.get(id));
}

export function deleteMedia(id) {
  return tx('readwrite', (s) => s.delete(id));
}

export function newMediaId() {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
