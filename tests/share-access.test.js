import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARE_TTL, ACCESS_LEASE, assignmentExpiry, accessInfo } from '../cloudflare/song-access.js';
import { stampAccess, leaseRemaining } from '../js/cloud/lease.js';
import { watchSongAccess } from '../js/cloud/song-access.js';
import { packableSong, encodeSong } from '../js/share.js';
import { saveUserSong } from '../js/store.js';

test('assignment access ends at the earlier of its seven-day expiry and deadline', () => {
  assert.equal(SHARE_TTL, 604800000);
  assert.equal(assignmentExpiry({ created_at: 1000 }), 1000 + SHARE_TTL);
  assert.equal(assignmentExpiry({ created_at: 1000, expires_at: 5000, due_at: 4000 }), 4000);
  assert.equal(assignmentExpiry({ created_at: 1000, expires_at: 5000, due_at: 9000 }), 5000);
  assert.deepEqual(accessInfo(5000, 4000), { serverNow: 4000, expiresAt: 5000, checkBy: 5000 });
  assert.equal(accessInfo(1e9, 4000).checkBy, 4000 + ACCESS_LEASE);
});

test('a lease uses server time and elapsed time, includes network time, and expires exactly at its boundary', () => {
  const data = stampAccess({ song: { access: { serverNow: 10000, expiresAt: 20000, checkBy: 15000 } } }, 1000);
  assert.equal(leaseRemaining(data.song.access, 1500), 4500);
  assert.equal(leaseRemaining(data.song.access, 6000), 0);
  assert.equal(leaseRemaining(data.song.access, 6001), 0);
  assert.equal(leaseRemaining({ expiresAt: 1e15 }, 1000), 0, 'an unstamped or browser-persisted permission cannot authorize playback');
  assert.equal(leaseRemaining(stampAccess({ access: { serverNow: 20000, expiresAt: 10000, checkBy: 10000 } }, 1000).access, 1000), 0);
  const playback = stampAccess({ urls: {}, serverNow: 10000, expiresAt: 12000 }, 1000);
  assert.equal(playback.playbackDeadline, 3000);
  assert.equal(playback.playbackDuration, 2000);
});

test('protected songs cannot become local saved copies or self-contained share links', async () => {
  const song = { id: 'protected', title: 'Protected', source: 'band', lines: [], protected: true };
  assert.throws(() => saveUserSong(song), /bookmarks/);
  assert.throws(() => packableSong(song), /cannot be copied/);
  await assert.rejects(() => encodeSong(song), /expiring private link/);
});

function browser(t) {
  const previous = new Map(['window', 'document', 'navigator'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: Object.assign(new EventTarget(), { hidden: false }) });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  t.after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return { protected: true, access: { deadline: performance.now() + 100 } };
}

test('an open page locks at expiry even if a late permission refresh succeeds', async (t) => {
  const song = browser(t); let resolve; const messages = [];
  const stop = watchSongAccess(song, { verify: () => new Promise((r) => { resolve = r; }), onLock: (message) => messages.push(message) });
  window.dispatchEvent(new Event('focus'));
  t.mock.timers.tick(101);
  assert.equal(messages.length, 1);
  resolve({ access: { deadline: performance.now() + 60000 } });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(messages.length, 1);
  stop();
});

test('going offline clears access immediately and cleanup removes page watchers', (t) => {
  const song = browser(t); let locked = 0;
  const stop = watchSongAccess(song, { verify: async () => ({}), onLock: () => locked++ });
  window.dispatchEvent(new Event('offline'));
  assert.equal(locked, 1);
  stop(); window.dispatchEvent(new Event('offline')); t.mock.timers.tick(1000);
  assert.equal(locked, 1);
});

test('revocation and failed online revalidation lock an open page', async (t) => {
  const song = browser(t); let message;
  const stop = watchSongAccess(song, { verify: async () => { throw Object.assign(new Error('Access withdrawn'), { status: 410 }); }, onLock: (value) => { message = value; } });
  window.dispatchEvent(new Event('focus'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(message, 'Access withdrawn');
  stop();
});
