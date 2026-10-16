/*
 * Lyrics bingo on the projector: hand out cards (phones via QR, or printed),
 * play the song, and every word is "called" when it is sung. Type a card
 * number to check a BINGO! claim.
 */
import { h, clear } from '../ui.js';
import { bingoWords, callTimes, cardSize, makeCard, checkCard, encodeWords } from '../lyrics/bingo.js';
import { setupCard, choiceRow } from './common.js';
import { lineEl, paintLine } from './karaoke.js';
import { currentLineAt } from '../music/timeline.js';
import { appUrl } from '../share.js';
import { sfx, confetti } from '../sfx.js';

export async function start(ctx) {
  const { track, timeline, main, song } = ctx;
  const words = bingoWords(timeline, 40);
  const conf = { size: words.length >= 24 ? 4 : 3 };
  const times = callTimes(timeline, words);

  const linkFor = (size) => appUrl(`#/card/${encodeURIComponent(song.id)}/any?n=${size}&w=${encodeWords(words)}&t=${encodeURIComponent(song.title)}`);
  const qrBox = h('div', { class: 'bingo-qr' });
  const drawQr = () => {
    clear(qrBox);
    const size = cardSize(words, conf.size);
    const link = linkFor(size);
    qrBox.append(
      h('img', { src: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(link)}`, alt: 'QR code for phone cards', width: 220, height: 220 }),
      h('div', { class: 'small' }, '📱 Scan for a card on your phone'),
      h('a', { class: 'small', href: link, target: '_blank', rel: 'noopener' }, 'Open a card'),
    );
  };

  if (words.length < 9) {
    clear(main).append(h('div', { class: 'setup-card' }, h('h2', null, 'This song is too short for bingo'), h('a', { class: 'btn', href: `#/song/${encodeURIComponent(song.id)}` }, 'Back')));
    return null;
  }

  const card = setupCard({
    emoji: '🎱',
    title: 'Lyrics bingo',
    intro: 'Everyone gets a card with words from the song. Mark the words you hear. A full line? Shout BINGO!',
    body: h('div', null,
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Card'),
        choiceRow([[3, '3 × 3'], [4, '4 × 4'], [5, '5 × 5']].filter(([n]) => cardSize(words, n) === n), conf.size, (v) => { conf.size = v; drawQr(); })),
      h('div', { class: 'bingo-hand' }, qrBox,
        h('div', { class: 'bingo-print' },
          h('p', null, '🖨️ Or print cards:'),
          h('a', { class: 'btn', href: `#/print/${encodeURIComponent(song.id)}/bingo?size=${conf.size}`, onclick: (e) => { e.currentTarget.href = `#/print/${encodeURIComponent(song.id)}/bingo?size=${conf.size}`; } }, 'Printable cards'))),
    ),
    startLabel: '▶ Play the song',
    onStart: () => { card.destroy(); begin(); },
  });
  drawQr();
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function begin() {
    const size = cardSize(words, conf.size);
    const called = new Set();
    const tiles = new Map();
    const board = h('div', { class: 'bingo-board' }, words.map((w) => {
      const t = h('span', { class: 'bingo-tile' }, w);
      tiles.set(w, t);
      return t;
    }));
    const callout = h('div', { class: 'bingo-call' });
    const lineBox = h('div', { class: 'bingo-line' });
    const cardInput = h('input', { type: 'number', min: 1, max: 999, placeholder: 'Card #', class: 'bingo-input', 'aria-label': 'Card number' });
    const result = h('div', { class: 'bingo-result' });
    const check = () => {
      const n = Number(cardInput.value);
      clear(result);
      if (!n) return;
      const grid = makeCard(words, n, size);
      const res = checkCard(grid, called);
      const inLine = new Set(res.lines.flat());
      result.append(
        h('div', { class: 'bingo-check-grid', style: { '--n': size } }, grid.map((w, i) => h('span', { class: `bc-cell${res.hit[i] ? ' hit' : ''}${inLine.has(i) ? ' line' : ''}` }, w === null ? '⭐' : w))),
        h('div', { class: 'bingo-verdict' }, res.full ? '🏆 FULL HOUSE!' : res.lines.length ? `🎉 BINGO! (${res.lines.length} line${res.lines.length > 1 ? 's' : ''})` : '❌ Not yet!'),
      );
      if (res.lines.length) { confetti(); sfx('jackpot', { volume: 0.6 }); } else sfx('wrong', { volume: 0.4 });
    };
    cardInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    clear(main).append(h('div', { class: 'bingo-wrap' },
      h('div', { class: 'bingo-left' }, callout, lineBox, h('div', { class: 'bingo-checker' }, h('div', { class: 'small' }, 'Someone shouted BINGO? Check their card:'), h('div', { class: 'row' }, cardInput, h('button', { class: 'btn primary', type: 'button', onclick: check }, 'Check')), result)),
      h('div', { class: 'bingo-right' }, h('div', { class: 'small' }, `Called words · ${size}×${size} cards`), board)));
    ctx.setBottom(null);

    let raf = 0;
    let shown = -99;
    let lineNode = null;
    const loop = () => {
      const t = track.time();
      for (const [w, at] of times) {
        if (!called.has(w) && t >= at) {
          called.add(w);
          const tile = tiles.get(w);
          tile.classList.add('called');
          clear(callout).append(h('span', { class: 'bingo-callword' }, w));
        }
      }
      const i = currentLineAt(timeline, t);
      if (i !== shown) {
        shown = i;
        clear(lineBox);
        lineNode = timeline.lines[i] ? lineEl(timeline.lines[i]) : null;
        if (lineNode) lineBox.append(lineNode);
      }
      if (lineNode) paintLine(lineNode, t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // Seeking back un-calls the words not sung yet.
    const offSeek = track.on('seek', (sec) => {
      for (const [w, at] of times) {
        if (at > sec && called.has(w)) { called.delete(w); tiles.get(w).classList.remove('called'); }
      }
    });
    track.seek(0);
    track.play();
    cleanup = () => { cancelAnimationFrame(raf); offSeek(); };
  }
}
