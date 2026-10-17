/*
 * A song that arrived in a share link: preview it, play it, keep it.
 */
import { h, toast } from '../ui.js';
import { decodeSong } from '../share.js';
import { setSharedSong, saveUserSong, getSong, newSongId } from '../store.js';
import { songCover } from './library.js';

export async function render(el, { data }) {
  let song;
  try {
    song = await decodeSong(data);
  } catch (e) {
    el.append(h('div', { class: 'empty' }, h('span', { class: 'big' }, '🔗'), `This link does not work: ${e.message}`));
    return null;
  }
  if (!song.id || getSong(song.id)?.builtin) song.id = newSongId(song.title);
  setSharedSong(song);
  const exists = getSong(song.id) && getSong(song.id).mine;
  el.append(h('section', { class: 'card song-head' },
    songCover(song, { big: true }),
    h('div', null,
      h('div', { class: 'small' }, '🔗 A song shared with you'),
      h('h1', null, song.title),
      h('p', { class: 'small' }, song.artist || ''),
      h('div', { class: 'row top-space' },
        h('a', { class: 'btn primary', href: `#/song/${encodeURIComponent(song.id)}` }, '▶ Open it'),
        h('button', { class: 'btn', type: 'button', onclick: () => {
          saveUserSong(song);
          toast(exists ? 'Updated in your songs' : 'Saved in your songs ⭐', 'ok');
          location.hash = `#/song/${encodeURIComponent(song.id)}`;
        } }, exists ? '💾 Update my copy' : '💾 Save to my songs')),
      song.source === 'audio' ? h('p', { class: 'small bad' }, 'This song uses an audio file that is not in the link. Add your own copy in the Studio.') : null)));
  return null;
}
