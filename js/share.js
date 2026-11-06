/*
 * Teacher sharing uses expiring server permissions. Legacy encoding helpers
 * remain for old data and backups, never for protected student content.
 */
import { h, clear, openModal, toast } from './ui.js';
import { publicUrl, teacherAccess } from './cloud/access.js';
import { api } from './cloud/session.js';
import { saveCloudSong, setSongPublic, cacheCloudSong } from './cloud/library.js';

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

// Legacy codecs reject cloud recordings. The live dialog uses server permissions.
const privateLink = (song) => !!song.cloud && song.source !== 'band';

export function packableSong(song) {
  if (song.protected || song.access) throw new Error('Protected songs cannot be copied into a link.');
  const s = JSON.parse(JSON.stringify(song));
  if (s.cloud) for (const key of ['id', 'cloud', 'clientId', 'revision', 'status', 'playbackExpiresAt']) delete s[key];
  delete s.mine;
  delete s.starter;
  delete s.public;
  delete s.createdAt;
  delete s.updatedAt;
  delete s.folderImport;
  delete s.artwork; // a private address: the link finds the cover again
  delete s.lesson; // too long for a link, and it holds teacher notes
  if (s.audio) delete s.audio.mediaId;
  if (s.karaoke) delete s.karaoke.mediaId;
  if (s.vocals) delete s.vocals.mediaId;
  return s;
}

export async function encodeSong(song) {
  if (song.protected || song.access || privateLink(song) || song.source === 'audio') throw new Error('Share this song using an expiring private link.');
  const json = new TextEncoder().encode(JSON.stringify(packableSong(song)));
  if (typeof CompressionStream === 'function') {
    const z = await pipe(json, new CompressionStream('deflate-raw'));
    return `z${toBase64Url(z)}`;
  }
  return `j${toBase64Url(json)}`;
}

export async function decodeSong(data) {
  const kind = data[0];
  const bytes = fromBase64Url(data.slice(1));
  let json = bytes;
  if (kind === 'z') json = await pipe(bytes, new DecompressionStream('deflate-raw'));
  const song = JSON.parse(new TextDecoder().decode(json));
  if (!song || typeof song !== 'object' || !song.title || !(Array.isArray(song.lines) || Array.isArray(song.synced))) {
    throw new Error('This link does not contain a song.');
  }
  return song;
}

export function appUrl(hash) {
  return publicUrl(hash);
}

export async function shareLink(song) {
  if (!teacherAccess() || song.protected) { toast('Ask your teacher for a share link.', 'bad'); return; }
  let permitted;
  try { permitted = await api('/api/share-targets'); }
  catch (e) { toast(e.message, 'bad'); return; }
  let current = song;
  const classes = permitted.classes.map((c) => ({ ...c, input: h('input', { type: 'checkbox', 'aria-label': `Share with class ${c.name}` }) }));
  const students = permitted.students.map((s) => ({ ...s, input: h('input', { type: 'checkbox', 'aria-label': `Share with student ${s.displayName}` }) }));
  const rights = h('input', { type: 'checkbox', 'aria-label': 'Permission to store and share this song' });
  const status = h('p', { class: 'small', role: 'status' });
  const generated = h('div'); const existing = h('div');
  const names = new Map([...classes.map((c) => [c.id, c.name]), ...students.map((s) => [s.id, s.displayName])]);
  const refresh = async () => {
    if (!current.cloud) return;
    const { links, serverNow } = await api(`/api/share-links?songId=${encodeURIComponent(current.id)}`);
    clear(existing);
    for (const link of links) {
      const active = !link.revoked_at && link.expires_at > serverNow;
      const row = h('div', { class: 'card' }, h('p', { class: 'small' },
        `${link.targets.map((t) => names.get(t.target_id) || 'Selected recipient').join(', ')} · ${link.revoked_at ? 'Withdrawn' : active ? 'Expires' : 'Expired'} ${new Date(link.expires_at).toLocaleString()}`));
      if (active) row.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: async (e) => {
        const button = e.currentTarget; button.disabled = true;
        try { await api(`/api/share-links/${link.id}/revoke`, { method: 'POST', body: {} }); await refresh(); }
        catch (error) { status.textContent = error.message; button.disabled = false; }
      } }, 'Revoke link'));
      existing.append(row);
    }
  };
  const create = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    create.disabled = true; status.textContent = '';
    try {
      const classIds = classes.filter((c) => c.input.checked).map((c) => c.id);
      const studentIds = students.filter((s) => s.input.checked).map((s) => s.id);
      if (!classIds.length && !studentIds.length) throw new Error('Choose at least one student or class.');
      if (classIds.length + studentIds.length > 30) throw new Error('Choose up to 30 students or classes. Use a class to share with a larger group.');
      if (!current.cloud) {
        if (!rights.checked) throw new Error('Confirm permission to store and share this song.');
        current = await saveCloudSong(current, { rightsConfirmed: true, onProgress: (message) => { status.textContent = message; } });
      }
      if (current.public) { await setSongPublic(current, false); current = { ...current, public: false }; }
      const result = await api('/api/share-links', { method: 'POST', body: { songId: current.id, classIds, studentIds } });
      current = { ...current, public: false, accessControlled: true }; cacheCloudSong(current);
      const link = appUrl(`#/share/${result.token}`);
      const input = h('input', { value: link, readonly: true, 'aria-label': 'Seven-day share link', onclick: (e) => e.target.select() });
      clear(generated).append(h('p', { class: 'small' }, `Expires ${new Date(result.expiresAt).toLocaleString()}. Saving this song keeps the same expiry.`), input,
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          try { await navigator.clipboard.writeText(link); }
          catch { input.select(); document.execCommand('copy'); }
          toast('Link copied');
        } }, '📋 Copy link'));
      status.textContent = 'New link created. Older links keep their original expiry dates.';
      await refresh();
    } catch (e) { status.textContent = e.message; }
    finally { create.disabled = false; }
  } }, 'Create new seven-day link');
  openModal([h('h2', null, '🔗 Share this song'),
    h('p', { class: 'small' }, 'Access lasts seven days from link creation. Students must sign in with a selected account or class. Saved songs, lyrics and audio expire together.'),
    song.public ? h('p', { class: 'small' }, 'Creating an expiring link makes this song private. Previously saved public copies cannot be recalled.') : null,
    h('h3', null, 'Classes'), h('div', { class: 'assignment-options' }, classes.map((c) => h('label', { class: 'inline' }, c.input, ` ${c.name}`))),
    h('h3', null, 'Individual students'), h('div', { class: 'assignment-options', style: { maxHeight: '240px', overflowY: 'auto' } }, students.map((s) => h('label', { class: 'inline' }, s.input, ` ${s.displayName}${s.className ? ` (${s.className})` : ''}`))),
    !song.cloud ? h('label', { class: 'inline small' }, rights, ' I have permission to store and share this song.') : null,
    create, status, generated, h('h3', null, 'Previous links'), existing,
  ], { wide: true, onClose: () => window.dispatchEvent(new Event('hashchange')) });
  try { await refresh(); } catch (e) { status.textContent = e.message; }
}
