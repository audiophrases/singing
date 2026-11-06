/*
 * Singing: boot and hash router.
 *
 *   #/                       song library
 *   #/song/<id>              a song and its activities
 *   #/play/<id>/<game>?...   a game on the stage (projector)
 *   #/studio[/<id>]          make or edit a song
 *   #/voicelab[?song=<id>]   compare the robot singers (A/B, blind test)
 *   #/chant                  chant maker
 *   #/party                  class games that need no song
 *   #/remix/<id>             write new verses
 *   #/lesson/<id>            AI song pack: prompt, batches, review
 *   #/print/<id>/<kind>      worksheets
 *   #/card/<id>/<seed>       a student's bingo card (phone)
 *   #/share/<token>          an expiring shared song
 *   #/s/<data>               retired legacy link
 *   #/help
 */
import { h, clear, toast, closeModals } from './ui.js';
import { openTeamsDialog } from './views/teams.js';
import { initFolderLibrary, stopWatching } from './media/folder-library.js';
import { initCloud, cloudSession, onCloudSession, api } from './cloud/session.js';
import { teacherArea, teacherAccess, isTeacher, assignmentRoute, teacherUrl, publicUrl } from './cloud/access.js';
import { refreshCloudLibrary, resolveCloudSong, loadPublicSongs, refreshStudentSongs, cacheCloudSong, lockProtectedSong } from './cloud/library.js';
import { watchSongAccess, checkSongAccess } from './cloud/song-access.js';
import { accountButton, renderSignIn } from './views/account.js';

const cloudReady = initCloud().then(async (session) => {
  if (teacherArea() && isTeacher(session.principal)) {
    try { await refreshCloudLibrary(); } catch (e) { toast(e.message, 'bad'); }
  } else if (!teacherArea()) {
    try { await loadPublicSongs(); } catch (e) { toast(e.message, 'bad'); }
    if (session.principal?.role === 'student') try { await refreshStudentSongs(); } catch (e) { toast(e.message, 'bad'); }
  }
  if (teacherAccess()) initFolderLibrary();
});
const account = accountButton();
document.querySelector('.topbar-right').prepend(account);

function syncNavigation() {
  const { path, query } = parseHash();
  const principal = cloudSession().principal;
  const teacherGate = teacherArea() && !teacherAccess();
  document.querySelector('.topnav').hidden = teacherGate;
  document.getElementById('teamsBtn').hidden = teacherGate;
  document.querySelector('[data-nav="studio"]').hidden = !teacherAccess();
  document.querySelector('[data-nav="assignments"]').hidden = !(teacherAccess() || (!teacherArea() && (principal?.role === 'student' || assignmentRoute(path, query))));
  document.querySelector('[data-public-link]').hidden = !teacherArea();
  document.querySelector('[data-public-link]').href = publicUrl('#/');
  account.hidden = !principal || !(teacherArea() || assignmentRoute(path, query) || principal.role === 'student');
}
let previousPrincipal = null;
onCloudSession((session) => {
  syncNavigation();
  if (previousPrincipal && previousPrincipal.id !== session.principal?.id) {
    stopWatching();
    queueMicrotask(() => window.dispatchEvent(new Event('hashchange')));
  }
  previousPrincipal = session.principal;
});
syncNavigation();

