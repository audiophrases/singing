/*
 * Singing: boot and hash router.
 *
 *   #/                       song library
 *   #/song/<id>              a song and its activities
 *   #/play/<id>/<game>?...   a game on the stage (projector)
 *   #/studio[/<id>]          make or edit a song
 *   #/chant                  chant maker
 *   #/party                  class games that need no song
 *   #/remix/<id>             write new verses
 *   #/print/<id>/<kind>      worksheets
 *   #/card/<id>/<seed>       a student's bingo card (phone)
 *   #/s/<data>               a shared song
 *   #/help
 */
import { h, clear, toast } from './ui.js';
import { openTeamsDialog } from './views/teams.js';
import { initFolderLibrary } from './media/folder-library.js';

initFolderLibrary();

const routes = [
  { re: /^\/?$/, view: () => import('./views/library.js'), nav: 'library' },
  { re: /^\/song\/([^/]+)$/, view: () => import('./views/song.js'), nav: 'library', keys: ['id'] },
  { re: /^\/play\/([^/]+)\/([^/]+)$/, view: () => import('./views/stage.js'), nav: 'library', keys: ['id', 'game'], stage: true },
  { re: /^\/studio(?:\/([^/]+))?$/, view: () => import('./views/studio.js'), nav: 'studio', keys: ['id'] },
  { re: /^\/chant$/, view: () => import('./views/chant.js'), nav: 'chant' },
  { re: /^\/party(?:\/([^/]+))?$/, view: () => import('./views/party.js'), nav: 'party', keys: ['game'] },
  { re: /^\/remix\/([^/]+)$/, view: () => import('./views/remix.js'), nav: 'library', keys: ['id'] },
  { re: /^\/print\/([^/]+)\/([^/]+)$/, view: () => import('./views/print.js'), nav: 'library', keys: ['id', 'kind'] },
  { re: /^\/card\/([^/]+)\/([^/]+)$/, view: () => import('./views/card.js'), nav: '', keys: ['id', 'seed'] },
  { re: /^\/s\/(.+)$/, view: () => import('./views/shared.js'), nav: 'library', keys: ['data'] },
  { re: /^\/help$/, view: () => import('./views/help.js'), nav: 'help' },
];

const app = document.getElementById('app');
const stage = document.getElementById('stage');
let cleanup = null;
let renderSeq = 0;

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
  const route = routes.find((r) => r.re.test(path));
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', !!route && a.dataset.nav === route.nav));
  if (!route) {
    clear(app).append(h('div', { class: 'empty' }, h('span', { class: 'big' }, '🎵'), 'This page does not exist. ', h('a', { href: '#/' }, 'Back to the songs')));
    return;
  }
  const m = route.re.exec(path);
  const params = { ...query };
  (route.keys || []).forEach((k, i) => { if (m[i + 1] !== undefined) params[k] = m[i + 1]; });
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
  document.body.classList.toggle('on-stage', !!route.stage);
  if (!route.stage) clear(stage);
  const target = route.stage ? stage : app;
  if (!route.stage) {
    clear(app);
    window.scrollTo(0, 0);
  }
  try {
    cleanup = await mod.render(target, params);
  } catch (e) {
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
