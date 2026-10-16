/*
 * A student's bingo card on a phone: #/card/<song>/<number|any>?n=4&w=...
 * The card number is shown big so the teacher can check a BINGO! claim.
 */
import { h, clear } from '../ui.js';
import { decodeWords, makeCard, checkCard, cardSize } from '../lyrics/bingo.js';
import { getSong } from '../store.js';
import { confetti, sfx } from '../sfx.js';

export async function render(el, params) {
  document.body.classList.add('phone-page');
  const words = decodeWords(params.w || '');
  const title = params.t || (getSong(params.id) || {}).title || 'Lyrics bingo';
  if (words.length < 9) {
    el.append(h('div', { class: 'empty' }, h('span', { class: 'big' }, '🎱'), 'This bingo link is broken. Ask your teacher for a new one.'));
    return () => document.body.classList.remove('phone-page');
  }
  const size = cardSize(words, Number(params.n) || 4);
  const key = `singing.card.${params.id}.${size}.${words.length}`;
  let num = Number(params.seed);
  if (!num) {
    try { num = Number(localStorage.getItem(key)); } catch { /* storage off */ }
    if (!num) {
      num = 1 + Math.floor(Math.random() * 999);
      try { localStorage.setItem(key, String(num)); } catch { /* storage off */ }
    }
  }
  const grid = makeCard(words, num, size);
  const markKey = `${key}.marks.${num}`;
  let marks;
  try { marks = new Set(JSON.parse(localStorage.getItem(markKey) || '[]')); } catch { marks = new Set(); }
  const save = () => { try { localStorage.setItem(markKey, JSON.stringify([...marks])); } catch { /* ignore */ } };

  const cells = grid.map((w, i) => {
    const c = h('button', { class: `card-cell${w === null ? ' free' : ''}${marks.has(i) || w === null ? ' marked' : ''}`, type: 'button', disabled: w === null }, w === null ? '⭐' : w);
    c.addEventListener('click', () => {
      if (marks.has(i)) marks.delete(i); else marks.add(i);
      c.classList.toggle('marked', marks.has(i));
      save();
      if (navigator.vibrate) navigator.vibrate(15);
    });
    return c;
  });
  const shout = h('div', { class: 'card-shout hidden' });
  const bingoBtn = h('button', { class: 'btn primary btn-lg card-bingo', type: 'button', onclick: () => {
    const fake = new Set(grid.map((w, i) => (marks.has(i) ? w : null)).filter(Boolean));
    const res = checkCard(grid, fake);
    clear(shout).append(
      h('div', { class: 'cs-big' }, res.lines.length ? 'BINGO! 🎉' : 'Not yet… 🤔'),
      h('div', null, res.lines.length ? `Show card #${num} to your teacher!` : 'You need a full line: across, down or corner to corner.'),
      h('button', { class: 'btn', type: 'button', onclick: () => shout.classList.add('hidden') }, 'OK'));
    shout.classList.remove('hidden');
    if (res.lines.length) { confetti({ count: 160 }); sfx('jackpot', { volume: 0.7 }); }
  } }, 'BINGO!');

  el.append(h('div', { class: 'card-page' },
    h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, `🎱 ${title}`), h('div', { class: 'card-num' }, `Card #${num}`)),
    h('div', { class: 'card-grid', style: { '--n': size } }, cells),
    h('p', { class: 'small', style: { textAlign: 'center' } }, 'Tap a word when you hear it in the song.'),
    bingoBtn,
    shout,
    h('button', { class: 'link-like small', type: 'button', onclick: () => { marks.clear(); save(); cells.forEach((c, i) => c.classList.toggle('marked', grid[i] === null)); } }, 'Clear my card')));
  return () => document.body.classList.remove('phone-page');
}
