/*
 * Worksheets ready to print: lyrics, gap fill with a word bank, cut-up lines
 * and bingo cards (same card numbers as the phone cards).
 */
import { h, shuffle, seeded } from '../ui.js';
import { getSong } from '../store.js';
import { songTimeline } from '../pinplay-export.js';
import { bingoWords, makeCard, cardSize } from '../lyrics/bingo.js';
import { pickGaps, GAP_LEVELS } from '../lyrics/gaps.js';
import { lessonOf, orderSets, setLabel } from '../lesson/pack.js';

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
  const lesson = lessonOf(song);
  const kinds = lesson ? [...KINDS, ['lesson', '🧠 AI worksheet']] : KINDS;
  const kind = params.kind;
  const sheet = h('div', { class: 'sheet' });
  const opts = { level: params.level || 'easy', size: Number(params.size) || 4, count: Number(params.n) || 12, seed: Number(params.seed) || 7 };
  const go = (patch) => {
    const q = new URLSearchParams({ ...opts, ...patch }).toString();
    location.hash = `#/print/${encodeURIComponent(song.id)}/${patch.kind || kind}?${q}`;
  };
  const seen = new Set();
  const lines = timeline.lines.filter((l) => !l.instrumental);
  // The lines with their gaps, on the sheet; the hidden words come back.
  const gapLines = (mode) => {
    const gaps = pickGaps(timeline, { mode, seed: opts.seed, lesson });
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
    return bank;
  };
  const wordBank = (bank) => h('div', { class: 'sheet-bank' }, h('b', null, 'Word bank: '), shuffle([...new Set(bank)], seeded(opts.seed)).join(' · '));
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
    const bank = gapLines(opts.level);
    if (opts.level === 'easy' || opts.level.startsWith('pack:')) sheet.append(wordBank(bank));
    sheet.append(h('details', { class: 'no-print' }, h('summary', null, 'Answers'), h('p', { class: 'small' }, bank.join(', '))));
  } else if (kind === 'lesson' && lesson) {
    sheet.append(head());
    if (lesson.profile?.summary) sheet.append(h('p', { class: 'sheet-task' }, lesson.profile.summary));
    if (lesson.words?.length) {
      sheet.append(h('h3', null, '🔤 Key words'), h('table', { class: 'sheet-words' }, lesson.words.map((w) => h('tr', null,
        h('td', null, w.emoji || ''), h('td', null, h('b', null, w.word), w.ipa ? h('span', { class: 'small' }, ` ${w.ipa}`) : null), h('td', null, w.meaning), h('td', null, w.translation || '')))));
    }
    const set = lesson.gapSets?.find((s) => `pack:${s.id}` === opts.level) || lesson.gapSets?.[0];
    // One level on one sheet: the gap set's, when it has one.
    const fits = (item) => !set?.level || !item.level || item.level === set.level;
    let bank = [];
    if (set) {
      sheet.append(h('h3', null, setLabel(set, '✏️')), h('p', { class: 'sheet-task' }, set.rule || '🎧 Listen to the song and fill the gaps.'));
      bank = gapLines(`pack:${set.id}`);
      sheet.append(wordBank(bank));
    }
    const questions = (lesson.quiz || []).filter((q) => q.when !== 'before' && fits(q));
    if (questions.length) {
      sheet.append(h('h3', null, '❓ Questions'), h('ol', { class: 'sheet-questions' }, questions.map((q, i) => h('li', null, q.q,
        h('div', { class: 'sheet-options' }, shuffle([q.answer, ...q.wrong], seeded(opts.seed + i)).map((o) => h('span', null, `☐ ${o}`)))))));
    }
    const talk = (lesson.cards || []).filter((c) => (c.kind === 'discuss' || c.kind === 'personal') && fits(c));
    if (talk.length) sheet.append(h('h3', null, '💬 Talk about it'), h('ul', { class: 'sheet-questions' }, talk.map((c) => h('li', null, c.body))));
    sheet.append(h('details', { class: 'no-print' }, h('summary', null, 'Answers'),
      bank.length ? h('p', { class: 'small' }, `Gaps: ${bank.join(', ')}`) : null,
      h('ol', { class: 'small' }, questions.map((q) => h('li', null, q.answer)))));
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

  const levelSel = h('select', { style: { width: 'auto' } },
    kind === 'gapfill' ? GAP_LEVELS.map((l) => h('option', { value: l.id, selected: l.id === opts.level }, `${l.emoji} ${l.name}`)) : null,
    orderSets(lesson?.gapSets).map((s) => h('option', { value: `pack:${s.id}`, selected: `pack:${s.id}` === opts.level }, `🧠 ${setLabel(s, '')}`)));
  levelSel.addEventListener('change', () => go({ level: levelSel.value }));
  const sizeSel = h('select', { style: { width: 'auto' } }, [3, 4, 5].map((n) => h('option', { value: n, selected: n === opts.size }, `${n}×${n}`)));
  sizeSel.addEventListener('change', () => go({ size: sizeSel.value }));
  const countIn = h('input', { type: 'number', min: 1, max: 60, value: opts.count, style: { width: '5rem' } });
  countIn.addEventListener('change', () => go({ n: countIn.value }));

  el.append(
    h('div', { class: 'no-print' },
      h('div', { class: 'row', style: { marginBottom: '.6rem' } }, h('a', { class: 'btn btn-sm ghost', href: `#/song/${encodeURIComponent(song.id)}` }, `← ${song.title}`)),
      h('div', { class: 'card' },
        h('div', { class: 'row' }, kinds.map(([k, label]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(k === kind), onclick: () => go({ kind: k }) }, label))),
        h('div', { class: 'row top-space' },
          kind === 'gapfill' || (kind === 'lesson' && lesson?.gapSets?.length > 1) ? [h('span', { class: 'knob-label' }, kind === 'gapfill' ? 'Level' : 'Gap set'), levelSel] : null,
          kind === 'bingo' ? [h('span', { class: 'knob-label' }, 'Card'), sizeSel, h('span', { class: 'knob-label' }, 'How many'), countIn] : null,
          kind === 'gapfill' || kind === 'cutup' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => go({ seed: Math.floor(Math.random() * 1e5) }) }, '🎲 Shuffle') : null,
          h('span', { class: 'grow' }),
          h('button', { class: 'btn primary', type: 'button', onclick: () => window.print() }, '🖨️ Print')))),
    sheet,
  );
  return null;
}
