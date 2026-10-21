/*
 * Public songs can travel compressed in the URL. Private recordings use an
 * identifier-only cloud link whose lyrics and audio require authorization.
 */
import { h, openModal, toast } from './ui.js';

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

export function packableSong(song) {
  const s = JSON.parse(JSON.stringify(song));
  delete s.mine;
  delete s.builtin;
  delete s.createdAt;
  delete s.updatedAt;
  delete s.folderImport;
  if (s.audio) delete s.audio.mediaId;
  if (s.karaoke) delete s.karaoke.mediaId;
  if (s.vocals) delete s.vocals.mediaId;
  return s;
}

export async function encodeSong(song) {
  if (song.cloud || song.source === 'audio') throw new Error('Share uploaded songs using their private cloud link.');
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
  const base = `${location.origin}${location.pathname}`;
  return `${base}${hash}`;
}

export async function shareLink(song) {
  let link;
  try {
    link = song.cloud ? appUrl(`#/song/${encodeURIComponent(song.id)}`) : appUrl(`#/s/${await encodeSong(song)}`);
  } catch (e) {
    toast(`Could not make a link: ${e.message}`, 'bad');
    return;
  }
  const input = h('input', { type: 'text', value: link, readonly: true, onclick: (e) => e.target.select() });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copied');
    } catch {
      input.select();
      document.execCommand('copy');
      toast('Link copied');
    }
  };
  const qr = link.length < 1800
    ? h('img', { class: 'share-qr', alt: 'QR code', width: 180, height: 180, src: `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}` })
    : h('p', { class: 'small' }, 'This song is too long for a QR code, but the link works.');
  openModal([
    h('h2', null, '🔗 Share this song'),
    h('p', { class: 'small' }, song.cloud
      ? 'This private link requires sign-in and permission to access the song. Use an assignment to give students access.'
      : 'This link contains the song lyrics, tune and timing.'),
    input,
    h('div', { class: 'row top-space' }, h('button', { class: 'btn primary', type: 'button', onclick: copy }, '📋 Copy link'), h('span', { class: 'small' }, `${link.length} characters`)),
    h('div', { class: 'share-qr-wrap' }, qr),
  ]);
}
