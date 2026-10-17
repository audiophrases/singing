/*
 * Worksheets ready to print: lyrics, gap fill with a word bank, cut-up lines
 * and bingo cards (same card numbers as the phone cards).
 */
import { h, shuffle, seeded } from '../ui.js';
import { getSong } from '../store.js';
import { songTimeline } from '../pinplay-export.js';
import { bingoWords, makeCard, cardSize } from '../lyrics/bingo.js';
import { pickGaps, GAP_LEVELS } from '../lyrics/gaps.js';

const KINDS = [
  ['lyrics', '📜 Lyrics'],
  ['gapfill', '✏️ Gap fill'],
  ['cutup', '✂️ Cut-up lines'],
  ['bingo', '🎱 Bingo cards'],
];

export async function render(el, params) {
  const song = getSong(params.id);
  if (!song) { el.append(h('div', { class: 'empty' }, 'Song not found.')); return null; }
  const timeline = songTimeline(song);
  const kind = params.kind;
  const sheet = h('div', { class: 'sheet' });
  const opts = { level: params.level || 'easy', size: Number(params.size) || 4, count: Number(params.n) || 12, seed: Number(params.seed) || 7 };
  const go = (patch) => {
    const q = new URLSearchParams({ ...opts, ...patch }).toString();
    location.hash = `#/print/${encodeURIComponent(song.id)}/${patch.kind || kind}?${q}`;
  };
  const seen = new Set();
  const lines = timeline.lines.filter((l) => !l.instrumental);
  const head = () => h('div', { class: 'sheet-head' }, h('div', null, h('h1', null, `${song.emoji || '🎵'} ${song.title}`), h('div', { class: 'small' }, song.artist || '')), h('div', { class: 'sheet-name' }, 'Name: ______________________'));

  if (kind === 'lyrics') {
    sheet.append(head());
    let section = null;
    for (const l of lines) {
      if (l.sectionStart && l.section) { section = l.section; sheet.append(h('h3', null, section)); }
      sheet.append(h('p', { class: 'sheet-line' }, l.pic ? `${l.pic} ` : '', l.part ? h('b', null, `${l.part}: `) : null, l.text, l.translation ? h('i', { class: 'small' }, ` · ${l.translation}`) : null));
    }
  } else if (kind === 'gapfill') {
    sheet.append(head(), h('p', { class: 'sheet-task' }, '🎧 Listen to the song and fill the gaps.'));
    const gaps = pickGaps(timeline, { mode: opts.level, seed: opts.seed });
    const bank = [];
    for (const l of lines) {
      const set = gaps.get(l.index) || new Set();
      sheet.append(h('p', { class: 'sheet-line' }, l.words.map((w, i) => {
        if (!set.has(i)) return `${w.text} `;
        const core = w.text.replace(/^[^A-Za-z0-9'’]+|[^A-Za-z0-9'’]+$/g, '');
        bank.push(core.toLowerCase());
        const trail = w.text.slice(w.text.indexOf(core) + core.length);
        return [h('span', { class: 'sheet-gap', style: { width: `${Math.max(4, core.length) * 0.75}em` } }), `${trail} `];
      })));
    }
    if (opts.level === 'easy') sheet.append(h('div', { class: 'sheet-bank' }, h('b', null, 'Word bank: '), shuffle([...new Set(bank)], seeded(opts.seed)).join(' · ')));
    sheet.append(h('details', { class: 'no-print' }, h('summary', null, 'Answers'), h('p', { class: 'small' }, bank.join(', '))));
  } else if (kind === 'cutup') {
    sheet.append(head(), h('p', { class: 'sheet-task' }, '✂️ Cut out the lines. Listen and put them in order.'));
    const uniq = lines.filter((l) => { const k = l.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    for (const l of shuffle(uniq, seeded(opts.seed))) sheet.append(h('div', { class: 'sheet-strip' }, l.text));
  } else {
    const words = bingoWords(timeline, 40);
    const size = cardSize(words, opts.size);
    if (!size) {
      sheet.append(h('p', null, 'This song is too short for bingo cards.'));
    } else {
      const grid = h('div', { class: 'bingo-cards' });
      for (let n = 1; n <= opts.count; n += 1) {
        const card = makeCard(words, n, size);
        grid.append(h('div', { class: 'bingo-print-card' },
          h('div', { class: 'bpc-head' }, h('span', null, `🎱 ${song.title}`), h('b', null, `#${n}`)),
          h('div', { class: 'bpc-grid', style: { '--n': size } }, card.map((w) => h('span', null, w === null ? '⭐' : w)))));
      }
      sheet.append(grid);
    }
  }

  const levelSel = h('select', { style: { width: 'auto' } }, GAP_LEVELS.map((l) => h('option', { value: l.id, selected: l.id === opts.level }, `${l.emoji} ${l.name}`)));
  levelSel.addEventListener('change', () => go({ level: levelSel.value }));
  const sizeSel = h('select', { style: { width: 'auto' } }, [3, 4, 5].map((n) => h('option', { value: n, selected: n === opts.size }, `${n}×${n}`)));
  sizeSel.addEventListener('change', () => go({ size: sizeSel.value }));
  const countIn = h('input', { type: 'number', min: 1, max: 60, value: opts.count, style: { width: '5rem' } });
  countIn.addEventListener('change', () => go({ n: countIn.value }));

  el.append(
    h('div', { class: 'no-print' },
      h('div', { class: 'row', style: { marginBottom: '.6rem' } }, h('a', { class: 'btn btn-sm ghost', href: `#/song/${encodeURIComponent(song.id)}` }, `← ${song.title}`)),
      h('div', { class: 'card' },
        h('div', { class: 'row' }, KINDS.map(([k, label]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(k === kind), onclick: () => go({ kind: k }) }, label))),
        h('div', { class: 'row top-space' },
          kind === 'gapfill' ? [h('span', { class: 'knob-label' }, 'Level'), levelSel] : null,
          kind === 'bingo' ? [h('span', { class: 'knob-label' }, 'Card'), sizeSel, h('span', { class: 'knob-label' }, 'How many'), countIn] : null,
          kind === 'gapfill' || kind === 'cutup' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => go({ seed: Math.floor(Math.random() * 1e5) }) }, '🎲 Shuffle') : null,
          h('span', { class: 'grow' }),
          h('button', { class: 'btn primary', type: 'button', onclick: () => window.print() }, '🖨️ Print')))),
    sheet,
  );
  return null;
}