const routes = [
  { re: /^\/?$/, view: () => import('./views/library.js'), nav: 'library' },
  { re: /^\/song\/([^/]+)$/, view: () => import('./views/song.js'), nav: 'library', keys: ['id'] },
  { re: /^\/play\/([^/]+)\/([^/]+)$/, view: () => import('./views/stage.js'), nav: 'library', keys: ['id', 'game'], stage: true },
  { re: /^\/studio(?:\/([^/]+))?$/, view: () => import('./views/studio.js'), nav: 'studio', keys: ['id'], teacher: true },
  { re: /^\/voicelab$/, view: () => import('./views/voicelab.js'), nav: 'studio' },
  { re: /^\/chant$/, view: () => import('./views/chant.js'), nav: 'chant' },
  { re: /^\/party(?:\/([^/]+))?$/, view: () => import('./views/party.js'), nav: 'party', keys: ['game'] },
  { re: /^\/assignments$/, view: () => import('./views/assignments.js'), nav: 'assignments' },
  { re: /^\/assignment\/([^/]+)$/, view: () => import('./views/assignments.js'), nav: 'assignments', keys: ['id'] },
  { re: /^\/remix\/([^/]+)$/, view: () => import('./views/remix.js'), nav: 'library', keys: ['id'] },
  { re: /^\/lesson\/([^/]+)$/, view: () => import('./views/lesson.js'), nav: 'library', keys: ['id'], teacher: true },
  { re: /^\/print\/([^/]+)\/([^/]+)$/, view: () => import('./views/print.js'), nav: 'library', keys: ['id', 'kind'] },
  { re: /^\/card\/([^/]+)\/([^/]+)$/, view: () => import('./views/card.js'), nav: '', keys: ['id', 'seed'] },
  { re: /^\/s\/(.+)$/, view: () => import('./views/shared.js'), nav: 'library', keys: ['data'] },
  { re: /^\/share\/([a-f0-9]{64})$/, view: () => import('./views/shared.js'), nav: 'library', keys: ['token'] },
  { re: /^\/help$/, view: () => import('./views/help.js'), nav: 'help' },
];

const app = document.getElementById('app');
const stage = document.getElementById('stage');
let cleanup = null;
let renderSeq = 0;

function accessMessage(message, { signIn = false } = {}) {
  clear(stage); stage.classList.add('hidden'); app.inert = false;
  document.body.classList.remove('on-stage');
  clear(app); closeModals();
  if (signIn) { renderSignIn(app, { shared: true }); return; }
  app.append(h('section', { class: 'card' }, h('h1', null, 'Song access'), h('p', { role: 'status' }, message),
    h('a', { class: 'btn', href: '#/' }, 'Back to the songs'),
    h('button', { class: 'btn', type: 'button', onclick: () => window.dispatchEvent(new Event('hashchange')) }, 'Check access again')));
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const q = raw.indexOf('?');
  const rawPath = q >= 0 ? raw.slice(0, q) : raw;
  let path = rawPath;
  try { path = decodeURIComponent(rawPath); } catch { /* keep as is */ }
  const query = Object.fromEntries(new URLSearchParams(q >= 0 ? raw.slice(q + 1) : ''));
  return { path, query };
}

