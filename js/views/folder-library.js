import { h, toast } from '../ui.js';
import { folderStatus, onFolderStatus, chooseSongFolder, scanFolder, startWatching, stopWatching, importFolderSelection } from '../media/folder-library.js';

export function folderLibraryControls() {
  const supported = typeof window.showDirectoryPicker === 'function';
  const run = async (fn) => {
    try { await fn(); } catch (error) {
      if (error.name !== 'AbortError') toast(`Could not import the folder: ${error.message}`, 'bad');
    }
  };
  const input = h('input', { type: 'file', webkitdirectory: true, multiple: true, class: 'hidden', 'aria-label': 'Import songs folder' });
  input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; if (files.length) run(() => importFolderSelection(files)); });
  const choose = h('button', { class: 'btn', type: 'button', onclick: () => supported ? run(chooseSongFolder) : input.click() }, '📂 Choose songs folder');
  const scan = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => run(scanFolder) }, '↻ Scan now');
  const watch = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => folderStatus().watching ? stopWatching() : run(startWatching) });
  const status = h('p', { class: 'small', role: 'status', 'aria-live': 'polite' });
  const name = h('strong');
  const sync = (state) => {
    name.textContent = state.name;
    choose.disabled = state.busy;
    scan.disabled = state.busy;
    scan.classList.toggle('hidden', !state.name || !supported);
    watch.classList.toggle('hidden', !state.name || !supported);
    watch.textContent = state.watching ? '⏸ Pause watching' : 'Reconnect folder';
    watch.disabled = state.busy;
    status.textContent = `${state.watching ? 'Watching every 5 seconds while this app is open. ' : ''}${state.message}`;
  };
  const el = h('section', { class: 'card' },
    h('h2', { style: { marginTop: 0 } }, '📂 Songs from a folder'),
    h('p', { class: 'small' }, 'Keep matching names: Song.m4a, Song (Karaoke).mp3, Song (Vocals).mp3 and Song.txt (or .lrc, .srt, .vtt). Subfolders are included. New files are added to your library; changed files update the same song.'),
    h('div', { class: 'row' }, choose, name, scan, watch, input), status,
    h('p', { class: 'small' }, supported
      ? 'Files stay on this computer. Choose a folder once; reconnect if the browser asks after reopening.'
      : 'This browser supports folder import. Select the folder again to scan for additions; automatic watching needs Chrome or Edge.'),
  );
  const off = onFolderStatus(sync);
  sync(folderStatus());
  el.destroy = off;
  return el;
}
