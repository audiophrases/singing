/*
 * Choosing a song's picture: search again with better words, or add one.
 * The words here only steer the search: they do not rename the song.
 */
import { h, clear, openModal, toast } from '../ui.js';
import { searchArtwork, downloadCover, coverJpeg } from '../media/artwork.js';
import { setArtwork } from '../cloud/library.js';

export function artworkDialog(song, { onChange }) {
  const title = h('input', { type: 'text', value: song.title || '' });
  const artist = h('input', { type: 'text', value: song.artist || '' });
  const note = h('p', { class: 'small', role: 'status' });
  const results = h('div', { class: 'art-results' });
  let latest = 0;
  let saving = false;

  const save = async (read) => {
    if (saving) return;
    saving = true;
    note.textContent = 'Saving the picture…';
    try {
      const picture = await read();
      if (!picture) throw new Error('This picture is not available. Choose another one.');
      onChange(await setArtwork(song, await coverJpeg(picture)));
      toast('Picture saved', 'ok');
      modal.close();
    } catch (e) {
      note.textContent = e.message;
    } finally {
      saving = false;
    }
  };

  const find = async () => {
    latest += 1;
    const search = latest;
    clear(results);
    if (!title.value.trim()) { note.textContent = 'Write a song or album title first.'; return; }
    note.textContent = 'Looking for pictures…';
    let found;
    try {
      found = await searchArtwork(title.value, artist.value);
    } catch {
      if (search === latest) note.textContent = 'The picture search is not answering. Try again soon, or add your own picture.';
      return;
    }
    if (search !== latest) return;
    const nothing = () => { note.textContent = 'Nothing found. Try other words, or add your own picture.'; };
    if (!found.length) { nothing(); return; }
    note.textContent = 'Click a picture to use it.';
    let left = found.length;
    for (const item of found) {
      const image = h('img', { src: item.thumb, alt: item.name, referrerpolicy: 'no-referrer' });
      const choice = h('button', { class: 'art-choice', type: 'button', title: item.name, onclick: () => save(() => downloadCover(item.full)) }, image);
      // Many albums have no picture: only the ones that load stay on the list.
      image.addEventListener('error', () => {
        choice.remove();
        left -= 1;
        if (!left && search === latest) nothing();
      });
      results.append(choice);
    }
  };

  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'Picture file', onchange: () => {
    const picture = file.files[0];
    file.value = '';
    if (picture) save(async () => picture);
  } });
  const onPaste = (e) => {
    const picture = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!picture) return;
    e.preventDefault();
    save(async () => picture);
  };

  const modal = openModal([
    h('h2', null, '🖼️ Song picture'),
    h('form', { onsubmit: (e) => { e.preventDefault(); find(); } },
      h('div', { class: 'art-search' },
        h('label', null, 'Song or album', title),
        h('label', null, 'Artist', artist),
        h('button', { class: 'btn primary', type: 'submit' }, '🔍 Search')),
      h('p', { class: 'small' }, 'These words only change the search. The song keeps its name.')),
    note,
    results,
    h('h3', null, 'Or add your own'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, '📁 Choose a picture'),
      h('span', { class: 'small' }, 'or copy a picture and paste it here.'),
      file),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, 'Close')),
  ], { wide: true, onClose: () => { latest += 1; document.removeEventListener('paste', onPaste); } });
  document.addEventListener('paste', onPaste);
  find();
}