async function render() {
  const seq = ++renderSeq;
  const { path, query } = parseHash();
  if (typeof cleanup === 'function') {
    try { cleanup(); } catch (e) { console.error(e); }
  }
  cleanup = null;
  // Clear private content before any route lookup, permission check or import.
  // A failed load must never leave the previous page without its access watcher.
  closeModals();
  clear(stage); stage.classList.add('hidden'); app.inert = false;
  document.body.classList.remove('on-stage');
  clear(app).append(h('p', { class: 'small', role: 'status' }, 'Loading…'));
  const route = routes.find((r) => r.re.test(path));
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', !!route && a.dataset.nav === route.nav));
  if (!route) {
    clear(app).append(h('div', { class: 'empty' }, h('span', { class: 'big' }, '🎵'), 'This page does not exist. ', h('a', { href: '#/' }, 'Back to the songs')));
    return;
  }
  const m = route.re.exec(path);
  const params = { ...query };
  (route.keys || []).forEach((k, i) => { if (m[i + 1] !== undefined) params[k] = m[i + 1]; });
  await cloudReady;
  if (seq !== renderSeq) return;
  syncNavigation();
  // Preserve old teacher bookmarks while keeping public pages free of tools.
  if (!teacherArea() && (route.teacher || (route.nav === 'assignments' && isTeacher()))) {
    location.replace(teacherUrl(location.hash || '#/'));
    return;
  }
  if (teacherArea() && !teacherAccess()) {
    clear(stage); stage.classList.add('hidden'); app.inert = false;
    document.body.classList.remove('on-stage');
    clear(app); renderSignIn(app, { teacher: true });
    return;
  }
  if (teacherAccess()) initFolderLibrary();
  if (!cloudSession().principal && assignmentRoute(path, query) && route.stage) {
    clear(stage); stage.classList.add('hidden'); app.inert = false;
    document.body.classList.remove('on-stage');
    clear(app); renderSignIn(app);
    return;
  }
  let protectedSong = null;
  let verifyAccess;
  try {
    let resolved;
    if (params.token) {
      if (!cloudSession().principal) { accessMessage('', { signIn: true }); return; }
      ({ song: resolved } = await api('/api/shared/open', { method: 'POST', body: { token: params.token } }));
      params.song = resolved; cacheCloudSong(resolved);
      verifyAccess = () => api('/api/shared/access', { method: 'POST', body: { token: params.token } });
    } else if (params.attempt) {
      const run = await api(`/api/attempts/${encodeURIComponent(params.attempt)}`);
      if (run.attempt.song_id !== params.id || run.attempt.activity !== params.game) throw new Error('This attempt belongs to another activity.');
      params.assignmentRun = run; resolved = run.song;
      verifyAccess = () => api(`/api/attempts/${encodeURIComponent(params.attempt)}/access`);
    } else {
      const songId = route.nav !== 'assignments' ? params.id || params.song || params.lesson || params.edit : null;
      if (songId) resolved = await resolveCloudSong(songId, { revision: params.revision });
      if (!resolved && songId && !cloudSession().principal && /^[a-f0-9-]{36}$/.test(songId)) { accessMessage('', { signIn: true }); return; }
    }
    if (seq !== renderSeq) return;
    if (resolved?.protected) {
      if (!/^\/(song|play|share)\//.test(path)) {
        accessMessage('This shared song is available for online listening and activities. Saving a copy, printing and remixing are unavailable.');
        return;
      }
      protectedSong = resolved;
      verifyAccess ||= () => checkSongAccess(resolved);
    }
  } catch (e) {
    if (seq === renderSeq) accessMessage(e.message, { signIn: e.status === 401 });
    return;
  }
  let mod;
  try {
    mod = await route.view();
  } catch (e) {
    console.error(e);
    toast('Could not load this page. Check your connection.', 'bad');
    return;
  }
  if (seq !== renderSeq) return;
  stage.classList.toggle('hidden', !route.stage);
  app.inert = !!route.stage;
  document.body.classList.toggle('on-stage', !!route.stage);
  if (!route.stage) clear(stage);
  // Each render owns its mount: late async work cannot restore a locked page.
  const target = h('div');
  if (!route.stage) {
    clear(app);
    window.scrollTo(0, 0);
  }
  clear(route.stage ? stage : app).append(target);
  try {
    const nextCleanup = await mod.render(target, params);
    if (seq === renderSeq) {
      const stopAccess = watchSongAccess(protectedSong, { verify: verifyAccess, onLock: (message) => {
        if (seq !== renderSeq) return;
        renderSeq++;
        if (typeof nextCleanup === 'function') nextCleanup();
        cleanup = null;
        lockProtectedSong(protectedSong.id);
        accessMessage(message);
      } });
      if (seq === renderSeq) cleanup = () => { stopAccess(); if (typeof nextCleanup === 'function') nextCleanup(); };
    }
    else if (typeof nextCleanup === 'function') nextCleanup();
  } catch (e) {
    if (seq !== renderSeq) return;
    console.error(e);
    clear(app).append(h('div', { class: 'card' }, h('h2', null, 'Something went wrong'), h('p', { class: 'small' }, String(e.message || e)), h('a', { class: 'btn', href: '#/' }, 'Back to the songs')));
  }
}

window.addEventListener('hashchange', render);
document.getElementById('teamsBtn').addEventListener('click', () => openTeamsDialog());
document.addEventListener('keydown', (e) => {
  if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (document.body.classList.contains('on-stage')) return; // the stage has its own T
    openTeamsDialog();
  }
});

render();
