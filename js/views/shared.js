import { h, toast } from '../ui.js';
import { saveSongBookmark } from '../cloud/library.js';
import { cloudSession } from '../cloud/session.js';
import { songCover } from './library.js';

export async function render(el, { song, data }) {
  if (data || !song) {
    el.append(h('section', { class: 'card' }, h('h1', null, 'A new share link is needed'),
      h('p', null, 'This older link has been retired. Ask your teacher for a new link.')));
    return null;
  }
  const save = h('button', { class: 'btn', type: 'button', onclick: async () => {
    save.disabled = true;
    try { await saveSongBookmark(song); toast('Saved. Access ends on the same expiry date.', 'ok'); }
    catch (e) { toast(e.message, 'bad'); }
    finally { save.disabled = false; }
  } }, '⭐ Save to my songs');
  el.append(h('section', { class: 'card song-head' }, songCover(song, { big: true }),
    h('div', null, h('div', { class: 'small' }, '🔗 A song shared with you'), h('h1', null, song.title),
      h('p', { class: 'small' }, song.artist || ''),
      song.access ? h('p', { class: 'small' }, `Access expires ${new Date(song.access.expiresAt).toLocaleString()}. Saving this song keeps its expiry date.`) : null,
      h('div', { class: 'row top-space' }, h('a', { class: 'btn primary', href: `#/song/${encodeURIComponent(song.id)}${song.protected ? `?revision=${song.revision}` : ''}` }, '▶ Open song'),
        cloudSession().principal?.role === 'student' ? save : null))));
  return null;
}
