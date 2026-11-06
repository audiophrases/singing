import { api } from './session.js';
import { leaseRemaining } from './lease.js';

export function watchSongAccess(song, { verify, onLock }) {
  if (!song?.protected) return () => {};
  let stopped = false; let pending = false; let expiryTimer; let refreshTimer;
  let access = song.access;
  const stop = () => {
    stopped = true;
    clearTimeout(expiryTimer); clearTimeout(refreshTimer);
    window.removeEventListener('offline', offline);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', visible);
  };
  const lock = (message = 'Access expired. Ask your teacher for a new link.') => {
    if (stopped) return;
    stop(); onLock(message);
  };
  const arm = () => {
    clearTimeout(expiryTimer); clearTimeout(refreshTimer);
    const remaining = leaseRemaining(access);
    if (!remaining) { lock(); return; }
    expiryTimer = setTimeout(() => lock(), remaining);
    refreshTimer = setTimeout(refresh, Math.min(30000, Math.max(5000, remaining / 2)));
  };
  async function refresh() {
    if (stopped || pending) return;
    if (navigator.onLine === false) { offline(); return; }
    pending = true;
    try {
      const data = await verify();
      if (stopped) return;
      if (!data.access || !leaseRemaining(data.access)) { lock(); return; }
      access = data.access; song.access = access; arm();
    } catch (e) { lock(e.status ? e.message : 'Connect to the internet to check access, then reopen this song.'); }
    finally { pending = false; }
  }
  const offline = () => lock('Connect to the internet to check access, then reopen this song.');
  const visible = () => { if (!document.hidden) { if (!leaseRemaining(access)) lock(); else refresh(); } };
  window.addEventListener('offline', offline);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', visible);
  if (navigator.onLine === false) offline(); else arm();
  return stop;
}

export const checkSongAccess = (song) => api(`/api/songs/${encodeURIComponent(song.id)}/access?revision=${song.revision}`);
